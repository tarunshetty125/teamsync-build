// electron/intelligence/multibrain/ParallelExecutor.ts
//
// @future — Reserved for async semantic sub-brains (embeddings, LLM-scored).
//
// NOT used on the current hot path. All v1 sub-brains are synchronous
// heuristics executed via a simple for-loop in ModeBrains.runSubBrains().
//
// This executor exists for the future case where sub-brains need:
//   - Async inference (local embeddings, Ollama, model logprobs)
//   - True parallel execution across workers
//   - Hard timeout enforcement on non-trivial compute
//
// Until then, the sync for-loop is the correct architectural choice
// because Brain.execute() is a sync, pure, deterministic contract.
//
// Usage (when activated):
//   const executor = new ParallelExecutor();
//   const results = await executor.execute(subBrains, input);

import type {
    SubBrain,
    SubBrainInput,
    SubBrainOutput,
    SubBrainExecutionResult,
} from './types';

// ---------------------------------------------------------------------------
// ParallelExecutor
// ---------------------------------------------------------------------------

export class ParallelExecutor {
    /**
     * Execute all sub-brains with timeout and failure isolation.
     *
     * Returns results for every brain — successes, failures, and timeouts.
     * Never throws. Partial success is the norm.
     */
    async execute(
        brains: readonly SubBrain[],
        input: SubBrainInput,
        abortSignal?: AbortSignal,
    ): Promise<SubBrainExecutionResult[]> {
        if (brains.length === 0) {
            return [];
        }

        const promises = brains.map(brain =>
            this.executeSingle(brain, input, abortSignal),
        );

        const settled = await Promise.allSettled(promises);

        return settled.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            }
            // This shouldn't happen since executeSingle never throws,
            // but handle defensively
            return {
                brainId: brains[index].id,
                status: 'failure' as const,
                error: String(result.reason),
                executionMs: 0,
            };
        });
    }

    /**
     * Execute a single sub-brain with timeout.
     * Never throws — always returns a SubBrainExecutionResult.
     */
    private executeSingle(
        brain: SubBrain,
        input: SubBrainInput,
        abortSignal?: AbortSignal,
    ): Promise<SubBrainExecutionResult> {
        return new Promise<SubBrainExecutionResult>((resolve) => {
            // Check abort before starting
            if (abortSignal?.aborted) {
                resolve({
                    brainId: brain.id,
                    status: 'failure',
                    error: 'Aborted before execution',
                    executionMs: 0,
                });
                return;
            }

            const timeoutMs = brain.timeoutMs;
            let settled = false;

            // Timeout handler
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve({
                        brainId: brain.id,
                        status: 'timeout',
                        error: `Timed out after ${timeoutMs}ms`,
                        executionMs: timeoutMs,
                    });
                }
            }, timeoutMs);

            // Execute synchronously, wrapped for safety
            const startMs = performance.now();
            try {
                const output: SubBrainOutput = brain.execute(input);
                const executionMs = Math.round((performance.now() - startMs) * 100) / 100;

                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    resolve({
                        brainId: brain.id,
                        status: 'success',
                        output,
                        executionMs,
                    });
                }
            } catch (err: unknown) {
                const executionMs = Math.round((performance.now() - startMs) * 100) / 100;

                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    resolve({
                        brainId: brain.id,
                        status: 'failure',
                        error: err instanceof Error ? err.message : String(err),
                        executionMs,
                    });
                }
            }
        });
    }
}
