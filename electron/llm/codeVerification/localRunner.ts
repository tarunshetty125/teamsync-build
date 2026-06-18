// electron/llm/codeVerification/localRunner.ts
// Sandboxed local execution of test cases via child_process.spawn.
// Supports Python, JavaScript, C++ (g++), Java (javac+java), Go, and SQL (sqlite3).
// Enforces timeout, output size limits, and concurrency throttling.

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  TC_ENV, isLocallyRunnable, isValidEntry, buildDriver, parseDriverResult,
} from './drivers';
import { buildCppProgram } from './cppDriver';
import { buildJavaProgram } from './javaDriver';
import { buildGoProgram } from './goDriver';
import { buildSqlScript, parseSqlRows } from './sqlRunner';
import { valuesEqual, renderValue, compareResultSet } from './judge';
import type { TestCase, CaseResult, DriverHints, SqlSpec } from './types';

/* ── Constants ────────────────────────────────────────────── */

const TIMEOUT_MS = 3_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_CONCURRENCY = 2;

/* ── Concurrency semaphore ────────────────────────────────── */

let active = 0;
const waiters: (() => void)[] = [];

const acquire = (): Promise<void> =>
  active < MAX_CONCURRENCY
    ? (active++, Promise.resolve())
    : new Promise<void>(res => waiters.push(() => { active++; res(); }));

const release = (): void => {
  active--;
  const next = waiters.shift();
  if (next) next();
};

/* ── Interpreter availability cache ───────────────────────── */

const interpreterCache = new Map<string, boolean>();

const isInterpreterAvailable = (cmd: string, versionArgs = ['--version']): Promise<boolean> => {
  const cached = interpreterCache.get(cmd);
  if (cached !== undefined) return Promise.resolve(cached);
  return new Promise(resolve => {
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        interpreterCache.set(cmd, ok);
        resolve(ok);
      }
    };
    try {
      const child = spawn(cmd, versionArgs, { stdio: ['ignore', 'ignore', 'ignore'] });
      child.on('error', () => done(false));
      child.on('exit', code => done(code === 0));
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* noop */ }
        done(false);
      }, 2_000).unref?.();
    } catch {
      done(false);
    }
  });
};

export const localLanguageAvailable = async (language: string): Promise<boolean> => {
  if (language === 'sql') return isInterpreterAvailable('sqlite3');
  if (!isLocallyRunnable(language)) return false;
  if (language === 'cpp') return isInterpreterAvailable('g++');
  if (language === 'java') return (await isInterpreterAvailable('javac')) && isInterpreterAvailable('java');
  if (language === 'go') return isInterpreterAvailable('go', ['version']);
  const cmd = language === 'python' ? 'python3' : 'node';
  return isInterpreterAvailable(cmd);
};

/* ── Process spawning ─────────────────────────────────────── */

interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  oversized: boolean;
  ms: number;
}

const spawnOnce = (cmd: string, scriptPath: string, cwd: string, tcJson: string): Promise<SpawnResult> =>
  new Promise(resolve => {
    const start = Date.now();
    let stdout = '', stderr = '', timedOut = false, oversized = false, settled = false;
    const env: Record<string, string | undefined> = {
      PATH: process.env.PATH, HOME: cwd, TMPDIR: cwd,
      [TC_ENV]: tcJson,
      PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8',
      NODE_OPTIONS: '--max-old-space-size=128',
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, [scriptPath], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (e: any) {
      resolve({ stdout: '', stderr: String(e?.message || e), code: null, signal: null, timedOut: false, oversized: false, ms: Date.now() - start });
      return;
    }
    const killTree = () => {
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* noop */ }
      try { child.kill('SIGKILL'); } catch { /* noop */ }
    };
    const finish = (extra: Partial<SpawnResult>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killTree();
      resolve({ stdout, stderr, code: null, signal: null, timedOut, oversized, ms: Date.now() - start, ...extra });
    };
    const timer = setTimeout(() => { timedOut = true; killTree(); }, TIMEOUT_MS);
    (timer as any).unref?.();
    const cap = (buf: string, chunk: Buffer) => {
      const next = buf + chunk.toString('utf8');
      if (next.length > MAX_OUTPUT_BYTES) { oversized = true; killTree(); return next.slice(0, MAX_OUTPUT_BYTES); }
      return next;
    };
    child.stdout?.on('data', (c: Buffer) => { stdout = cap(stdout, c); });
    child.stderr?.on('data', (c: Buffer) => { stderr = cap(stderr, c); });
    child.on('error', (e: Error) => finish({ stderr: stderr || String(e?.message || e) }));
    child.on('exit', (code, signal) => finish({ code, signal }));
  });

