// electron/intelligence/adaptive/SpeakerPatternSignal.ts
// Detects speaker patterns for mode classification hints.
//
// Pure function — no state, no side effects, no external dependencies.
// Uses lightweight regex heuristics to detect:
//   - Interviewer vs candidate asymmetry
//   - Monologue vs dialogue
//   - Multi-party participation
//
// Contract:
//   ✅ Pure function
//   ✅ Deterministic
//   ✅ <1ms execution
//   ❌ No LLM, no network, no async, no diarization

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

export interface SpeakerPatternResult {
    /** Number of distinct speakers detected */
    readonly speakerCount: number;
    /** Whether conversation is Q&A asymmetric (one asks, other answers) */
    readonly isQAAsymmetric: boolean;
    /** Whether a single speaker dominates (>70% of lines) */
    readonly isMonologue: boolean;
    /** Whether there are 3+ speakers */
    readonly isMultiParty: boolean;
    /** Question density: questions per 1000 characters */
    readonly questionDensity: number;
    /** Mode hints derived from speaker patterns (0–1 scores) */
    readonly modeHints: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Speaker line pattern: "[Name]:", "Name:", "SPEAKER:", etc.
// ---------------------------------------------------------------------------

const SPEAKER_LINE_RE = /^[\[\(]?([A-Z][A-Za-z\s]{1,30})[\]\)]?\s*:/gm;
const QUESTION_RE = /\?/g;

// ---------------------------------------------------------------------------
// detectSpeakerPattern
// ---------------------------------------------------------------------------

/**
 * Detect speaker patterns from transcript text.
 *
 * Returns mode hints:
 *   - High Q&A asymmetry + 2 speakers → interview signal
 *   - Monologue → lecture signal
 *   - Multi-party → team meeting signal
 */
export function detectSpeakerPattern(text: string): SpeakerPatternResult {
    // Count distinct speakers
    const speakers = new Map<string, number>();
    let match: RegExpExecArray | null;
    const speakerRe = new RegExp(SPEAKER_LINE_RE.source, SPEAKER_LINE_RE.flags);

    while ((match = speakerRe.exec(text)) !== null) {
        const name = match[1].trim().toLowerCase();
        speakers.set(name, (speakers.get(name) ?? 0) + 1);
    }

    const speakerCount = speakers.size;
    const totalLines = Math.max(1, Array.from(speakers.values()).reduce((a, b) => a + b, 0));

    // Monologue detection: one speaker has >70% of lines
    let isMonologue = false;
    for (const count of speakers.values()) {
        if (count / totalLines > 0.7) {
            isMonologue = true;
            break;
        }
    }

    // Question density
    const questionMatches = text.match(QUESTION_RE) ?? [];
    const questionDensity = (questionMatches.length / Math.max(text.length, 1)) * 1000;

    // Q&A asymmetry: 2 speakers, one asks more questions
    const isQAAsymmetric = speakerCount === 2 && questionDensity > 3;

    const isMultiParty = speakerCount >= 3;

    // Compute mode hints
    const modeHints: Record<string, number> = {};

    // Monologue → lecture
    modeHints['lecture'] = isMonologue && speakerCount <= 1 ? 0.7 : 0;

    // Q&A asymmetry + 2 speakers → interview
    modeHints['technical-interview'] = isQAAsymmetric ? 0.6 : 0;
    modeHints['recruiting'] = isQAAsymmetric ? 0.4 : 0;

    // Multi-party → team meeting
    modeHints['team-meet'] = isMultiParty ? 0.7 : (speakerCount === 2 ? 0.2 : 0);

    // Sales: 2-person dialogue + moderate questions
    modeHints['sales'] = speakerCount === 2 && !isQAAsymmetric && questionDensity > 1 ? 0.3 : 0;

    return {
        speakerCount,
        isQAAsymmetric,
        isMonologue,
        isMultiParty,
        questionDensity: Math.round(questionDensity * 100) / 100,
        modeHints,
    };
}
