import type { SessionActionMode, UnifiedActionIntent } from '../ActionContextBuilder';
import type { BrainId, QuestionCategory, ResponseDepth } from './types';
import { normalizeQuestion } from './utils';

export type ContextPrioritySource =
    | 'transcript'
    | 'screen'
    | 'resume'
    | 'jd'
    | 'rag'
    | 'session_history'
    | 'previous_response'
    | 'supplemental';

export type ContextPriorityLevel = 'critical' | 'high' | 'medium' | 'low' | 'ignore';
export type PromptContextOrderKey = 'rag' | 'supplemental' | 'profile' | 'transcript';

export interface ContextPriorityResult {
    priorities: Record<ContextPrioritySource, ContextPriorityLevel>;
    excludedSources: ContextPrioritySource[];
    reasoning: string[];
    confidence: number;
}

export interface ContextPriorityInput {
    question: string;
    questionCategory: QuestionCategory;
    responseDepth: ResponseDepth;
    brainId: BrainId;
    intent: UnifiedActionIntent;
    sessionMode: SessionActionMode;
    hasScreenContext?: boolean;
}

const PRIORITY_WEIGHT: Record<ContextPriorityLevel, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    ignore: 0,
};

const DEFAULT_SECTION_ORDER: PromptContextOrderKey[] = ['rag', 'supplemental', 'profile', 'transcript'];
const SOURCE_TIE_BREAK_ORDER: ContextPrioritySource[] = [
    'transcript',
    'screen',
    'resume',
    'jd',
    'rag',
    'session_history',
    'previous_response',
    'supplemental',
];

const BASE_PRIORITIES: Record<BrainId, Record<ContextPrioritySource, ContextPriorityLevel>> = {
    coding: {
        transcript: 'critical',
        screen: 'high',
        resume: 'low',
        jd: 'low',
        rag: 'ignore',
        session_history: 'medium',
        previous_response: 'high',
        supplemental: 'medium',
    },
    behavioral: {
        transcript: 'critical',
        screen: 'low',
        resume: 'critical',
        jd: 'high',
        rag: 'ignore',
        session_history: 'high',
        previous_response: 'medium',
        supplemental: 'medium',
    },
    system_design: {
        transcript: 'critical',
        screen: 'high',
        resume: 'medium',
        jd: 'low',
        rag: 'high',
        session_history: 'medium',
        previous_response: 'high',
        supplemental: 'medium',
    },
    resume: {
        transcript: 'high',
        screen: 'low',
        resume: 'critical',
        jd: 'critical',
        rag: 'low',
        session_history: 'high',
        previous_response: 'medium',
        supplemental: 'medium',
    },
    general: {
        transcript: 'critical',
        screen: 'low',
        resume: 'low',
        jd: 'low',
        rag: 'low',
        session_history: 'medium',
        previous_response: 'medium',
        supplemental: 'low',
    },
    sales: {
        transcript: 'critical',
        screen: 'low',
        resume: 'ignore',
        jd: 'ignore',
        rag: 'low',
        session_history: 'high',
        previous_response: 'high',
        supplemental: 'medium',
    },
    lecture: {
        transcript: 'critical',
        screen: 'medium',
        resume: 'ignore',
        jd: 'ignore',
        rag: 'medium',
        session_history: 'medium',
        previous_response: 'medium',
        supplemental: 'medium',
    },
    recruiting: {
        transcript: 'critical',
        screen: 'low',
        resume: 'critical',
        jd: 'critical',
        rag: 'low',
        session_history: 'high',
        previous_response: 'medium',
        supplemental: 'medium',
    },
    team_meeting: {
        transcript: 'critical',
        screen: 'medium',
        resume: 'ignore',
        jd: 'ignore',
        rag: 'low',
        session_history: 'high',
        previous_response: 'high',
        supplemental: 'medium',
    },
    looking_for_work: {
        transcript: 'critical',
        screen: 'low',
        resume: 'critical',
        jd: 'high',
        rag: 'low',
        session_history: 'high',
        previous_response: 'high',
        supplemental: 'medium',
    },
    screen_analysis: {
        transcript: 'critical',
        screen: 'critical',
        resume: 'low',
        jd: 'low',
        rag: 'ignore',
        session_history: 'low',
        previous_response: 'high',
        supplemental: 'medium',
    },
};



function clonePriorities(brainId: BrainId): Record<ContextPrioritySource, ContextPriorityLevel> {
    return { ...BASE_PRIORITIES[brainId] };
}

