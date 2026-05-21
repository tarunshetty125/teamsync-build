// electron/intelligence/adaptive/TranscriptDensitySignal.ts
// Measures keyword density per mode category.
//
// Pure function — no state, no side effects, no external dependencies.
// Returns normalized 0–1 density scores per mode.
//
// Density = keyword hits per 1000 characters (more stable than raw count).
//
// Contract:
//   ✅ Pure function
//   ✅ Deterministic
//   ✅ <1ms execution
//   ❌ No LLM, no network, no async

import type { ModeTemplateId } from '../../../src/lib/modes/types';

// ---------------------------------------------------------------------------
// Mode Density Keyword Maps (weighted toward high-signal terms)
// ---------------------------------------------------------------------------

const DENSITY_KEYWORDS: Record<string, readonly string[]> = {
    sales: [
        'deal', 'pricing', 'objection', 'prospect', 'close', 'demo', 'revenue',
        'quota', 'discount', 'contract', 'roi', 'proposal', 'budget', 'champion',
    ],
    recruiting: [
        'candidate', 'hire', 'interview', 'resume', 'compensation', 'offer',
        'onboarding', 'headcount', 'scorecard', 'panel', 'debrief', 'rubric',
    ],
    'team-meet': [
        'standup', 'sprint', 'blocker', 'action item', 'owner', 'deadline',
        'status update', 'okr', 'roadmap', 'milestone', 'dependency', 'sync',
    ],
    'technical-interview': [
        'algorithm', 'data structure', 'complexity', 'system design', 'optimize',
        'edge case', 'hash map', 'binary search', 'dynamic programming',
        'big o', 'time complexity', 'space complexity',
    ],
    lecture: [
        'concept', 'theorem', 'equation', 'formula', 'homework', 'exam',
        'professor', 'lecture', 'syllabus', 'textbook', 'quiz', 'assignment',
    ],
    'looking-for-work': [
        'apply', 'job search', 'resume', 'cover letter', 'networking',
        'linkedin', 'salary negotiation', 'portfolio', 'job posting',
    ],
};

// ---------------------------------------------------------------------------
// Density Result
// ---------------------------------------------------------------------------

export interface TranscriptDensityResult {
    readonly scores: Record<string, number>;
    readonly dominantMode: string | null;
    readonly dominantDensity: number;
}

// ---------------------------------------------------------------------------
// computeTranscriptDensity
// ---------------------------------------------------------------------------

/**
 * Compute keyword density per mode.
 *
 * Density = (keyword hits / text length) × 1000
 * Normalized to 0–1 range via sigmoid-like curve.
 *
 * @returns Scores per mode (0–1), dominant mode, and its density
 */
export function computeTranscriptDensity(text: string): TranscriptDensityResult {
    const normalized = text.toLowerCase();
    const textLength = Math.max(normalized.length, 1);

    const scores: Record<string, number> = {};
    let maxScore = 0;
    let dominantMode: string | null = null;

    for (const [modeId, keywords] of Object.entries(DENSITY_KEYWORDS)) {
        let hitCount = 0;
        for (const keyword of keywords) {
            // Count occurrences (not just presence)
            let searchFrom = 0;
            while (true) {
                const idx = normalized.indexOf(keyword, searchFrom);
                if (idx === -1) break;
                hitCount++;
                searchFrom = idx + keyword.length;
            }
        }

        // Density per 1000 characters
        const rawDensity = (hitCount / textLength) * 1000;

        // Normalize: sigmoid-like mapping to 0–1
        // density of 5 hits/1000 chars ≈ 0.5, 15 ≈ 0.88
        const normalizedScore = 1 - 1 / (1 + rawDensity / 5);

        scores[modeId] = Math.round(normalizedScore * 1000) / 1000;

        if (normalizedScore > maxScore) {
            maxScore = normalizedScore;
            dominantMode = modeId;
        }
    }

    return {
        scores,
        dominantMode: maxScore > 0.1 ? dominantMode : null,
        dominantDensity: maxScore,
    };
}
