// electron/intelligence/prompt/ModePromptBudget.ts
// Mode-aware prompt budget configuration.
//
// Defines which insights to prioritize per mode and enforces
// a hard token growth cap of +12%.
//
// Pure function — no state, no side effects.
//
// Contract:
//   ✅ Pure function
//   ✅ Deterministic
//   ❌ No LLM, no network, no async

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptBudget {
    /** Insight labels to prefer for this mode (in priority order) */
    readonly priorityInsightLabels: readonly string[];
    /** Hard cap on insight token growth (approximate) */
    readonly maxInsightTokens: number;
    /** Maximum prompt growth percentage (+12% cap) */
    readonly maxGrowthPercent: number;
}

// ---------------------------------------------------------------------------
// Mode Budget Definitions
// ---------------------------------------------------------------------------

const MODE_BUDGETS: Readonly<Record<string, PromptBudget>> = {
    technical_interview: {
        priorityInsightLabels: [
            'correctness',
            'depth',
            'communication',
            'system-design',
            'confidence',
        ],
        maxInsightTokens: 120,
        maxGrowthPercent: 12,
    },
    sales: {
        priorityInsightLabels: [
            'buying-signal',
            'objection',
            'urgency',
            'pricing-pressure',
            'competitor',
        ],
        maxInsightTokens: 100,
        maxGrowthPercent: 12,
    },
    recruiting: {
        priorityInsightLabels: [
            'star',
            'impact',
            'red-flag',
            'ownership',
            'communication',
        ],
        maxInsightTokens: 100,
        maxGrowthPercent: 12,
    },
    team_meeting: {
        priorityInsightLabels: [
            'decision',
            'owner',
            'deadline',
            'blocker',
            'action-item',
        ],
        maxInsightTokens: 100,
        maxGrowthPercent: 12,
    },
};

const DEFAULT_BUDGET: PromptBudget = {
    priorityInsightLabels: [],
    maxInsightTokens: 80,
    maxGrowthPercent: 12,
};

// ---------------------------------------------------------------------------
// getModeBudget
// ---------------------------------------------------------------------------

/**
 * Get the prompt budget for a mode.
 *
 * Returns mode-specific insight priorities and token limits.
 * Falls back to default budget for unknown modes.
 */
export function getModeBudget(modeId: string): PromptBudget {
    return MODE_BUDGETS[modeId] ?? DEFAULT_BUDGET;
}

/**
 * Check if a compressed insight label matches a priority label.
 * Matches by prefix: "correctness: strong" matches priority "correctness".
 */
export function isInsightPriority(compressedLabel: string, budget: PromptBudget): boolean {
    const labelPrefix = compressedLabel.split(':')[0]?.trim().toLowerCase() ?? '';
    return budget.priorityInsightLabels.some(p => p.toLowerCase() === labelPrefix);
}

/**
 * Estimate token count from text (rough: ~4 chars per token).
 */
export function estimateInsightTokens(text: string): number {
    return Math.ceil(text.length / 4);
}