const spawnCmd = (
  cmd: string, args: string[], cwd: string, timeoutMs: number, stdinPath?: string,
): Promise<SpawnResult> =>
  new Promise(resolve => {
    const start = Date.now();
    let stdout = '', stderr = '', timedOut = false, oversized = false, settled = false;
    const env: Record<string, string | undefined> = { PATH: process.env.PATH, HOME: cwd, TMPDIR: cwd };
    let stdinFd: number | undefined;
    if (stdinPath) {
      try { stdinFd = fs.openSync(stdinPath, 'r'); } catch { /* noop */ }
    }
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: [stdinFd ?? 'ignore', 'pipe', 'pipe'], detached: true });
    } catch (e: any) {
      if (stdinFd !== undefined) { try { fs.closeSync(stdinFd); } catch { /* noop */ } }
      resolve({ stdout: '', stderr: String(e?.message || e), code: null, signal: null, timedOut: false, oversized: false, ms: Date.now() - start });
      return;
    }
    if (stdinFd !== undefined) { try { fs.closeSync(stdinFd); } catch { /* noop */ } }
    const killTree = () => {
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* noop */ }
      try { child.kill('SIGKILL'); } catch { /* noop */ }
    };
    const finish = (extra: Partial<SpawnResult>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killTree();
      resolve({ stdout, stderr, code: null, signal: null, timedOut, oversized, ms: Date.now() - start, ...extra });
    };
    const timer = setTimeout(() => { timedOut = true; killTree(); }, timeoutMs);
    (timer as any).unref?.();
    const cap = (buf: string, chunk: Buffer) => {
      const next = buf + chunk.toString('utf8');
      if (next.length > MAX_OUTPUT_BYTES) { oversized = true; killTree(); return next.slice(0, MAX_OUTPUT_BYTES); }
      return next;
    };
    child.stdout?.on('data', (c: Buffer) => { stdout = cap(stdout, c); });
    child.stderr?.on('data', (c: Buffer) => { stderr = cap(stderr, c); });
    child.on('error', (e: Error) => finish({ stderr: stderr || String(e?.message || e) }));
    child.on('exit', (code, signal) => finish({ code, signal }));
  });

const trunc = (s: string, max = 2000) => s.length > max ? s.slice(0, max) + '…' : s;

/* ── Main runners ─────────────────────────────────────────── */

export const runCase = async (
  language: string, code: string, entry: string, tc: TestCase, hints?: DriverHints,
): Promise<CaseResult> => {
  if (language === 'cpp') return runCppCase(code, entry, tc);
  if (language === 'java') return runJavaCase(code, entry, tc);
  if (language === 'go') return runGoCase(code, entry, tc);

  const driver = buildDriver(language, code, entry, hints);
  if (!driver || !driver.localCmd) {
    return { case: tc, status: 'error', stdout: '', error: `no local driver for ${language}`, ms: 0 };
  }
  await acquire();
  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-verify-'));
    const scriptPath = path.join(tmpDir, `main.${driver.ext}`);
    fs.writeFileSync(scriptPath, driver.source, { encoding: 'utf8' });
    const tcJson = JSON.stringify(tc.input ?? []);
    const raw = await spawnOnce(driver.localCmd, scriptPath, tmpDir, tcJson);
    if (raw.timedOut) return { case: tc, status: 'error', stdout: trunc(raw.stdout), error: `timed out after ${TIMEOUT_MS}ms`, ms: raw.ms };
    if (raw.oversized) return { case: tc, status: 'error', stdout: trunc(raw.stdout), error: 'output limit exceeded', ms: raw.ms };
    const parsed = parseDriverResult(raw.stdout);
    if (!parsed.found) {
      const errText = trunc(raw.stderr) || `exited with code ${raw.code ?? 'unknown'}`;
      return { case: tc, status: 'error', stdout: trunc(raw.stdout), error: errText, ms: raw.ms };
    }
    if (tc.source === 'smoke') return { case: tc, status: 'pass', stdout: trunc(raw.stdout), actual: parsed.value, ms: raw.ms };
    const ok = valuesEqual(parsed.value, tc.expected);
    return {
      case: tc, status: ok ? 'pass' : 'fail', stdout: trunc(raw.stdout), actual: parsed.value,
      error: ok ? undefined : `expected ${renderValue(tc.expected)}, got ${renderValue(parsed.value)}`, ms: raw.ms,
    };
  } catch (e: any) {
    return { case: tc, status: 'error', stdout: '', error: String(e?.message || e).slice(0, 200), ms: 0 };
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
    release();
  }
};

