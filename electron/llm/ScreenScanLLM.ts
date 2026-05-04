// electron/llm/ScreenScanLLM.ts
// Context-Aware Screen Intelligence — Cluely-style
// Captures screen → detects content type → routes to mode-specific prompt → streams response.

import { LLMHelper } from "../LLMHelper";
import { SCREEN_SCAN_PROMPT, buildScreenScanMessage } from "./prompts";

// ---------------------------------------------------------------------------
// Screen Content Mode Detection
// ---------------------------------------------------------------------------

export type ScreenContentMode =
    | 'coding'
    | 'interview_question'
    | 'slides_presentation'
    | 'document_text'
    | 'ui_general';

function normalizeScreenText(text: string): string {
    return text
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function countMatches(text: string, patterns: RegExp[]): number {
    return patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
}

function containsCodePatterns(text: string): boolean {
    const patterns = [
        /\b(function|const|let|var|class|interface|type|enum|def|import|export|return)\b/i,
        /\b(async|await|try|catch|throw|public|private|protected|static)\b/i,
        /[{}();<>]=?|=>|::|->/,
        /^\s{2,}(if|for|while|return|console\.log|print)\b/m,
        /\b(npm|yarn|pnpm|pip|cargo|go test|pytest|node)\b/i,
        /\.(ts|tsx|js|jsx|py|java|cpp|go|rs|rb|swift)\b/i,
        /```[\w-]*\n?/,
    ];

    return countMatches(text, patterns) >= 2;
}

function containsInterviewQuestion(text: string): boolean {
    const patterns = [
        /\b(what is|why did|why do|how would|walk me through|tell me about|describe|explain)\b/i,
        /\b(given|constraints?|input|output|example|examples)\b/i,
        /\b(time complexity|space complexity|big o|trade-?offs?)\b/i,
        /\?\s*$/m,
        /^\s*(q:|question:)/im,
    ];

    return countMatches(text, patterns) >= 2;
}

function looksLikeSlide(text: string): boolean {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const bulletLines = lines.filter((line) => /^([•●▪■◦-]|\d+[.)])\s+/.test(line)).length;
    const shortHeadingLines = lines.filter((line) => line.length > 3 && line.length < 52 && /^[A-Z0-9][A-Za-z0-9 ,:&/-]+$/.test(line)).length;
    const patterns = [
        /\b(agenda|overview|q&a|key takeaways?|summary|roadmap|next steps)\b/i,
        /\b(slide|deck|presentation)\b/i,
        /\b(quarterly|okr|kpi|metrics|growth|funnel|revenue)\b/i,
    ];

    return bulletLines >= 2 || (shortHeadingLines >= 2 && countMatches(text, patterns) >= 1);
}

function looksLikeDocumentText(text: string): boolean {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const paragraphLikeLines = lines.filter((line) => line.split(/\s+/).length >= 10).length;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    return wordCount >= 90 && paragraphLikeLines >= 3;
}

/**
 * Lightweight heuristic content classifier.
 * Runs BEFORE the LLM call to select the right prompt strategy.
 * Falls through to 'ui_general' when no pattern matches confidently.
 *
 * The LLM itself also receives the detected mode so it can refine
 * its behavior if the heuristic was wrong.
 */
export function detectScreenContentMode(text: string): ScreenContentMode {
    const normalized = normalizeScreenText(text);

    if (!normalized) return 'ui_general';
    if (containsCodePatterns(normalized)) return 'coding';
    if (containsInterviewQuestion(normalized)) return 'interview_question';
    if (looksLikeSlide(normalized)) return 'slides_presentation';
    if (looksLikeDocumentText(normalized)) return 'document_text';
    return 'ui_general';
}

/**
 * Mode-specific behavior descriptors for the LLM prompt.
 */
export const MODE_BEHAVIOR: Record<ScreenContentMode, {
    label: string;
    objective: string;
    format: string;
}> = {
    coding: {
        label: '⚡ Expert Code Analysis',
        objective: 'Identify the problem, explain the optimal approach, provide step-by-step reasoning, and deliver complete working code.',
        format: `• Problem Identification
• Explanation & Approach
• Step-by-Step Reasoning
• Complete Code Solution
• Follow-ups (Time/Space/Edge Cases)`,
    },
    interview_question: {
        label: '🎯 Interview Answer',
        objective: 'Identify the question type, explain what is being tested, and generate a complete, structured answer.',
        format: `• Problem / Question Type
• Explanation
• Approach / Strategy
• Complete Answer (speakable, first-person)`,
    },
    slides_presentation: {
        label: '📊 Slide Intelligence',
        objective: 'Summarize the slide content, extract data points, and generate talking points with questions.',
        format: `• Summary (2-3 sentences)
• Key Data Points
• Talking Points (with context)
• Questions to Ask`,
    },
    document_text: {
        label: '📄 Document Insights',
        objective: 'Extract and explain the most important insights with context and significance.',
        format: `• Document Type
• Key Insights (with context)
• Action Items
• Executive Summary`,
    },
    ui_general: {
        label: '🔍 Screen Analysis',
        objective: 'Explain what is happening on screen, provide context, and suggest next actions.',
        format: `• What's on screen
• Context & meaning
• Suggested actions
• Notable details`,
    },
};

// ---------------------------------------------------------------------------
// Signal Extraction — clean top-of-screen content for LLM consumption
// ---------------------------------------------------------------------------

/**
 * Extract the most relevant signal from raw OCR text.
 * Takes the top 30 lines (where problem statements usually live)
 * and caps at 800 chars to send a clean, focused chunk instead of
 * a noisy full OCR dump.
 */
function extractSignal(text: string): string {
    if (!text || !text.trim()) return '';
    const normalized = normalizeScreenText(text);
    return normalized
        .split('\n')
        .slice(0, 30)       // top portion only — problem statement lives here
        .join(' ')
        .replace(/\s+/g, ' ')
        .slice(0, 800)      // clean chunk
        .trim();
}

// ---------------------------------------------------------------------------
// OCR Quality Check — determines whether to use text or fall back to vision
// ---------------------------------------------------------------------------

/**
 * Heuristic to determine if OCR text is good enough to use.
 * If OCR is weak (too short, too garbled, low word density), we should
 * skip it and fall back to pure vision analysis.
 */
function isGoodOCR(text: string | undefined): boolean {
    if (!text || !text.trim()) return false;

    const trimmed = text.trim();

    // Too short — likely just UI chrome or garbage
    if (trimmed.length < 40) return false;

    // Word count check — real content has words
    const words = trimmed.split(/\s+/).filter(w => w.length > 1);
    if (words.length < 8) return false;

    // Garble ratio — if too many non-alphanumeric chars, OCR is noisy
    const alphanumeric = (trimmed.match(/[a-zA-Z0-9]/g) || []).length;
    const ratio = alphanumeric / trimmed.length;
    if (ratio < 0.35) return false;

    return true;
}

// ---------------------------------------------------------------------------
// Context Prefix — boosts accuracy for coding problem screens
// ---------------------------------------------------------------------------

const CODING_CONTEXT_PREFIX = `Context:
- This is a coding problem screen (likely LeetCode, HackerRank, CodeSignal, or similar)
- OCR text may be noisy — reconstruct meaning intelligently
- Focus on identifying the exact problem and solving it completely
- Look for: problem title, description, constraints, examples, and any visible code`;

const INTERVIEW_CONTEXT_PREFIX = `Context:
- This is an interview screen with a question visible
- OCR text may be noisy — reconstruct meaning intelligently
- Focus on identifying the exact question and providing a complete, speakable answer`;

// ---------------------------------------------------------------------------
// Vision Fallback Prompt — used when OCR is too weak
// ---------------------------------------------------------------------------

const VISION_FALLBACK_PROMPT = `You are an expert coding interview assistant analyzing a screenshot.

The OCR text extraction failed or was too noisy to use, so you must rely on the screenshot image directly.

Analyze this coding problem screenshot and provide a COMPLETE, structured response:

**Problem:**
- Identify the problem name and platform if visible
- Describe what the problem is asking

**Explanation:**
- Explain the problem clearly in simple terms
- State constraints and examples if visible

**Approach:**
- Explain the optimal algorithm strategy
- State time and space complexity

**Steps:**
1. Step-by-step reasoning through the solution

**Code:**
\`\`\`javascript
// Complete, working, interview-ready solution
\`\`\`

**Follow-ups:**
- Time/Space complexity with explanation
- Edge cases considered
- Alternative approaches

IMPORTANT: Provide a COMPLETE answer. Never shorten artificially.`;

// ---------------------------------------------------------------------------
// ScreenScanLLM
// ---------------------------------------------------------------------------

export class ScreenScanLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    /**
     * Stream a context-aware analysis of the screen content.
     *
     * Three critical upgrades:
     * 1. SIGNAL EXTRACTION — sends clean top-30-lines / 800-char chunk instead of raw OCR dump
     * 2. STRONG CONTEXT PREFIX — coding/interview prefix boosts problem identification accuracy
     * 3. VISION FALLBACK — if OCR is weak, bypasses text entirely and sends image to vision model
     *
     * @param imagePaths    Screenshot image paths (required — at least 1)
     * @param extractedText Optional OCR / heuristic text extracted from the image
     * @param mode          Content mode (auto-detected or forced)
     */
    async *generateStream(
        imagePaths: string[],
        extractedText?: string,
        mode: ScreenContentMode = 'ui_general'
    ): AsyncGenerator<string> {
        if (!imagePaths || imagePaths.length === 0) {
            yield "No screenshot provided. Capture your screen and try again.";
            return;
        }

        try {
            const behavior = MODE_BEHAVIOR[mode];
            console.log(`[ScreenScanLLM] Mode detected: ${mode} (${behavior.label})`);

            // ── UPGRADE 3: VISION FALLBACK ──────────────────────────────
            // If OCR text is weak/garbled, skip it entirely and send the
            // image directly to the vision model with a focused prompt.
            const isCodingMode = mode === 'coding' || mode === 'interview_question';

            if (!isGoodOCR(extractedText)) {
                console.log(`[ScreenScanLLM] ⚠️ OCR quality too low (${extractedText?.length ?? 0} chars) — falling back to pure vision`);

                const visionPrompt = isCodingMode
                    ? VISION_FALLBACK_PROMPT
                    : SCREEN_SCAN_PROMPT;

                const visionMessage = isCodingMode
                    ? 'Analyze this coding problem screenshot and provide the full solution with explanation.'
                    : buildScreenScanMessage(mode, null);

                // Stream with image paths — vision model handles it
                yield* this.llmHelper.streamChat(
                    visionMessage,
                    imagePaths,        // send images for vision
                    undefined,
                    visionPrompt,
                    true               // ignore knowledge mode
                );
                return;
            }

            // ── UPGRADE 1: SIGNAL EXTRACTION ────────────────────────────
            // Extract clean top-of-screen signal instead of full OCR dump
            const signal = extractSignal(extractedText!);
            console.log(`[ScreenScanLLM] Signal extracted: ${signal.length} chars from ${extractedText!.length} chars OCR`);

            // ── UPGRADE 2: STRONG CONTEXT PREFIX ────────────────────────
            // Prepend context that tells the LLM what kind of screen this is
            let contextPrefix = '';
            if (mode === 'coding') {
                contextPrefix = CODING_CONTEXT_PREFIX;
            } else if (mode === 'interview_question') {
                contextPrefix = INTERVIEW_CONTEXT_PREFIX;
            }

            // Build the final message with prefix + signal
            const baseMessage = buildScreenScanMessage(mode, signal);
            const message = contextPrefix
                ? `${contextPrefix}\n\n${baseMessage}`
                : baseMessage;

            // Stream from LLM with image + extracted text signal
            yield* this.llmHelper.streamChat(
                message,
                imagePaths,        // always send images alongside text for best results
                undefined,
                SCREEN_SCAN_PROMPT,
                true               // ignore knowledge mode
            );
        } catch (error) {
            console.error("[ScreenScanLLM] Stream failed:", error);
            yield "I couldn't analyze the screen right now. Please try again.";
        }
    }
}
