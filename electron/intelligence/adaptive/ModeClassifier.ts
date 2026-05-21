// electron/intelligence/adaptive/ModeClassifier.ts
// Keyword-based mode classification.
//
// Pure function — no state, no side effects, no external dependencies.
// Takes raw text and returns confidence scores for each mode.
//
// The keyword maps are intentionally simple (uniform weights) for v1.
// v2 (classifyModeV2) adds density, speaker, and question type signals.

import type { ModeTemplateId } from '../../../src/lib/modes/types';
import type { ModeConfidenceScore, ModeClassifierConfig } from './types';
import { computeTranscriptDensity } from './TranscriptDensitySignal';
import { detectSpeakerPattern } from './SpeakerPatternSignal';
import { classifyQuestionType } from './QuestionTypeSignal';

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
// Classifier v1
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
// Classifier v2 (Phase 6)
// ---------------------------------------------------------------------------

/**
 * Enhanced mode classification with multiple signal sources.
 *
 * Combines:
 *   - Keyword score (weight 0.4)
 *   - Transcript density (weight 0.25)
 *   - Speaker pattern (weight 0.15)
 *   - Question type (weight 0.20)
 *
 * Same output shape as classifyMode() — drop-in replacement.
 * Only called when 'predictorV2' capability is enabled.
 */
export function classifyModeV2(
    text: string,
    config?: Partial<ModeClassifierConfig>,
): ModeConfidenceScore[] {
    const merged = { ...DEFAULT_CONFIG, ...config };
    const normalizedText = text.toLowerCase();

    if (normalizedText.length < merged.minTranscriptLength) {
        return buildUniformScores();
    }

    // --- Signal 1: Keyword scores (v1) ---
    const keywordScores = classifyMode(text, config);
    const keywordMap = new Map<ModeTemplateId, ModeConfidenceScore>();
    for (const s of keywordScores) {
        keywordMap.set(s.modeId, s);
    }

    // --- Signal 2: Transcript density ---
    const density = computeTranscriptDensity(text);

    // --- Signal 3: Speaker pattern ---
    const speaker = detectSpeakerPattern(text);

    // --- Signal 4: Question type ---
    const questions = classifyQuestionType(text);
    const questionModeHints = new Map<string, number>();
    for (const qt of questions.types) {
        const current = questionModeHints.get(qt.modeHint) ?? 0;
        questionModeHints.set(qt.modeHint, Math.max(current, qt.confidence));
    }

    // --- Combine with weights ---
    const W_KEYWORD = 0.4;
    const W_DENSITY = 0.25;
    const W_SPEAKER = 0.15;
    const W_QUESTION = 0.2;

    const combinedScores: ModeConfidenceScore[] = ALL_MODE_IDS
        .filter(id => id !== 'general')
        .map(modeId => {
            const kw = keywordMap.get(modeId)?.confidence ?? 0;
            const d = density.scores[modeId] ?? 0;
            const sp = speaker.modeHints[modeId] ?? 0;
            const qt = questionModeHints.get(modeId) ?? 0;

            const combined = kw * W_KEYWORD + d * W_DENSITY + sp * W_SPEAKER + qt * W_QUESTION;

            return {
                modeId,
                confidence: Math.round(combined * 1000) / 1000,
                signalCount: (keywordMap.get(modeId)?.signalCount ?? 0),
                topKeywords: keywordMap.get(modeId)?.topKeywords ?? [],
            };
        })
        .sort((a, b) => b.confidence - a.confidence);

    // Add general with remaining confidence
    const totalConfidence = combinedScores.reduce((sum, s) => sum + s.confidence, 0);
    combinedScores.push({
        modeId: 'general',
        confidence: Math.max(0, Math.round((1 - totalConfidence) * 1000) / 1000),
        signalCount: 0,
        topKeywords: [],
    });

    return combinedScores.sort((a, b) => b.confidence - a.confidence);
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