/* ── C++ ──────────────────────────────────────────────────── */

const CPP_COMPILE_TIMEOUT_MS = 10_000;

const runCppCase = async (code: string, entry: string, tc: TestCase): Promise<CaseResult> => {
  if (!isValidEntry(entry)) return { case: tc, status: 'error', stdout: '', error: 'invalid_entry', ms: 0 };
  const program = buildCppProgram(code, entry, tc);
  if (program === null) return { case: tc, status: 'error', stdout: '', error: 'cpp_signature_unsupported', ms: 0 };
  await acquire();
  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-verify-'));
    const srcPath = path.join(tmpDir, 'main.cpp');
    const binPath = path.join(tmpDir, 'a.out');
    fs.writeFileSync(srcPath, program, { encoding: 'utf8' });
    const comp = await spawnCmd('g++', ['-std=c++17', '-O0', '-w', srcPath, '-o', binPath], tmpDir, CPP_COMPILE_TIMEOUT_MS);
    if (comp.timedOut) return { case: tc, status: 'error', stdout: '', error: `compile timed out after ${CPP_COMPILE_TIMEOUT_MS}ms`, ms: comp.ms };
    if (comp.code !== 0 || !fs.existsSync(binPath)) return { case: tc, status: 'error', stdout: '', error: `compile error: ${trunc(comp.stderr, 400) || 'g++ failed'}`, ms: comp.ms };
    const run = await spawnCmd(binPath, [], tmpDir, TIMEOUT_MS);
    if (run.timedOut) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: `timed out after ${TIMEOUT_MS}ms`, ms: run.ms };
    if (run.oversized) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: 'output limit exceeded', ms: run.ms };
    const parsed = parseDriverResult(run.stdout);
    if (!parsed.found) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: trunc(run.stderr) || `exited with code ${run.code ?? 'unknown'}`, ms: run.ms };
    if (tc.source === 'smoke') return { case: tc, status: 'pass', stdout: trunc(run.stdout), actual: parsed.value, ms: run.ms };
    const ok = valuesEqual(parsed.value, tc.expected);
    return { case: tc, status: ok ? 'pass' : 'fail', stdout: trunc(run.stdout), actual: parsed.value, error: ok ? undefined : `expected ${renderValue(tc.expected)}, got ${renderValue(parsed.value)}`, ms: run.ms };
  } catch (e: any) {
    return { case: tc, status: 'error', stdout: '', error: String(e?.message || e).slice(0, 200), ms: 0 };
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
    release();
  }
};

/* ── Java ─────────────────────────────────────────────────── */

const JAVA_COMPILE_TIMEOUT_MS = 20_000;

const runJavaCase = async (code: string, entry: string, tc: TestCase): Promise<CaseResult> => {
  if (!isValidEntry(entry)) return { case: tc, status: 'error', stdout: '', error: 'invalid_entry', ms: 0 };
  const program = buildJavaProgram(code, entry, tc);
  if (program === null) return { case: tc, status: 'error', stdout: '', error: 'java_signature_unsupported', ms: 0 };
  await acquire();
  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-verify-'));
    const srcPath = path.join(tmpDir, 'Main.java');
    fs.writeFileSync(srcPath, program, { encoding: 'utf8' });
    const comp = await spawnCmd('javac', ['-d', tmpDir, srcPath], tmpDir, JAVA_COMPILE_TIMEOUT_MS);
    if (comp.timedOut) return { case: tc, status: 'error', stdout: '', error: `compile timed out after ${JAVA_COMPILE_TIMEOUT_MS}ms`, ms: comp.ms };
    if (comp.code !== 0 || !fs.existsSync(path.join(tmpDir, 'Main.class'))) return { case: tc, status: 'error', stdout: '', error: `compile error: ${trunc(comp.stderr, 400) || 'javac failed'}`, ms: comp.ms };
    const run = await spawnCmd('java', ['-cp', tmpDir, 'Main'], tmpDir, TIMEOUT_MS);
    if (run.timedOut) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: `timed out after ${TIMEOUT_MS}ms`, ms: run.ms };
    if (run.oversized) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: 'output limit exceeded', ms: run.ms };
    const parsed = parseDriverResult(run.stdout);
    if (!parsed.found) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: trunc(run.stderr) || `exited with code ${run.code ?? 'unknown'}`, ms: run.ms };
    if (tc.source === 'smoke') return { case: tc, status: 'pass', stdout: trunc(run.stdout), actual: parsed.value, ms: run.ms };
    const ok = valuesEqual(parsed.value, tc.expected);
    return { case: tc, status: ok ? 'pass' : 'fail', stdout: trunc(run.stdout), actual: parsed.value, error: ok ? undefined : `expected ${renderValue(tc.expected)}, got ${renderValue(parsed.value)}`, ms: run.ms };
  } catch (e: any) {
    return { case: tc, status: 'error', stdout: '', error: String(e?.message || e).slice(0, 200), ms: 0 };
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
    release();
  }
};

