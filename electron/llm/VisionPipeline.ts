// electron/llm/VisionPipeline.ts
// Image processing, OCR, and screen text extraction.
// Extracted from LLMHelper to isolate vision concerns from streaming/generation.
//
// This module owns:
//   - Image resizing and compression (processImage)
//   - Tesseract OCR with fallback (extractScreenText, extractScreenTextHybrid)
//   - OCR worker process management (initOCRWorker, runOCRWorker)
//   - Low-quality text detection (isLowQualityScreenText)
//   - Screen change detection (hash-based dedup)

import fs from 'fs';
import sharp from 'sharp';
import path from 'path';
import { spawn } from 'child_process';
import { getPythonPath, getOCRScriptPath, getPythonEnv } from '../utils/pythonRuntime';

// ---------------------------------------------------------------------------
// VisionPipeline
// ---------------------------------------------------------------------------

export class VisionPipeline {
    private lastOCRCache = new Map<string, string>();
    private ocrWorker: any = null;
    private ocrWorkerBuffer: string = '';
    private ocrWorkerResolvers = new Map<string, (value: string) => void>();
    private ocrWorkerRequestSeq = 0;
    private lastScreenHash: string = '';

    // -----------------------------------------------------------------------
    // Image Processing
    // -----------------------------------------------------------------------

    /**
     * Process image: resize to max 1536px and compress to JPEG 80%.
     * Drastically reduces token usage and upload time.
     */
    async processImage(imagePath: string): Promise<{ mimeType: string; data: string }> {
        try {
            const imageBuffer = await fs.promises.readFile(imagePath);
            const processedBuffer = await sharp(imageBuffer)
                .resize({
                    width: 1536,
                    height: 1536,
                    fit: 'inside',
                    withoutEnlargement: true,
                })
                .jpeg({ quality: 80 })
                .toBuffer();

            return {
                mimeType: "image/jpeg",
                data: processedBuffer.toString("base64"),
            };
        } catch (error) {
            console.error("[VisionPipeline] Failed to process image with sharp:", error);
            const data = await fs.promises.readFile(imagePath);
            return {
                mimeType: "image/png",
                data: data.toString("base64"),
            };
        }
    }

    /**
     * Read and encode image as base64 with optional compression for TeamSync API.
     * Resize to max 1920px and JPEG 85% to stay within API body limits.
     */
    async compressForUpload(imagePath: string): Promise<{ mime_type: string; data: string } | null> {
        if (!fs.existsSync(imagePath)) return null;

        try {
            const compressed = await sharp(imagePath)
                .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toBuffer();
            return { mime_type: 'image/jpeg', data: compressed.toString('base64') };
        } catch (compressErr: any) {
            console.warn('[VisionPipeline] Image compression failed, sending raw:', compressErr.message);
            const imageData = await fs.promises.readFile(imagePath);
            if (imageData.length > 500 * 1024) {
                console.warn('[VisionPipeline] Raw fallback image too large to send, skipping:', imagePath);
                return null;
            }
            return { mime_type: 'image/png', data: imageData.toString('base64') };
        }
    }

    // -----------------------------------------------------------------------
    // Screen Text Extraction
    // -----------------------------------------------------------------------

    /**
     * Extract visible on-screen text from screenshots using Tesseract OCR.
     * Stateless — no transcript, no knowledge mode, no RAG.
     */
    async extractScreenText(imagePaths: string[]): Promise<string> {
        if (!imagePaths?.length) return '';
        const Tesseract = require('tesseract.js');

        try {
            const texts = await Promise.all(
                imagePaths.map(async (imagePath) => {
                    const result = await Tesseract.recognize(imagePath, 'eng', {
                        logger: (): any => undefined,
                    });
                    return result?.data?.text ?? '';
                })
            );
            return texts.join('\n');
        } catch (error: any) {
            console.warn('[VisionPipeline] Screen text extraction failed:', error?.message || error);
            return '';
        }
    }

