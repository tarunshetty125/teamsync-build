// electron/llm/liveDeadlines.ts
// Latency budgets and deadline enforcement for live streaming answers.

/* ── Budget Constants ─────────────────────────────────────── */

export const LIVE_FIRST_USEFUL_BUDGET_MS: Record<string, number> = {
  direct: 1200,
  medium: 1800,
  hard: 2500,
  very_hard: 3500,
};

export const LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS = 3500;
export const LIVE_PROVIDER_FIRST_USEFUL_COMPLEX_TIMEOUT_MS = 5000;
export const LIVE_TOTAL_HARD_TIMEOUT_MS = 8000;
export const LIVE_INTER_TOKEN_STALL_MS = 8000;
export const BENCHMARK_PER_QUESTION_HARD_TIMEOUT_MS = 30000;

/* ── Answer type → deadline ───────────────────────────────── */

const COMPLEX_TYPES = new Set([
  'coding_question_answer',
  'dsa_question_answer',
  'system_design_answer',
  'debugging_question_answer',
]);

export function firstUsefulDeadlineMs(answerType: string): number {
  return COMPLEX_TYPES.has(answerType)
    ? LIVE_PROVIDER_FIRST_USEFUL_COMPLEX_TIMEOUT_MS
    : LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS;
}

/* ── Stream Race ──────────────────────────────────────────── */

export type StreamRaceResult = 'done' | 'first_useful_timeout' | 'stall_timeout' | 'aborted';

export interface RaceStreamOptions<T> {
  stream: AsyncIterable<T>;
  firstUsefulDeadlineMs: number;
  interTokenStallMs?: number;
  isSpeculative?: boolean;
  onToken: (token: T) => void | Promise<void>;
  isUsefulYet: () => boolean;
  onFirstUsefulTimeout?: () => void;
  onStallTimeout?: () => void;
  shouldAbort?: () => boolean;
  onCleanup?: () => void;
}

const DEADLINE = Symbol('deadline');

/**
 * Races a stream against latency deadlines.
 * - Before first useful output: enforced `firstUsefulDeadlineMs` timeout
 * - After first useful output: enforced `interTokenStallMs` between tokens
 * - Speculative streams bypass deadlines (no timeouts)
 */
export async function raceStreamWithDeadline<T>(opts: RaceStreamOptions<T>): Promise<StreamRaceResult> {
  const {
    stream,
    firstUsefulDeadlineMs: fuMs,
    interTokenStallMs = LIVE_INTER_TOKEN_STALL_MS,
    isSpeculative = false,
    onToken,
    isUsefulYet,
    onFirstUsefulTimeout,
    onStallTimeout,
    shouldAbort,
    onCleanup,
  } = opts;

  const iterator = stream[Symbol.asyncIterator]();
  const start = Date.now();
  let lastTokenAt = start;
  let useful = false;

  const cleanup = () => {
    try { onCleanup?.(); } catch { /* noop */ }
    try {
      const p = iterator.return?.(undefined);
      if (p && typeof p.then === 'function') p.catch(() => { /* noop */ });
    } catch { /* noop */ }
  };

  try {
    while (true) {
      if (shouldAbort?.()) {
        cleanup();
        return 'aborted';
      }

      let res: IteratorResult<T>;

      if (!isSpeculative) {
        if (!useful) useful = isUsefulYet();
        const remaining = !useful
          ? Math.max(50, fuMs - (Date.now() - start))
          : Math.max(50, interTokenStallMs - (Date.now() - lastTokenAt));

        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<typeof DEADLINE>(r => {
          timer = setTimeout(() => r(DEADLINE), remaining);
        });
        const nextP = iterator.next();
        (nextP as Promise<any>).catch(() => { /* noop */ });

        const raceResult = await Promise.race([nextP, deadline]);
        if (timer) clearTimeout(timer);

        if (raceResult === DEADLINE) {
          cleanup();
          if (!useful) {
            onFirstUsefulTimeout?.();
            return 'first_useful_timeout';
          }
          onStallTimeout?.();
          return 'stall_timeout';
        }
        res = raceResult as IteratorResult<T>;
      } else {
        res = await iterator.next();
      }

      if (res.done) {
        cleanup();
        return 'done';
      }
      lastTokenAt = Date.now();
      await onToken(res.value);
      if (!useful) useful = isUsefulYet();
    }
  } catch (e) {
    cleanup();
    throw e;
  }
}
