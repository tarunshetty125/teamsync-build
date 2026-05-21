// electron/intelligence/adaptive/ModeClassifier.ts
// Keyword-based mode classification.
//
// Pure function — no state, no side effects, no external dependencies.
// Takes raw text and returns confidence scores for each mode.
//
// The keyword maps are intentionally simple (uniform weights) for v1.
// A future version may use learned weights or semantic similarity.

import type { ModeTemplateId } from '../../../src/lib/modes/types';
import type { ModeConfidenceScore, ModeClassifierConfig } from './types';

// ---------------------------------------------------------------------------
// Keyword Maps
// ---------------------------------------------------------------------------

const MODE_KEYWORDS: Record<ModeTemplateId, readonly string[]> = {
    sales: [
        'deal', 'pricing', 'objection', 'prospect', 'pipeline', 'close',
        'demo', 'revenue', 'quota', 'discount', 'contract', 'rfp', 'roi',
        'upsell', 'renewal', 'churn', 'arr', 'mrr', 'acv', 'proposal',
        'procurement', 'budget', 'stakeholder', 'champion', 'decision maker',
    ],
    recruiting: [
        'candidate', 'hire', 'interview', 'resume', 'role', 'culture fit',
        'compensation', 'offer', 'background check', 'onboarding', 'headcount',
        'scorecard', 'panel', 'debrief', 'talent', 'referral', 'job description',
        'leveling', 'rubric', 'signal',
    ],
    'team-meet': [
        'standup', 'sprint', 'retro', 'blocker', 'action item', 'owner',
        'deadline', 'status update', 'okr', 'roadmap', 'milestone',
        'dependency', 'decision', 'sync', 'follow up', 'deliverable',
        'priority', 'capacity', 'velocity',
    ],
    lecture: [
        'concept', 'theorem', 'equation', 'formula', 'chapter', 'example',
        'homework', 'midterm', 'final exam', 'professor', 'lecture',
        'syllabus', 'study', 'textbook', 'quiz', 'assignment', 'grade',
        'prerequisite', 'curriculum',
    ],
    'technical-interview': [
        'algorithm', 'data structure', 'complexity', 'leetcode', 'system design',
        'coding', 'implement', 'optimize', 'edge case', 'brute force',
        'hash map', 'binary search', 'bfs', 'dfs', 'dynamic programming',
        'recursion', 'big o', 'time complexity', 'space complexity',
        'linked list', 'tree', 'graph', 'stack', 'queue', 'heap',
    ],
    'looking-for-work': [
        'apply', 'job search', 'resume', 'cover letter', 'networking',
        'linkedin', 'recruiter', 'salary negotiation', 'offer letter',
        'behavioral question', 'star method', 'portfolio', 'referral',
        'career', 'job posting', 'application',
    ],
    general: [], // Fallback — no keywords, gets baseline score
};

// ---------------------------------------------------------------------------
// Default Config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Readonly<ModeClassifierConfig> = {
    confidenceThreshold: 0.6,
    smoothingWindowSize: 5,
    debounceMs: 2_000,
    minTranscriptLength: 50,
};

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify text into mode confidence scores.
 *
 * For each mode, counts how many of its keywords appear in the text.
 * Scores are normalized so they sum to 1.0.
 *
 * Returns ALL modes sorted by confidence descending.
 */
export function classifyMode(
    text: string,
    config?: Partial<ModeClassifierConfig>,
): ModeConfidenceScore[] {
    const merged = { ...DEFAULT_CONFIG, ...config };
    const normalizedText = text.toLowerCase();

    if (normalizedText.length < merged.minTranscriptLength) {
        return buildUniformScores();
    }

    const rawScores: Array<{
        modeId: ModeTemplateId;
        matchCount: number;
        matchedKeywords: string[];
    }> = [];

    let totalMatches = 0;

    for (const [modeId, keywords] of Object.entries(MODE_KEYWORDS) as Array<[ModeTemplateId, readonly string[]]>) {
        if (keywords.length === 0) continue;

        const matchedKeywords: string[] = [];
        for (const keyword of keywords) {
            if (normalizedText.includes(keyword)) {
                matchedKeywords.push(keyword);
            }
        }

        rawScores.push({
            modeId,
            matchCount: matchedKeywords.length,
            matchedKeywords,
        });
        totalMatches += matchedKeywords.length;
    }

    // No matches at all — return uniform distribution
    if (totalMatches === 0) {
        return buildUniformScores();
    }

    // Normalize to sum = 1.0
    const scores: ModeConfidenceScore[] = rawScores
        .map(({ modeId, matchCount, matchedKeywords }) => ({
            modeId,
            confidence: matchCount / totalMatches,
            signalCount: matchCount,
            topKeywords: matchedKeywords.slice(0, 5),
        }))
        .sort((a, b) => b.confidence - a.confidence);

    // Add 'general' with remaining confidence
    const nonGeneralSum = scores.reduce((sum, s) => sum + s.confidence, 0);
    const generalScore: ModeConfidenceScore = {
        modeId: 'general',
        confidence: Math.max(0, 1 - nonGeneralSum),
        signalCount: 0,
        topKeywords: [],
    };

    return [...scores, generalScore].sort((a, b) => b.confidence - a.confidence);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_MODE_IDS: readonly ModeTemplateId[] = [
    'general', 'sales', 'recruiting', 'team-meet',
    'looking-for-work', 'lecture', 'technical-interview',
];

function buildUniformScores(): ModeConfidenceScore[] {
    const uniform = 1 / ALL_MODE_IDS.length;
    return ALL_MODE_IDS.map(modeId => ({
        modeId,
        confidence: uniform,
        signalCount: 0,
        topKeywords: [],
    }));
}
