// electron/intelligence/prompt/SignalCompressor.ts
// Compresses multi-brain insight labels for prompt injection.
//
// Pure function — no state, no side effects.
// Maintains interpretability: readable prompts only.
//
// Compresses LABELS ONLY. Never compresses:
//   - reasoning
//   - evidence
//   - concerns
//   - explanations
//
// Contract:
//   ✅ Pure function
//   ✅ Deterministic
//   ❌ No LLM, no network, no async

// ---------------------------------------------------------------------------
// Compression Dictionary
// ---------------------------------------------------------------------------

const LABEL_COMPRESSIONS: ReadonlyMap<string, string> = new Map([
    // Team Meeting
    ['Decision Identified', 'decision: identified'],
    ['Approval detected', 'approval: detected'],
    ['Commitment detected', 'commitment: detected'],
    ['Owner Identified', 'owner: identified'],
    ['Ownership discussed', 'ownership: discussed'],
    ['Blocker Identified', 'blocker: identified'],
    ['Waiting state detected', 'waiting: detected'],
    ['Dependency flagged', 'dependency: flagged'],
    ['Risk flagged', 'risk: flagged'],
    ['Deadline mentioned', 'deadline: mentioned'],
    ['Deadline language detected', 'deadline: detected'],
    ['Urgency detected', 'urgency: detected'],
    ['Action Item', 'action-item: identified'],
    ['Follow-up needed', 'follow-up: needed'],
    ['Task identified', 'task: identified'],
    ['Commitment to act', 'commitment: action'],

    // Technical Interview
    ['Correct technical reasoning', 'correctness: strong'],
    ['Self-correction detected', 'self-correction: detected'],
    ['Likely incorrect claim', 'correctness: concern'],
    ['Possible correctness concern', 'correctness: possible-concern'],
    ['Uncertain reasoning', 'reasoning: uncertain'],
    ['Deep technical understanding', 'depth: deep'],
    ['Moderate technical depth', 'depth: moderate'],
    ['Surface-level explanation', 'depth: surface'],
    ['Low communication confidence', 'confidence: low'],
    ['Strong communication confidence', 'confidence: strong'],
    ['Mixed communication confidence', 'confidence: mixed'],
    ['Strong system design reasoning', 'system-design: strong'],
    ['Moderate system design reasoning', 'system-design: moderate'],
    ['Basic system design reasoning', 'system-design: basic'],
    ['Strong explanation quality', 'communication: strong'],
    ['Communication clarity concern', 'communication: concern'],
    ['Moderate explanation quality', 'communication: moderate'],

    // Sales
    ['Buying signal detected', 'buying-signal: detected'],
    ['Objection detected', 'objection: detected'],
    ['Pricing pressure detected', 'pricing-pressure: detected'],
    ['Urgency signal detected', 'urgency: detected'],
    ['Competitor mentioned', 'competitor: mentioned'],

    // Recruiting
    ['STAR structure detected', 'star: detected'],
    ['Impact statement detected', 'impact: detected'],
    ['Red flag detected', 'red-flag: detected'],
]);

// ---------------------------------------------------------------------------
// compressInsightLabel
// ---------------------------------------------------------------------------

/**
 * Compress an insight label for prompt injection.
 *
 * Uses dictionary lookup for known labels.
 * Falls back to truncation (50 chars) for unknown labels.
 *
 * Only compresses labels. Never compresses reasoning, evidence, or explanations.
 */
export function compressInsightLabel(label: string): string {
    // Exact match
    const compressed = LABEL_COMPRESSIONS.get(label);
    if (compressed) return compressed;

    // Case-insensitive fallback
    for (const [key, value] of LABEL_COMPRESSIONS) {
        if (key.toLowerCase() === label.toLowerCase()) {
            return value;
        }
    }

    // Unknown label: truncate but keep readable
    if (label.length > 50) {
        return label.slice(0, 47) + '...';
    }
    return label;
}

/**
 * Compress multiple labels. Returns the compressed versions.
 */
export function compressInsightLabels(labels: readonly string[]): string[] {
    return labels.map(compressInsightLabel);
}