/* ── SQL ──────────────────────────────────────────────────── */

const SQL_TIMEOUT_MS = 4_000;

export const runSqlCase = async (
  query: string, spec: SqlSpec,
): Promise<CaseResult> => {
  const tc: TestCase = { input: [], expected: spec.expected, source: 'problem' };
  const script = buildSqlScript(query, spec.schema, spec.seeds || []);
  if (script === null) return { case: tc, status: 'error', stdout: '', error: 'sql_not_verifiable', ms: 0 };
  await acquire();
  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-verify-'));
    const scriptPath = path.join(tmpDir, 'script.sql');
    fs.writeFileSync(scriptPath, script, { encoding: 'utf8' });
    const run = await spawnCmd('sqlite3', ['-safe', '-bail', ':memory:'], tmpDir, SQL_TIMEOUT_MS, scriptPath);
    if (run.timedOut) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: `timed out after ${SQL_TIMEOUT_MS}ms`, ms: run.ms };
    if (run.oversized) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: 'output limit exceeded', ms: run.ms };
    if (run.code !== 0) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: `sql error: ${trunc(run.stderr, 300) || `exit ${run.code}`}`, ms: run.ms };
    const parsed = parseSqlRows(run.stdout);
    if (!parsed.found || !parsed.rows) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: 'sql result not parseable', ms: run.ms };
    const ok = compareResultSet(parsed.rows, spec.expected, spec.ordered === true);
    return { case: tc, status: ok ? 'pass' : 'fail', stdout: trunc(run.stdout), actual: parsed.rows, error: ok ? undefined : `expected ${renderValue(spec.expected)}, got ${renderValue(parsed.rows)}`, ms: run.ms };
  } catch (e: any) {
    return { case: tc, status: 'error', stdout: '', error: String(e?.message || e).slice(0, 200), ms: 0 };
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
    release();
  }
};

/* ── Go ───────────────────────────────────────────────────── */

const GO_RUN_TIMEOUT_MS = 15_000;

const runGoCase = async (code: string, entry: string, tc: TestCase): Promise<CaseResult> => {
  if (!isValidEntry(entry)) return { case: tc, status: 'error', stdout: '', error: 'invalid_entry', ms: 0 };
  const program = buildGoProgram(code, entry, tc);
  if (program === null) return { case: tc, status: 'error', stdout: '', error: 'go_signature_unsupported', ms: 0 };
  await acquire();
  let tmpDir = '';
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-verify-'));
    const srcPath = path.join(tmpDir, 'main.go');
    fs.writeFileSync(srcPath, program, { encoding: 'utf8' });
    const run = await spawnCmd('go', ['run', srcPath], tmpDir, GO_RUN_TIMEOUT_MS);
    if (run.timedOut) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: `timed out after ${GO_RUN_TIMEOUT_MS}ms`, ms: run.ms };
    if (run.oversized) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: 'output limit exceeded', ms: run.ms };
    const parsed = parseDriverResult(run.stdout);
    if (!parsed.found) return { case: tc, status: 'error', stdout: trunc(run.stdout), error: trunc(run.stderr) || `exited with code ${run.code ?? 'unknown'}`, ms: run.ms };
    if (tc.source === 'smoke') return { case: tc, status: 'pass', stdout: trunc(run.stdout), actual: parsed.value, ms: run.ms };
    const ok = valuesEqual(parsed.value, tc.expected);
    return { case: tc, status: ok ? 'pass' : 'fail', stdout: trunc(run.stdout), actual: parsed.value, error: ok ? undefined : `expected ${renderValue(tc.expected)}, got ${renderValue(parsed.value)}`, ms: run.ms };
  } catch (e: any) {
    return { case: tc, status: 'error', stdout: '', error: String(e?.message || e).slice(0, 200), ms: 0 };
  } finally {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ } }
    release();
  }
};