    /**
     * Hybrid screen text extraction with caching and dedup.
     * Uses Tesseract as primary, falls back to OCR worker for low-quality text.
     * Returns '__NO_CHANGE__' if the screen content hasn't changed.
     */
    async extractScreenTextHybrid(imagePaths: string[]): Promise<string> {
        console.log(`[OCR] Starting hybrid screen text extraction for ${imagePaths?.length || 0} images...`);
        if (!imagePaths?.length) return '';
        let resizedPaths: string[] = [];

        try {
            resizedPaths = await Promise.all(
                imagePaths.map(async (imagePath) => {
                    const outputPath = imagePath + `_resized_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
                    const metadata = await sharp(imagePath).metadata().catch((): any => null);

                    if ((metadata?.width ?? 0) > 1600) {
                        await sharp(imagePath)
                            .resize({ width: 1280, withoutEnlargement: true })
                            .toFile(outputPath);
                        return outputPath;
                    }
                    return imagePath;
                })
            );

            const imageBuffers = await Promise.all(resizedPaths.map((p) => fs.promises.readFile(p)));
            const key = this.hashText(imageBuffers.map((buffer) => this.hashBuffer(buffer)).join('|'));

            if (key === this.lastScreenHash) {
                return '__NO_CHANGE__';
            }

            if (this.lastOCRCache.has(key)) {
                const cached = this.lastOCRCache.get(key)!;
                this.lastScreenHash = key;
                return cached;
            }

            const Tesseract = require('tesseract.js');
            const fastTexts = await Promise.all(
                resizedPaths.map(async (imagePath) => {
                    const result = await Tesseract.recognize(imagePath, 'eng', {
                        logger: (): any => undefined,
                    });
                    return result?.data?.text ?? '';
                })
            );

            let text = fastTexts.join('\n');
            console.log(`[OCR] Tesseract extraction complete. Length: ${text.length}`);
            this.lastOCRCache.set(key, text);

            if (this.isLowQualityScreenText(text)) {
                console.log('[OCR] Low quality text detected, running fallback OCR worker...');
                const fallback = await this.runOCRWorker(resizedPaths);

                if (fallback && fallback.trim().length > 0) {
                    console.log(`[OCR] Fallback OCR complete. Length: ${fallback.length}`);
                    text = fallback
                        .replace(/\r/g, '')
                        .replace(/[ \t]+/g, ' ')
                        .replace(/\n{3,}/g, '\n\n')
                        .trim();
                }
            }

            this.lastScreenHash = key;
            if (this.lastOCRCache.size > 100) {
                this.lastOCRCache.clear();
            }
            this.lastOCRCache.set(key, text);
            return text;
        } catch (error: any) {
            console.warn('[VisionPipeline] Hybrid screen text extraction failed:', error?.message || error);
            return '';
        } finally {
            for (const p of resizedPaths) {
                if (p.includes('_resized_')) {
                    fs.unlink(p, () => { });
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Quality Detection
    // -----------------------------------------------------------------------

    isLowQualityScreenText(text: string): boolean {
        if (!text) return true;

        const cleaned = text.trim();
        if (cleaned.length < 80) return true;

        const lines = cleaned.split('\n').length;
        const hasCode = /(function|const|let|class|=>)/.test(cleaned);

        const weirdChars =
            (cleaned.match(/[^a-zA-Z0-9\s\n\{\}\(\);\.\,\:\<\>\=\+\-\*\/]/g) || []).length;

        if (weirdChars > cleaned.length * 0.15) return true;
        if (lines < 3 && !hasCode) return true;

        return false;
    }

    // -----------------------------------------------------------------------
    // OCR Worker (Python subprocess)
    // -----------------------------------------------------------------------

    private initOCRWorker(): void {
        if (this.ocrWorker) return;

        const pythonPath = getPythonPath();
        const scriptPath = getOCRScriptPath();
        this.ocrWorker = spawn(pythonPath, [scriptPath], {
            env: getPythonEnv(),
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.ocrWorker.stderr.on('data', (data: Buffer) => {
            console.warn('[OCR Worker stderr]', data.toString().trim());
        });
        this.ocrWorker.stdout.on('data', (data: Buffer) => {
            this.ocrWorkerBuffer += data.toString();

            let newlineIndex = this.ocrWorkerBuffer.indexOf('\n');
            while (newlineIndex !== -1) {
                const line = this.ocrWorkerBuffer.slice(0, newlineIndex);
                this.ocrWorkerBuffer = this.ocrWorkerBuffer.slice(newlineIndex + 1);
                let parsed: any = null;
                try {
                    parsed = JSON.parse(line);
                } catch { }

                const workerRequestId = typeof parsed?.id === 'string' ? parsed.id : '';
                if (!workerRequestId || !this.ocrWorkerResolvers.has(workerRequestId)) {
                    continue;
                }
                const resolve = workerRequestId ? this.ocrWorkerResolvers.get(workerRequestId) : undefined;

                if (workerRequestId) this.ocrWorkerResolvers.delete(workerRequestId);
                if (resolve) resolve(typeof parsed?.text === 'string' ? parsed.text : '');
                newlineIndex = this.ocrWorkerBuffer.indexOf('\n');
            }
        });
        this.ocrWorker.on('exit', () => {
            this.ocrWorker = null;
            this.ocrWorkerBuffer = '';
            for (const resolve of this.ocrWorkerResolvers.values()) resolve('');
            this.ocrWorkerResolvers.clear();
        });
    }

    private runOCRWorker(imagePaths: string[]): Promise<string> {
        return new Promise((resolve) => {
            this.initOCRWorker();

            if (!this.ocrWorker?.stdin) {
                resolve('');
                return;
            }

            const workerRequestId = String(++this.ocrWorkerRequestSeq);
            let settled = false;
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            const wrappedResolve = (value: string) => {
                if (settled) return;
                settled = true;
                if (timeoutId) clearTimeout(timeoutId);
                resolve(value);
            };

            timeoutId = setTimeout(() => {
                this.ocrWorkerResolvers.delete(workerRequestId);
                wrappedResolve('');
            }, 3000);

            this.ocrWorkerResolvers.set(workerRequestId, wrappedResolve);

            if (this.ocrWorkerResolvers.size > 200) {
                for (const [, pendingResolve] of this.ocrWorkerResolvers) {
                    pendingResolve('');
                }
                this.ocrWorkerResolvers.clear();
            }

            try {
                const payload = JSON.stringify({ id: workerRequestId, imagePaths }) + '\n';
                this.ocrWorker.stdin.write(payload);
            } catch {
                this.ocrWorkerResolvers.delete(workerRequestId);
                wrappedResolve('');
            }
        });
    }

    // -----------------------------------------------------------------------
    // Hash Utilities
    // -----------------------------------------------------------------------

    private hashText(text: string): string {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = (hash << 5) - hash + text.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString();
    }

    private hashBuffer(buffer: Buffer): string {
        let hash = buffer.length;
        const step = Math.max(1, Math.floor(buffer.length / 200));
        for (let i = 0; i < buffer.length; i += step) {
            hash = (hash * 31 + buffer[i] + i) | 0;
        }
        return hash.toString();
    }
}
