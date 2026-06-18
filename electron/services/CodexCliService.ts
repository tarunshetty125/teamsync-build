// electron/services/CodexCliService.ts
// Manages Codex CLI as a local LLM provider via subprocess.
// Ported from Natively with cleanup — supports run(), stream(), auto-detect, validate.

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const CODEX_SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const;
export const CODEX_SERVICE_TIERS = ['default', 'fast', 'flex'] as const;
export const CODEX_MODEL_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;

export type CodexSandboxMode = typeof CODEX_SANDBOX_MODES[number];
export type CodexServiceTier = typeof CODEX_SERVICE_TIERS[number];
export type CodexModelReasoningEffort = typeof CODEX_MODEL_REASONING_EFFORTS[number];

export interface CodexCliConfig {
  enabled: boolean;
  path: string;
  model: string;
  fastModel: string;
  timeoutMs: number;
  sandboxMode: CodexSandboxMode;
  serviceTier: CodexServiceTier;
  modelReasoningEffort?: CodexModelReasoningEffort;
}

export const DEFAULT_CODEX_CLI_CONFIG: CodexCliConfig = {
  enabled: false,
  path: 'codex',
  model: 'gpt-5.4',
  fastModel: 'gpt-5.3-codex',
  timeoutMs: 60000,
  sandboxMode: 'read-only',
  serviceTier: 'default',
  modelReasoningEffort: undefined,
};

export interface CodexRunOptions {
  prompt: string;
  model: string;
  imagePaths?: string[];
  timeoutMs: number;
  sandboxMode?: CodexSandboxMode;
  serviceTier?: CodexServiceTier;
  modelReasoningEffort?: CodexModelReasoningEffort;
  signal?: AbortSignal;
}

export class CodexCliService {
  // ── Argument building ─────────────────────────────────────────────────

  static buildArgs(
    model: string,
    imagePaths: string[] = [],
    sandboxMode: CodexSandboxMode = 'read-only',
    serviceTier?: CodexServiceTier,
    modelReasoningEffort?: CodexModelReasoningEffort,
  ): string[] {
    const args = ['exec', '--json', '--color', 'never', '--sandbox', sandboxMode, '--skip-git-repo-check', '--model', model];
    if (serviceTier && serviceTier !== 'default') {
      args.push('-c', `service_tier="${serviceTier}"`);
    }
    if (modelReasoningEffort) {
      args.push('-c', `model_reasoning_effort="${modelReasoningEffort}"`);
    }
    for (const imagePath of imagePaths) {
      if (!imagePath) continue;
      args.push('--image', imagePath);
    }
    return args;
  }

  // ── Config normalization ──────────────────────────────────────────────

  static normalizeConfig(config: Partial<CodexCliConfig> = {}): CodexCliConfig {
    const timeoutMs = Number(config.timeoutMs);
    const sandboxMode = config.sandboxMode && (CODEX_SANDBOX_MODES as readonly string[]).includes(config.sandboxMode)
      ? config.sandboxMode as CodexSandboxMode
      : DEFAULT_CODEX_CLI_CONFIG.sandboxMode;
    const serviceTier = config.serviceTier && (CODEX_SERVICE_TIERS as readonly string[]).includes(config.serviceTier)
      ? config.serviceTier as CodexServiceTier
      : DEFAULT_CODEX_CLI_CONFIG.serviceTier;
    const modelReasoningEffort = config.modelReasoningEffort && (CODEX_MODEL_REASONING_EFFORTS as readonly string[]).includes(config.modelReasoningEffort)
      ? config.modelReasoningEffort as CodexModelReasoningEffort
      : DEFAULT_CODEX_CLI_CONFIG.modelReasoningEffort;

    return {
      enabled: !!config.enabled,
      path: (config.path || DEFAULT_CODEX_CLI_CONFIG.path).trim() || DEFAULT_CODEX_CLI_CONFIG.path,
      model: (config.model || DEFAULT_CODEX_CLI_CONFIG.model).trim() || DEFAULT_CODEX_CLI_CONFIG.model,
      fastModel: (config.fastModel || DEFAULT_CODEX_CLI_CONFIG.fastModel).trim() || DEFAULT_CODEX_CLI_CONFIG.fastModel,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_CODEX_CLI_CONFIG.timeoutMs,
      sandboxMode,
      serviceTier,
      modelReasoningEffort,
    };
  }

  // ── Auto-detection ────────────────────────────────────────────────────

