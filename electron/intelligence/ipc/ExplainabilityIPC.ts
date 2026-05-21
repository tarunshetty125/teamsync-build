// electron/intelligence/ipc/ExplainabilityIPC.ts
// IPC bridge for surfacing explainability data.
//
// Uses existing ExplainabilityEngine + ExplanationFormatter to produce
// renderer-ready explanation payloads.
//
// Rules:
//   - Capability-gated via 'explainabilityUI'
//   - Pre-formats both compact and expanded strings (no renderer-side formatting)
//   - No markdown, no HTML injection — plain text only
//   - Lazy — only formats when requested
//
// Memory safety:
//   - lastPayload is single-entry (overwrite, never accumulate)
//   - Payload strings are truncated to MAX_STRING_LENGTH (4096 chars)
//   - Factors and concerns arrays are capped at MAX_ARRAY_ENTRIES (10)
//
// IPC Channel: 'intelligence:explanation'

import { BrowserWindow } from 'electron';
import type { ExplanationPayload } from './types';
import type { SubBrainInsight } from '../multibrain/types';
import type { Explanation } from '../explainability/types';
import { explain } from '../explainability/ExplainabilityEngine';
import { formatCompact, formatExpanded } from '../explainability/ExplanationFormatter';
import { CapabilityRegistry } from '../capability/CapabilityRegistry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHANNEL = 'intelligence:explanation';

/** Maximum character length for pre-rendered string fields (compact, expanded) */
const MAX_STRING_LENGTH = 4096;

/** Maximum number of factor/concern entries retained in a payload */
const MAX_ARRAY_ENTRIES = 10;

// ---------------------------------------------------------------------------
// ExplainabilityIPC
// ---------------------------------------------------------------------------

export class ExplainabilityIPC {
    private static instance: ExplainabilityIPC | null = null;

    /**
     * Single-entry payload cache.
     * MEMORY BOUND: Always exactly 0 or 1 entry — overwritten on each call,
     * never accumulated. Payload fields are truncated via truncatePayload().
     */
    private lastPayload: ExplanationPayload | null = null;

    private constructor() {}

    static getInstance(): ExplainabilityIPC {
        if (!ExplainabilityIPC.instance) {
            ExplainabilityIPC.instance = new ExplainabilityIPC();
        }
        return ExplainabilityIPC.instance;
    }

    /**
     * Returns the most recently generated explanation payload, or null.
     * Used by the renderer→main IPC handler for on-demand retrieval.
     */
    getLastExplanation(): ExplanationPayload | null {
        return this.lastPayload;
    }

    /**
     * Explicitly clear the cached payload.
     * Can be called on session reset or mode switch to free memory.
     */
    clearLastExplanation(): void {
        this.lastPayload = null;
    }

    /**
     * Generate and send explanation for an insight.
     *
     * Returns the explanation payload if sent, null if suppressed.
     */
    explainInsight(
        insight: SubBrainInsight,
        sourceBrain: string,
    ): ExplanationPayload | null {
        if (!CapabilityRegistry.getInstance().isEnabled('explainabilityUI')) {
            return null;
        }

        try {
            const explanation = explain(insight, sourceBrain);
            if (!explanation) return null;

            const payload = this.truncatePayload(this.toPayload(explanation));
            this.lastPayload = payload;

            // Broadcast
            for (const win of BrowserWindow.getAllWindows()) {
                if (!win.isDestroyed()) {
                    win.webContents.send(CHANNEL, payload);
                }
            }

            return payload;
        } catch {
            return null;
        }
    }

    /**
     * Generate and send explanations for multiple insights.
     * Returns array of payloads that were sent (filters nulls).
     */
    explainInsights(
        insights: readonly SubBrainInsight[],
        sourceBrain: string,
    ): ExplanationPayload[] {
        if (!CapabilityRegistry.getInstance().isEnabled('explainabilityUI')) {
            return [];
        }

        try {
            const payloads: ExplanationPayload[] = [];

            for (const insight of insights) {
                const explanation = explain(insight, sourceBrain);
                if (!explanation) continue;
                payloads.push(this.truncatePayload(this.toPayload(explanation)));
            }

            if (payloads.length === 0) return [];

            this.lastPayload = payloads[payloads.length - 1];

            // Broadcast batch
            for (const win of BrowserWindow.getAllWindows()) {
                if (!win.isDestroyed()) {
                    win.webContents.send(CHANNEL, payloads);
                }
            }

            return payloads;
        } catch {
            return [];
        }
    }

    /**
     * Convert an Explanation to a renderer-ready payload.
     * Pre-renders both compact and expanded formats.
     */
    private toPayload(explanation: Explanation): ExplanationPayload {
        return {
            summary: explanation.summary,
            score: explanation.score,
            factors: explanation.factors.map(f => ({
                name: f.name,
                impact: f.impact,
                detail: f.detail,
            })),
            concerns: [...explanation.concerns],
            sourceBrain: explanation.sourceBrain,
            compact: formatCompact(explanation),
            expanded: formatExpanded(explanation),
        };
    }

    /**
     * Apply memory safety bounds to a payload.
     * Truncates string fields and caps array lengths to prevent
     * a single oversized explanation from consuming excessive memory.
     */
    private truncatePayload(payload: ExplanationPayload): ExplanationPayload {
        return {
            summary: payload.summary.slice(0, MAX_STRING_LENGTH),
            score: payload.score,
            factors: payload.factors.slice(0, MAX_ARRAY_ENTRIES),
            concerns: payload.concerns.slice(0, MAX_ARRAY_ENTRIES),
            sourceBrain: payload.sourceBrain,
            compact: payload.compact.slice(0, MAX_STRING_LENGTH),
            expanded: payload.expanded.slice(0, MAX_STRING_LENGTH),
        };
    }
}