function clampConfidence(value: number): number {
    return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function setPriority(
    priorities: Record<ContextPrioritySource, ContextPriorityLevel>,
    source: ContextPrioritySource,
    level: ContextPriorityLevel,
): void {
    if (PRIORITY_WEIGHT[level] >= PRIORITY_WEIGHT[priorities[source]]) {
        priorities[source] = level;
    }
}

function forcePriority(
    priorities: Record<ContextPrioritySource, ContextPriorityLevel>,
    source: ContextPrioritySource,
    level: ContextPriorityLevel,
): void {
    priorities[source] = level;
}

export function deriveContextPriority(input: ContextPriorityInput): ContextPriorityResult {
    const normalizedQuestion = normalizeQuestion(input.question);
    const priorities = clonePriorities(input.brainId);
    const reasoning: string[] = [`brain:${input.brainId}`, `category:${input.questionCategory}`, `depth:${input.responseDepth}`];
    let confidence = 0.58;

    const hasCodingSignals = /\b(optimi[sz]e|optimization|bug|debug|binary search|matrix|tree|graph|leetcode|complexity|runtime|space complexity|function|class)\b/i.test(normalizedQuestion);
    const hasSystemSignals = /\b(design|architecture|scale|scalable|whatsapp|instagram|notification system|cache|database|load balancing|distributed)\b/i.test(normalizedQuestion);
    const hasBehavioralSignals = /\b(tell me about a time|challenge|failure|leadership|conflict|teammate|feedback)\b/i.test(normalizedQuestion);
    const hasResumeSignals = /\b(your project|tell me about your project|walk me through your resume|resume|background|experience with|worked on|internship|current role|past role)\b/i.test(normalizedQuestion);
    const hasJdSignals = /\b(job description|\bjd\b|requirements|why this role|why this company|fit for this role|qualification)\b/i.test(normalizedQuestion);

    if (input.intent === 'screen_scan' || input.brainId === 'screen_analysis') {
        forcePriority(priorities, 'screen', 'critical');
        setPriority(priorities, 'transcript', 'critical');
        setPriority(priorities, 'previous_response', 'high');
        reasoning.push('override:screen_scan');
        confidence += 0.16;
    }

    if (input.questionCategory === 'coding' || input.brainId === 'coding' || hasCodingSignals) {
        setPriority(priorities, 'transcript', 'critical');
        setPriority(priorities, 'previous_response', 'high');
        forcePriority(priorities, 'rag', 'ignore');
        forcePriority(priorities, 'resume', 'ignore');
        forcePriority(priorities, 'jd', 'ignore');
        if (input.hasScreenContext) {
            setPriority(priorities, 'screen', 'critical');
            reasoning.push('signal:coding_screen');
        }
        confidence += hasCodingSignals ? 0.14 : 0.08;
    }

    if (input.questionCategory === 'behavioral' || input.brainId === 'behavioral' || hasBehavioralSignals) {
        setPriority(priorities, 'resume', 'critical');
        setPriority(priorities, 'transcript', 'critical');
        setPriority(priorities, 'jd', 'high');
        setPriority(priorities, 'session_history', 'high');
        forcePriority(priorities, 'rag', 'ignore');
        reasoning.push('signal:behavioral_grounding');
        confidence += hasBehavioralSignals ? 0.14 : 0.08;
    }

    if (input.brainId === 'sales') {
        setPriority(priorities, 'session_history', 'high');
        setPriority(priorities, 'previous_response', 'high');
        forcePriority(priorities, 'resume', 'ignore');
        forcePriority(priorities, 'jd', 'ignore');
        reasoning.push('brain:sales_runtime');
        confidence += 0.1;
    }

    if (input.brainId === 'lecture') {
        setPriority(priorities, 'transcript', 'critical');
        setPriority(priorities, 'supplemental', 'medium');
        reasoning.push('brain:lecture_runtime');
        confidence += 0.08;
    }

    if (input.brainId === 'recruiting') {
        setPriority(priorities, 'resume', 'critical');
        setPriority(priorities, 'jd', 'critical');
        setPriority(priorities, 'session_history', 'high');
        reasoning.push('brain:recruiting_runtime');
        confidence += 0.1;
    }

    if (input.brainId === 'team_meeting') {
        setPriority(priorities, 'session_history', 'high');
        setPriority(priorities, 'previous_response', 'high');
        reasoning.push('brain:team_meeting_runtime');
        confidence += 0.08;
    }

    if (input.brainId === 'looking_for_work') {
        setPriority(priorities, 'resume', 'critical');
        setPriority(priorities, 'jd', 'high');
        setPriority(priorities, 'session_history', 'high');
        reasoning.push('brain:looking_for_work_runtime');
        confidence += 0.1;
    }

    if (input.questionCategory === 'system_design' || input.brainId === 'system_design' || hasSystemSignals) {
        setPriority(priorities, 'transcript', 'critical');
        setPriority(priorities, 'rag', 'high');
        setPriority(priorities, 'previous_response', 'high');
        forcePriority(priorities, 'resume', 'low');
        if (input.hasScreenContext) {
            setPriority(priorities, 'screen', 'high');
        }
        if (input.responseDepth === 'deep') {
            setPriority(priorities, 'rag', 'high');
            setPriority(priorities, 'session_history', 'high');
            reasoning.push('depth:deep_design');
            confidence += 0.08;
        }
        reasoning.push('signal:system_design');
        confidence += hasSystemSignals ? 0.14 : 0.08;
    }

    if (input.questionCategory === 'resume_jd' || input.brainId === 'resume' || hasResumeSignals || hasJdSignals) {
        setPriority(priorities, 'resume', 'critical');
        forcePriority(priorities, 'transcript', 'medium');
        setPriority(priorities, 'session_history', 'high');
        forcePriority(priorities, 'rag', 'ignore');
        forcePriority(priorities, 'screen', input.hasScreenContext ? 'low' : 'ignore');
        if (hasJdSignals) {
            forcePriority(priorities, 'jd', 'critical');
            reasoning.push('signal:jd_alignment');
        } else {
            forcePriority(priorities, 'jd', 'high');
            reasoning.push('signal:resume_grounding');
        }
        confidence += (hasResumeSignals || hasJdSignals) ? 0.14 : 0.08;
    }

    if (input.sessionMode === 'follow_up' || input.questionCategory === 'follow_up') {
        setPriority(priorities, 'session_history', 'high');
        setPriority(priorities, 'previous_response', 'high');
        reasoning.push('mode:follow_up');
        confidence += 0.08;
    }

    if (!input.hasScreenContext && priorities.screen !== 'critical') {
        forcePriority(priorities, 'screen', 'ignore');
        reasoning.push('screen:absent');
        confidence -= 0.02;
    }

    if (input.questionCategory === 'general' && !hasCodingSignals && !hasSystemSignals && !hasBehavioralSignals && !hasResumeSignals && !hasJdSignals) {
        forcePriority(priorities, 'transcript', 'critical');
        setPriority(priorities, 'session_history', 'medium');
        setPriority(priorities, 'previous_response', 'medium');
        reasoning.push('fallback:general');
        confidence -= 0.04;
    }

    const excludedSources = SOURCE_TIE_BREAK_ORDER.filter((source) => priorities[source] === 'ignore');

    return {
        priorities,
        excludedSources,
        reasoning,
        confidence: clampConfidence(confidence),
    };
}

export function getOrderedContextSources(result: ContextPriorityResult): ContextPrioritySource[] {
    return [...SOURCE_TIE_BREAK_ORDER].sort((left, right) => {
        const priorityDiff = PRIORITY_WEIGHT[result.priorities[right]] - PRIORITY_WEIGHT[result.priorities[left]];
        if (priorityDiff !== 0) {
            return priorityDiff;
        }

        return SOURCE_TIE_BREAK_ORDER.indexOf(left) - SOURCE_TIE_BREAK_ORDER.indexOf(right);
    });
}

export function getPromptContextOrder(result: ContextPriorityResult): PromptContextOrderKey[] {
    const sectionScores: Record<PromptContextOrderKey, number> = {
        transcript: PRIORITY_WEIGHT[result.priorities.transcript],
        profile: Math.max(PRIORITY_WEIGHT[result.priorities.resume], PRIORITY_WEIGHT[result.priorities.jd]),
        rag: PRIORITY_WEIGHT[result.priorities.rag],
        supplemental: Math.max(
            PRIORITY_WEIGHT[result.priorities.screen],
            PRIORITY_WEIGHT[result.priorities.session_history],
            PRIORITY_WEIGHT[result.priorities.previous_response],
            PRIORITY_WEIGHT[result.priorities.supplemental],
        ),
    };

    return [...DEFAULT_SECTION_ORDER].sort((left, right) => {
        const scoreDiff = sectionScores[right] - sectionScores[left];
        if (scoreDiff !== 0) {
            return scoreDiff;
        }

        return DEFAULT_SECTION_ORDER.indexOf(left) - DEFAULT_SECTION_ORDER.indexOf(right);
    });
}

export function shouldExcludePromptSection(
    result: ContextPriorityResult,
    section: PromptContextOrderKey,
): boolean {
    return section === 'rag' && result.priorities.rag === 'ignore';
}