  static getCandidatePaths(): string[] {
    const home = os.homedir();
    if (process.platform === 'win32') {
      const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      const programs = process.env['ProgramFiles'] || 'C:\\Program Files';
      return [
        path.join(local, 'Programs', 'Codex', 'codex.exe'),
        path.join(programs, 'Codex', 'codex.exe'),
        path.join(home, '.cargo', 'bin', 'codex.exe'),
        path.join(home, 'AppData', 'Roaming', 'npm', 'codex.cmd'),
      ];
    }
    return [
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
      path.join(home, '.cargo', 'bin', 'codex'),
      path.join(home, '.local', 'bin', 'codex'),
      path.join(home, '.bun', 'bin', 'codex'),
      '/Applications/Codex.app/Contents/Resources/codex',
      path.join(home, 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'),
    ];
  }

  /** Filesystem-only check — no subprocess spawned */
  static autoDetectPath(): string | null {
    for (const candidate of this.getCandidatePaths()) {
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) {
          if (process.platform === 'win32') return candidate;
          if ((stat.mode & 0o111) !== 0) return candidate;
        }
      } catch { /* not found */ }
    }
    return null;
  }

  // ── Validation ────────────────────────────────────────────────────────

  static async validateExecutable(input: string, timeoutMs = 10000): Promise<{ success: boolean; error?: string; resolvedPath?: string }> {
    const tryOne = (binPath: string): Promise<{ success: boolean; error?: string }> =>
      new Promise((resolve) => {
        const child = spawn(binPath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          resolve({ success: false, error: `Codex CLI validation timed out for "${binPath}".` });
        }, timeoutMs);
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', (error) => {
          clearTimeout(timer);
          resolve({ success: false, error: `Codex CLI was not found at "${binPath}". ${error.message}` });
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) resolve({ success: true });
          else resolve({ success: false, error: `Codex CLI validation failed for "${binPath}"${stderr ? `: ${this.sanitize(stderr)}` : '.'}` });
        });
      });

    const first = await tryOne(input);
    if (first.success) return { success: true, resolvedPath: input };

    // If it's a bare name (no path separator), try auto-detection
    const looksBare = !input || !input.includes(path.sep);
    if (looksBare) {
      const detected = this.autoDetectPath();
      if (detected && detected !== input) {
        const second = await tryOne(detected);
        if (second.success) return { success: true, resolvedPath: detected };
      }
    }
    return { success: false, error: first.error };
  }

  // ── Execution (one-shot) ──────────────────────────────────────────────

  static async run(binPath: string, options: CodexRunOptions): Promise<string> {
    const result = await this.collect(binPath, options);
    const normalized = this.extractText(result.stdout);
    if (normalized) return normalized;
    const codexError = this.extractCodexError(result.stdout);
    throw new Error(codexError || result.stderr || 'Codex CLI returned an empty response.');
  }

  // ── Streaming execution ───────────────────────────────────────────────

  static async *stream(binPath: string, options: CodexRunOptions): AsyncGenerator<string> {
    if (options.signal?.aborted) throw new Error('Codex CLI request aborted before start.');
    const args = this.buildArgs(options.model, options.imagePaths, options.sandboxMode, options.serviceTier, options.modelReasoningEffort);
    const child = spawn(binPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let lineBuffer = '';
    let emitted = false;
    let aborted = false;

    const timer = setTimeout(() => child.kill('SIGTERM'), options.timeoutMs);

    const queue: string[] = [];
    let finished = false;
    let failure: Error | null = null;
    let notify: (() => void) | null = null;

    const wake = () => { if (notify) { notify(); notify = null; } };

    const onAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
      if (!failure) failure = new Error('Codex CLI request aborted.');
      wake();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || '';
      for (const line of lines) {
        const extracted = this.extractText(line);
        if (extracted) { emitted = true; queue.push(extracted); }
      }
      wake();
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdin.on('error', (error) => {
      if (!failure) failure = new Error(`Codex CLI stdin failed for "${binPath}". ${error.message}`);
      wake();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      failure = new Error(`Codex CLI was not found at "${binPath}". ${error.message}`);
      finished = true;
      wake();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !failure && !aborted) {
        const codexError = this.extractCodexError(stdout);
        const detail = codexError || (stderr ? this.sanitize(stderr) : '');
        failure = new Error(detail ? `Codex CLI: ${detail}` : `Codex CLI exited with code ${code}.`);
      }
      finished = true;
      wake();
    });

    try {
      child.stdin.write(options.prompt);
      child.stdin.end();
    } catch (error: any) {
      failure = new Error(`Codex CLI stdin failed for "${binPath}". ${error.message}`);
      wake();
    }

    try {
      while (!finished || queue.length > 0) {
        while (queue.length > 0) yield queue.shift()!;
        if (finished) break;
        await new Promise<void>((resolve) => { notify = resolve; });
      }
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }

    if (aborted) return;
    if (failure) {
      if (emitted) {
        console.warn('[CodexCliService] Stream ended after partial output:', failure.message);
        return;
      }
      throw failure;
    }
    if (!emitted) {
      const normalized = this.extractText(stdout);
      if (normalized) { yield normalized; return; }
      const codexError = this.extractCodexError(stdout);
      throw new Error(codexError || (stderr ? this.sanitize(stderr) : 'Codex CLI returned an empty response.'));
    }
  }

  // ── Internal: collect full output ─────────────────────────────────────

  private static async collect(binPath: string, options: CodexRunOptions): Promise<{ stdout: string; stderr: string }> {
    if (options.signal?.aborted) throw new Error('Codex CLI request aborted before start.');
    return new Promise((resolve, reject) => {
      const child = spawn(binPath, this.buildArgs(options.model, options.imagePaths, options.sandboxMode, options.serviceTier, options.modelReasoningEffort), { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const settle = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); fn(); };

      const onAbort = () => { child.kill('SIGTERM'); settle(() => reject(new Error('Codex CLI request aborted.'))); };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      const timer = setTimeout(() => { child.kill('SIGTERM'); settle(() => reject(new Error(`Codex CLI timed out after ${options.timeoutMs}ms.`))); }, options.timeoutMs);

      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (error) => { settle(() => reject(new Error(`Codex CLI was not found at "${binPath}". ${error.message}`))); });
      child.on('close', (code) => {
        settle(() => {
          if (code === 0) resolve({ stdout, stderr: this.sanitize(stderr) });
          else {
            const codexError = this.extractCodexError(stdout);
            const detail = codexError || (stderr ? this.sanitize(stderr) : '');
            reject(new Error(detail ? `Codex CLI: ${detail}` : `Codex CLI exited with code ${code}.`));
          }
        });
      });
      child.stdin.on('error', (error) => { settle(() => reject(new Error(`Codex CLI stdin failed for "${binPath}". ${error.message}`))); });

      try { child.stdin.write(options.prompt); child.stdin.end(); }
      catch (error: any) { settle(() => reject(new Error(`Codex CLI stdin failed for "${binPath}". ${error.message}`))); }
    });
  }

  // ── JSONL parsing ─────────────────────────────────────────────────────

  static extractText(raw: string): string {
    const text = raw.trim();
    if (!text) return '';
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let sawJson = false;
    const extracted = lines.map(line => {
      const parsed = this.tryParseJson(line);
      if (parsed.ok) { sawJson = true; return this.findText(parsed.value); }
      return '';
    }).filter(Boolean).join('');
    if (extracted.trim()) return extracted.trim();
    if (sawJson && lines.every(l => this.tryParseJson(l).ok)) return '';
    return text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
  }

  static extractCodexError(raw: string): string {
    if (!raw) return '';
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = this.tryParseJson(trimmed);
      if (!parsed.ok) continue;
      const v = parsed.value;
      if (!v || typeof v !== 'object') continue;
      const isError = v.type === 'error' || v.type === 'turn.failed' || v.item?.type === 'error';
      if (!isError) continue;
      const candidates = [v.error?.message, v.error?.error?.message, v.message, v.item?.message];
      for (const c of candidates) {
        if (typeof c !== 'string' || !c) continue;
        const inner = this.tryParseJson(c);
        if (inner.ok && inner.value?.error?.message) return this.sanitize(inner.value.error.message);
        return this.sanitize(c);
      }
    }
    return '';
  }

  private static tryParseJson(line: string): { ok: true; value: any } | { ok: false } {
    try { return { ok: true, value: JSON.parse(line) }; }
    catch { return { ok: false }; }
  }

  private static findText(value: any): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(item => this.findText(item)).filter(Boolean).join('');
    if (typeof value !== 'object') return '';
    if (['error', 'thread.started', 'turn.started', 'turn.completed', 'turn.failed'].includes(value.type)) return '';
    if (value.item?.type === 'error') return '';
    if (value.item?.type === 'agent_message') return this.findText(value.item.text);
    if (value.type === 'agent_message') return this.findText(value.text);
    for (const key of ['delta', 'text', 'content', 'output_text', 'output', 'response']) {
      const candidate = this.findText(value[key]);
      if (candidate) return candidate;
    }
    if (value.message) return this.findText(value.message);
    if (value.item) return this.findText(value.item);
    if (value.data) return this.findText(value.data);
    return '';
  }

  static sanitize(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, 1000);
  }
}
