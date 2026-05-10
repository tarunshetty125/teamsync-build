import { SessionTracker, type SessionMode } from './SessionTracker';
import { ModesManager } from './services/ModesManager';
import {
    BRAINSTORM_MODE_PROMPT,
    CLARIFY_MODE_PROMPT,
    CODE_HINT_PROMPT,
    SCREEN_SCAN_PROMPT,
    SYSTEM_DESIGN_TRADEOFFS_PROMPT,
    UNIVERSAL_ANSWER_PROMPT,
    UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT,
    UNIVERSAL_RECAP_PROMPT,
    UNIVERSAL_WHAT_TO_ANSWER_PROMPT,
    buildCodeHintMessage,
    buildScreenScanMessage,
} from './llm/prompts';
import type { ScreenContentMode } from './llm';

export type UnifiedActionIntent =
    | 'what_to_answer'
    | 'recap'
    | 'clarify'
    | 'brainstorm'
    | 'follow_up_questions'
    | 'answer_now'
    | 'manual_chat'
    | 'code_hint'
    | 'system_design_tradeoffs'
    | 'screen_scan';

export type SessionActionMode = SessionMode;
export type ProfilePolicy = 'always' | 'optional' | 'never';
export type ProfilePreference = 'default' | 'force_on' | 'force_off';
export type TranscriptStrategy = 'rolling_window' | 'capped_full';
export type RAGScope = 'meeting' | 'global' | 'live';

interface KnowledgeResultLike {
    systemPromptInjection?: string;
    contextBlock?: string;
    isIntroQuestion?: boolean;
    introResponse?: string;
    liveNegotiationResponse?: {
        exactScript?: string;
        tacticalNote?: string;
    };
}

interface KnowledgeOrchestratorLike {
    isKnowledgeMode?: () => boolean;
    processQuestion?: (question: string) => Promise<KnowledgeResultLike | null>;
}

export interface ActionRagContext {
    content: string;
    scope: RAGScope;
    title?: string;
}

export interface BuildContextArgs {
    session: SessionTracker;
    intent: UnifiedActionIntent;
    mode: SessionActionMode;
    profile?: KnowledgeOrchestratorLike | null;
    message?: string;
    imagePaths?: string[];
    profilePreference?: ProfilePreference;
    additionalContext?: string;
    rag?: ActionRagContext | null;
    includeModeCustomContext?: boolean;
    screenScanMode?: ScreenContentMode;
}

interface BaseContextLayer {
    latestInterviewerTurn: string | null;
    lastAssistantMessage: string | null;
}

type QuestionResponseProfile =
    | 'coding'
    | 'system_design'
    | 'resume_or_jd'
    | 'follow_up'
    | 'fresh_general'
    | 'general';

export interface PromptInstruction {
    key: string;
    title: string;
    content: string;
}

export interface PromptTranscriptSection {
    title: string;
    content: string;
    strategy: TranscriptStrategy;
    approxTokens: number;
}

export interface PromptProfileSection {
    title: string;
    context: string;
    instruction?: string;
    used: boolean;
    policy: ProfilePolicy;
    approxTokens: number;
}

export interface PromptContextSection {
    title: string;
    content: string;
    approxTokens: number;
}

export interface PromptObject {
    mode: SessionActionMode;
    intent: UnifiedActionIntent;
    question: string;
    transcript: PromptTranscriptSection;
    profile: PromptProfileSection | null;
    supplemental: PromptContextSection | null;
    rag: PromptContextSection | null;
    instructions: PromptInstruction[];
}

export interface BuiltContextLayers {
    promptObject: PromptObject;
    directResponse?: string;
    profileApplied: boolean;
    profilePolicy: ProfilePolicy;
    transcriptStrategy: TranscriptStrategy;
    transcriptLength: number;
    transcriptApproxTokens: number;
}

export interface SerializedPrompt {
    systemPrompt: string;
    context: string;
    finalPrompt: string;
}

export interface BuiltActionContext {
    layers: BuiltContextLayers;
    serialized: SerializedPrompt;
}

export interface ActionContextPolicy {
    profilePolicy: ProfilePolicy;
    defaultProfilePreference: ProfilePreference;
    allowAdditionalContext: boolean;
    allowRag: boolean;
    allowModeCustomContext: boolean;
}

export const ACTION_CONTEXT_POLICY_MAP: Record<UnifiedActionIntent, ActionContextPolicy> = {
    what_to_answer: {
        profilePolicy: 'always',
        defaultProfilePreference: 'force_on',
        allowAdditionalContext: true,
        allowRag: true,
        allowModeCustomContext: true,
    },
    recap: {
        profilePolicy: 'never',
        defaultProfilePreference: 'force_off',
        allowAdditionalContext: true,
        allowRag: true,
        allowModeCustomContext: true,
    },
    clarify: {
        profilePolicy: 'never',
        defaultProfilePreference: 'force_off',
        allowAdditionalContext: true,
        allowRag: true,
        allowModeCustomContext: true,
    },
    brainstorm: {
        profilePolicy: 'optional',
        defaultProfilePreference: 'force_off',
        allowAdditionalContext: true,
        allowRag: true,
        allowModeCustomContext: true,
    },
    follow_up_questions: {
        profilePolicy: 'never',
        defaultProfilePreference: 'force_off',
        allowAdditionalContext: true,
        allowRag: true,
        allowModeCustomContext: true,
    },
    answer_now: {
        profilePolicy: 'always',
        defaultProfilePreference: 'force_on',
        allowAdditionalContext: true,
        allowRag: true,
        allowModeCustomContext: true,
    },
    manual_chat: {
        profilePolicy: 'optional',
        defaultProfilePreference: 'force_on',
        allowAdditionalContext: true,
        allowRag: true,
        allowModeCustomContext: true,
    },
    code_hint: {
        profilePolicy: 'never',
        defaultProfilePreference: 'force_off',
        allowAdditionalContext: true,
        allowRag: false,
        allowModeCustomContext: true,
    },
    system_design_tradeoffs: {
        profilePolicy: 'never',
        defaultProfilePreference: 'force_off',
        allowAdditionalContext: true,
        allowRag: false,
        allowModeCustomContext: true,
    },
    screen_scan: {
        profilePolicy: 'never',
        defaultProfilePreference: 'force_off',
        allowAdditionalContext: true,
        allowRag: false,
        allowModeCustomContext: true,
    },
};

export interface ResolvedActionContextPolicy extends ActionContextPolicy {
    intent: UnifiedActionIntent;
    resolvedProfilePreference: ProfilePreference;
    profileEnabled: boolean;
    includeModeCustomContext: boolean;
    includeAdditionalContext: boolean;
    includeRag: boolean;
}

function getIntentPromptBase(intent: UnifiedActionIntent): string {
    switch (intent) {
        case 'recap':
            return UNIVERSAL_RECAP_PROMPT;
        case 'clarify':
            return CLARIFY_MODE_PROMPT;
        case 'brainstorm':
            return BRAINSTORM_MODE_PROMPT;
        case 'follow_up_questions':
            return UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT;
        case 'answer_now':
            return UNIVERSAL_ANSWER_PROMPT;
        case 'manual_chat':
            return 'Answer the user directly using the available context. Stay concise, natural, and practical.';
        case 'code_hint':
            return CODE_HINT_PROMPT;
        case 'system_design_tradeoffs':
            return SYSTEM_DESIGN_TRADEOFFS_PROMPT;
        case 'screen_scan':
            return SCREEN_SCAN_PROMPT;
        case 'what_to_answer':
        default:
            return UNIVERSAL_WHAT_TO_ANSWER_PROMPT;
    }
}

function buildDefaultQuestion(baseContext: BaseContextLayer, intent: UnifiedActionIntent, mode: SessionActionMode): string {
    const latestQuestion = baseContext.latestInterviewerTurn?.trim();

    switch (intent) {
        case 'recap':
            return 'Summarize the latest discussion.';
        case 'clarify':
            return latestQuestion || 'Ask one clarifying question that would unblock the current discussion.';
        case 'brainstorm':
            return latestQuestion || 'Brainstorm the strongest approaches for the latest problem or question.';
        case 'follow_up_questions':
            return latestQuestion || 'Suggest the best follow-up questions to ask next.';
        case 'answer_now':
            return latestQuestion || 'Answer the latest question directly.';
        case 'manual_chat':
            return latestQuestion || 'Answer the user directly.';
        case 'code_hint':
            return 'Give a targeted code hint for the current problem or screenshot.';
        case 'system_design_tradeoffs':
            return latestQuestion || 'Explain the key system design tradeoffs for the current discussion.';
        case 'screen_scan':
            return 'Analyze the current screen and return the most useful answer.';
        case 'what_to_answer':
        default:
            if (latestQuestion) return latestQuestion;
            if (mode === 'system_design') return 'Answer the latest system design question.';
            if (mode === 'coding') return 'Answer the latest coding question.';
            return 'Answer the latest interviewer question directly.';
    }
}

function buildSessionModeDirective(mode: SessionActionMode): string {
    switch (mode) {
        case 'behavioral':
            return 'Treat this as a behavioral interview. Answer in first person with truthful, concrete examples and crisp story flow.';
        case 'coding':
            return 'Treat this as a coding interview. Prioritize correctness, implementation detail, edge cases, and concise technical reasoning.';
        case 'follow_up':
            return 'Treat this as an ongoing follow-up discussion. Continue naturally from the latest exchange without restarting the answer.';
        case 'system_design':
            return 'Treat this as a system design discussion. Focus on architecture, tradeoffs, scaling, reliability, and failure handling.';
        case 'general':
        default:
            return 'Treat this as a general interview conversation. Answer directly, naturally, and concisely.';
    }
}

function buildModeAwareIntentRules(intent: UnifiedActionIntent, mode: SessionActionMode): string[] {
    if (intent === 'answer_now' || intent === 'what_to_answer') {
        switch (mode) {
            case 'behavioral':
                return [
                    'Ground the answer in a concrete real example.',
                    'Use first-person phrasing throughout.',
                    'Sound confident and specific, not generic.',
                ];
            case 'coding':
                return [
                    'Emphasize implementation steps, complexity, and edge cases.',
                    'Favor precise technical language over broad framing.',
                ];
            case 'system_design':
                return [
                    'Lead with the architecture direction.',
                    'Call out tradeoffs, scalability, reliability, and failure modes.',
                ];
            case 'follow_up':
                return [
                    'Assume the conversation is already in progress.',
                    'Avoid repeating setup that the interviewer already knows.',
                ];
            case 'general':
            default:
                return [
                    'Keep the answer concise and ready to say aloud.',
                ];
        }
    }

    if (intent === 'brainstorm' && mode === 'system_design') {
        return [
            'Prefer architecture alternatives over generic brainstorming.',
            'Include operational tradeoffs for each option.',
        ];
    }

    if (intent === 'recap' && mode === 'system_design') {
        return [
            'Highlight architecture choices, tradeoffs, and open risks.',
        ];
    }

    return [];
}

function createInstruction(key: string, title: string, content: string): PromptInstruction {
    return { key, title, content: content.trim() };
}

function normalizeInstructionContent(content: string): string {
    return content.trim().replace(/\n{3,}/g, '\n\n');
}

export function buildBaseContext(session: SessionTracker): BaseContextLayer {
    return {
        latestInterviewerTurn: session.getLastInterviewerTurn(),
        lastAssistantMessage: session.getLastAssistantMessage(),
    };
}

function getQuestionResponseProfile(
    question: string,
    mode: SessionActionMode,
    intent: UnifiedActionIntent
): QuestionResponseProfile {
    const normalized = question.trim().toLowerCase();
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;

    if (mode === 'coding'
        || intent === 'code_hint'
        || /\b(code|coding|algorithm|leetcode|debug|bug|implement|implementation|function|class|array|string|graph|tree|dynamic programming|dp|time complexity|space complexity)\b/i.test(normalized)) {
        return 'coding';
    }

    if (mode === 'system_design'
        || intent === 'system_design_tradeoffs'
        || /\b(system design|design a|architecture|scalab|latency|throughput|availability|partition|replication|cache|load balancer|queue|database|shard|failover)\b/i.test(normalized)) {
        return 'system_design';
    }

    if (mode === 'follow_up'
        || /\b(follow up|follow-up|can you expand|can you elaborate|could you elaborate|go deeper|tell me more|what about|why did|how did|and also|also)\b/i.test(normalized)) {
        return 'follow_up';
    }

    if (/\b(resume|job description|\bjd\b|background|tell me about yourself|walk me through|experience|current role|past role|why this role|why this company|fit for this role|requirements|qualification|qualifications)\b/i.test(normalized)) {
        return 'resume_or_jd';
    }

    if (mode === 'general' && wordCount > 0 && wordCount <= 14) {
        return 'fresh_general';
    }

    return 'general';
}

function buildContextPriorityRules(profileApplied: boolean): string[] {
    const rules = [
        'Answer the latest question first.',
        'Do not continue or repeat an older assistant answer unless the latest question explicitly asks for it.',
        'Prefer the freshest transcript turns over older context when they conflict.',
    ];

    if (profileApplied) {
        rules.push('Use PROFILE INTELLIGENCE only when it is directly relevant to the latest question.');
        rules.push('Ignore unrelated resume, JD, salary, or negotiation details.');
    }

    return rules;
}

export function buildTranscriptContext(
    session: SessionTracker,
    intent: UnifiedActionIntent,
    question: string,
    mode: SessionActionMode
): PromptTranscriptSection {
    const profile = getQuestionResponseProfile(question, mode, intent);

    if (intent === 'recap') {
        const content = session.getCappedFullTranscript(2800).trim() || '[NO TRANSCRIPT AVAILABLE]';
        return {
            title: 'TRANSCRIPT',
            content,
            strategy: 'capped_full',
            approxTokens: session.estimateTokenCount(content),
        };
    }

    if (intent === 'manual_chat') {
        const transcriptConfig = (() => {
            switch (profile) {
                case 'coding':
                    return { lastSeconds: 150, maxItems: 12, includeInterim: true, maxTokens: 1300 };
                case 'system_design':
                    return { lastSeconds: 150, maxItems: 12, includeInterim: true, maxTokens: 1300 };
                case 'resume_or_jd':
                    return { lastSeconds: 120, maxItems: 10, includeInterim: false, maxTokens: 1100 };
                case 'follow_up':
                    return { lastSeconds: 180, maxItems: 14, includeInterim: true, maxTokens: 1500 };
                case 'fresh_general':
                    return { lastSeconds: 90, maxItems: 8, includeInterim: false, maxTokens: 850 };
                case 'general':
                default:
                    return { lastSeconds: 120, maxItems: 10, includeInterim: true, maxTokens: 1100 };
            }
        })();
        const content = session.getRollingWindowTranscript(
            transcriptConfig.lastSeconds,
            transcriptConfig.maxItems,
            transcriptConfig.includeInterim,
            transcriptConfig.maxTokens
        ).trim() || '[NO TRANSCRIPT AVAILABLE]';
        return {
            title: 'TRANSCRIPT',
            content,
            strategy: 'rolling_window',
            approxTokens: session.estimateTokenCount(content),
        };
    }

    const transcriptConfig = (() => {
        if (intent === 'clarify') {
            return { lastSeconds: 240, maxItems: 16, includeInterim: true, maxTokens: 1400 };
        }

        switch (profile) {
            case 'coding':
                return { lastSeconds: 150, maxItems: 12, includeInterim: true, maxTokens: 1300 };
            case 'system_design':
                return { lastSeconds: 150, maxItems: 12, includeInterim: true, maxTokens: 1300 };
            case 'resume_or_jd':
                return { lastSeconds: 120, maxItems: 10, includeInterim: false, maxTokens: 1100 };
            case 'follow_up':
                return { lastSeconds: 180, maxItems: 14, includeInterim: true, maxTokens: 1450 };
            case 'fresh_general':
                return { lastSeconds: 90, maxItems: 8, includeInterim: false, maxTokens: 850 };
            case 'general':
            default:
                return { lastSeconds: 120, maxItems: 10, includeInterim: true, maxTokens: 1100 };
        }
    })();
    const content = session.getRollingWindowTranscript(
        transcriptConfig.lastSeconds,
        transcriptConfig.maxItems,
        transcriptConfig.includeInterim,
        transcriptConfig.maxTokens
    ).trim() || '[NO TRANSCRIPT AVAILABLE]';
    return {
        title: 'TRANSCRIPT',
        content,
        strategy: 'rolling_window',
        approxTokens: session.estimateTokenCount(content),
    };
}

export interface ResolvedModeContext {
    sessionMode: SessionActionMode;
    templateType: string | null;
    modeSuffix: string;
    modeContextBlock: string;
}

export function resolveMode(
    mode: SessionActionMode,
    options?: { includeModeCustomContext?: boolean }
): ResolvedModeContext {
    const modesManager = ModesManager.getInstance();
    const { suffix: modeSuffix, templateType } = modesManager.getActiveModeDeduped();
    const modeContextBlock = modesManager.buildActiveModeContextBlock({
        includeCustomContext: options?.includeModeCustomContext !== false,
    })?.trim() ?? '';

    return {
        sessionMode: mode,
        templateType,
        modeSuffix: modeSuffix?.trim() ?? '',
        modeContextBlock,
    };
}

export function buildModeContext(
    mode: SessionActionMode,
    options?: { includeModeCustomContext?: boolean }
): PromptInstruction[] {
    const resolvedMode = resolveMode(mode, options);
    const instructions: PromptInstruction[] = [
        createInstruction('session_mode', 'SESSION MODE', buildSessionModeDirective(resolvedMode.sessionMode)),
    ];

    if (resolvedMode.modeContextBlock) {
        instructions.push(createInstruction('active_mode_context', 'ACTIVE MODE CONTEXT', resolvedMode.modeContextBlock));
    }

    if (resolvedMode.modeSuffix && resolvedMode.templateType !== 'general') {
        instructions.push(createInstruction('active_mode', 'ACTIVE MODE', resolvedMode.modeSuffix));
    }

    return instructions;
}

function resolveProfilePreference(intent: UnifiedActionIntent, override: ProfilePreference = 'default'): ProfilePreference {
    return override === 'default' ? ACTION_CONTEXT_POLICY_MAP[intent].defaultProfilePreference : override;
}

export function resolveActionContextPolicy(args: {
    intent: UnifiedActionIntent;
    profilePreference?: ProfilePreference;
    includeModeCustomContext?: boolean;
    hasAdditionalContext?: boolean;
    hasRag?: boolean;
    profileEnabled?: boolean;
}): ResolvedActionContextPolicy {
    const basePolicy = ACTION_CONTEXT_POLICY_MAP[args.intent];
    const resolvedProfilePreference = resolveProfilePreference(args.intent, args.profilePreference ?? 'default');

    return {
        intent: args.intent,
        ...basePolicy,
        resolvedProfilePreference,
        profileEnabled: basePolicy.profilePolicy !== 'never'
            && resolvedProfilePreference === 'force_on'
            && args.profileEnabled === true,
        includeModeCustomContext: basePolicy.allowModeCustomContext && args.includeModeCustomContext !== false,
        includeAdditionalContext: basePolicy.allowAdditionalContext && args.hasAdditionalContext === true,
        includeRag: basePolicy.allowRag && args.hasRag === true,
    };
}

export async function buildProfileContext(
    intent: UnifiedActionIntent,
    profile: KnowledgeOrchestratorLike | null | undefined,
    question: string,
    preference: ProfilePreference = 'default'
): Promise<{ profile: PromptProfileSection | null; directResponse?: string }> {
    const knowledgeModeActive = profile?.isKnowledgeMode?.() === true;
    const resolvedPolicy = resolveActionContextPolicy({
        intent,
        profilePreference: preference,
        profileEnabled: knowledgeModeActive,
    });
    const policy = resolvedPolicy.profilePolicy;
    const enabled = resolvedPolicy.profileEnabled;

    if (!enabled || !knowledgeModeActive || !profile?.processQuestion) {
        return {
            profile: {
                title: 'PROFILE INTELLIGENCE',
                context: '',
                used: false,
                policy,
                approxTokens: 0,
            },
        };
    }

    try {
        const profileResult = await profile.processQuestion(question);

        if (profileResult?.introResponse?.trim()) {
            return {
                profile: {
                    title: 'PROFILE INTELLIGENCE',
                    context: '',
                    used: true,
                    policy,
                    approxTokens: 0,
                },
                directResponse: profileResult.introResponse.trim(),
            };
        }

        const negotiationResponse = profileResult?.liveNegotiationResponse;
        const directNegotiationText =
            negotiationResponse?.exactScript?.trim()
            || negotiationResponse?.tacticalNote?.trim();
        if (directNegotiationText) {
            return {
                profile: {
                    title: 'PROFILE INTELLIGENCE',
                    context: '',
                    used: true,
                    policy,
                    approxTokens: 0,
                },
                directResponse: directNegotiationText,
            };
        }

        const instruction = profileResult?.systemPromptInjection?.trim() || undefined;
        const context = profileResult?.contextBlock?.trim() || '';
        return {
            profile: {
                title: 'PROFILE INTELLIGENCE',
                context,
                instruction,
                used: Boolean(instruction || context),
                policy,
                approxTokens: context ? sessionTokenEstimate(context) : 0,
            },
        };
    } catch (error: any) {
        console.warn('[ActionContextBuilder] Profile context build failed:', error?.message || error);
        return {
            profile: {
                title: 'PROFILE INTELLIGENCE',
                context: '',
                used: false,
                policy,
                approxTokens: 0,
            },
        };
    }
}

function sessionTokenEstimate(text: string): number {
    return Math.ceil(text.length / 3.5);
}

export function buildIntentPrompt(
    intent: UnifiedActionIntent,
    mode: SessionActionMode,
    screenScanMode?: ScreenContentMode,
    question?: string,
    profileApplied: boolean = false
): PromptInstruction[] {
    const basePrompt = getIntentPromptBase(intent).trim();
    const modeAwareRules = buildModeAwareIntentRules(intent, mode);
    const responseProfile = getQuestionResponseProfile(question?.trim() || '', mode, intent);
    const contextPriorityRules = buildContextPriorityRules(profileApplied);

    switch (intent) {
        case 'clarify':
            return [
                createInstruction('intent', 'INTENT', basePrompt),
                createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                createInstruction('output_contract', 'OUTPUT CONTRACT', [
                    'Return exactly one clarifying question.',
                    'No bullets.',
                    'No explanation.',
                    'No prefacing text.',
                    'End with a question mark.',
                ].join('\n')),
            ];
        case 'recap':
            return [
                createInstruction('intent', 'INTENT', basePrompt),
                createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                createInstruction('output_contract', 'OUTPUT CONTRACT', [
                    'Return bullet summary only.',
                    'Use 3 to 6 bullets.',
                    'Each bullet must begin with "- ".',
                    'No intro sentence.',
                    'No conclusion.',
                    ...modeAwareRules,
                ].join('\n')),
            ];
        case 'brainstorm':
            return [
                createInstruction('intent', 'INTENT', basePrompt),
                createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                createInstruction('output_contract', 'OUTPUT CONTRACT', [
                    'Return 3 to 5 distinct approaches.',
                    'Each bullet must begin with "- ".',
                    'Each bullet must include both the approach and its main tradeoff.',
                    'Keep each bullet concise and decision-oriented.',
                    ...modeAwareRules,
                ].join('\n')),
            ];
        case 'follow_up_questions':
            return [
                createInstruction('intent', 'INTENT', basePrompt),
                createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                createInstruction('output_contract', 'OUTPUT CONTRACT', [
                    'Return 3 to 5 smart follow-up questions as bullets only.',
                    'Each bullet must begin with "- " and contain exactly one question.',
                    'No explanation.',
                    'No commentary outside the list.',
                ].join('\n')),
            ];
        case 'answer_now':
            if (responseProfile === 'coding') {
                return [
                    createInstruction('intent', 'INTENT', basePrompt),
                    createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                    createInstruction('output_contract', 'OUTPUT CONTRACT', [
                        'Return a coding answer the user can say immediately.',
                        'Start with one direct answer sentence.',
                        'Then add an "Approach:" section with 2 to 4 short bullet points.',
                        'Then add a "Complexity:" line with time and space when algorithmic.',
                        'Keep it moderate and interview-ready, not long-form.',
                        'Do not include full code unless the user explicitly asked for implementation.',
                        ...modeAwareRules,
                    ].join('\n')),
                ];
            }

            if (responseProfile === 'resume_or_jd') {
                return [
                    createInstruction('intent', 'INTENT', basePrompt),
                    createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                    createInstruction('output_contract', 'OUTPUT CONTRACT', [
                        'Return a moderate answer the user can say immediately.',
                        'Start with one direct opening sentence.',
                        'Then provide 2 to 3 short bullets with only the most relevant resume or JD points.',
                        'End with one concise closing sentence.',
                        'Do not dump a full history or unrelated background.',
                        'Use first person when answering for the user.',
                        ...modeAwareRules,
                    ].join('\n')),
                ];
            }

            if (responseProfile === 'fresh_general' || responseProfile === 'general') {
                return [
                    createInstruction('intent', 'INTENT', basePrompt),
                    createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                    createInstruction('output_contract', 'OUTPUT CONTRACT', [
                        'Return a moderate answer the user can say immediately.',
                        'Use one direct opening sentence.',
                        'Then provide at most 2 short bullets or one short supporting sentence.',
                        'End cleanly without extra padding.',
                        'Do not expand with older context unless the latest question needs it.',
                        'Use first person when answering for the user.',
                        ...modeAwareRules,
                    ].join('\n')),
                ];
            }

            return [
                createInstruction('intent', 'INTENT', basePrompt),
                createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                createInstruction('output_contract', 'OUTPUT CONTRACT', [
                    'Return a structured answer the user can say immediately.',
                    'Start with one direct opening sentence.',
                    'Then provide 2 to 4 short bullets with concrete supporting points.',
                    'End with one concise closing sentence.',
                    'Use first person when answering for the user.',
                    ...modeAwareRules,
                ].join('\n')),
            ];
        case 'manual_chat':
            if (responseProfile === 'coding') {
                return [
                    createInstruction('intent', 'INTENT', basePrompt),
                    createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                    createInstruction('output_contract', 'OUTPUT CONTRACT', [
                        'Return only the final answer.',
                        'For coding questions, use this order: Direct answer, Approach, Complexity.',
                        'Approach: 2 to 4 short bullets.',
                        'Complexity: include time and space when algorithmic.',
                        'Include code only if the user explicitly asked for code, implementation, or a fix.',
                        'Keep it moderate and high-signal.',
                        'No preamble.',
                    ].join('\n')),
                ];
            }

            if (responseProfile === 'resume_or_jd') {
                return [
                    createInstruction('intent', 'INTENT', basePrompt),
                    createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                    createInstruction('output_contract', 'OUTPUT CONTRACT', [
                        'Return only the final answer.',
                        'Keep it moderate in length.',
                        'Use one short paragraph or 2 to 3 short bullets max.',
                        'Use only the most relevant resume or JD details.',
                        'Do not include unrelated older background.',
                        'No preamble.',
                    ].join('\n')),
                ];
            }

            if (responseProfile === 'fresh_general' || responseProfile === 'general') {
                return [
                    createInstruction('intent', 'INTENT', basePrompt),
                    createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                    createInstruction('output_contract', 'OUTPUT CONTRACT', [
                        'Return only the final answer.',
                        'Keep it moderate and concise.',
                        'Use one short paragraph by default.',
                        'Use at most 2 short bullets only if they help clarity.',
                        'Do not pull in old transcript or profile details unless directly relevant.',
                        'No preamble.',
                    ].join('\n')),
                ];
            }

            return [
                createInstruction('intent', 'INTENT', basePrompt),
                createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                createInstruction('output_contract', 'OUTPUT CONTRACT', [
                    'Return only the final answer.',
                    'Use short prose by default.',
                    'Use bullets only when the user asked for a list or the content is inherently list-shaped.',
                    'If code is required, return the smallest complete solution and at most 2 short notes.',
                    'No preamble.',
                ].join('\n')),
            ];
        case 'code_hint':
            return [
                createInstruction('intent', 'INTENT', basePrompt),
                createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                createInstruction('output_contract', 'OUTPUT CONTRACT', [
                    'Give one concise, high-signal hint.',
                    'Do not provide the full solution unless the screenshot or question explicitly asks for it.',
                    'Prioritize the next debugging or implementation step.',
                    'No filler.',
                ].join('\n')),
            ];
        case 'system_design_tradeoffs':
            return [
                createInstruction('intent', 'INTENT', basePrompt),
                createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                createInstruction('output_contract', 'OUTPUT CONTRACT', [
                    'Return 3 to 5 concise bullets.',
                    'Each bullet must identify a concrete tradeoff.',
                    'Bias toward architecture, scale, reliability, and operational cost.',
                    'No intro sentence.',
                ].join('\n')),
            ];
        case 'screen_scan':
            if (screenScanMode === 'coding' || screenScanMode === 'interview_question') {
                return [
                    createInstruction('intent', 'INTENT', basePrompt),
                    createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                    createInstruction('output_contract', 'OUTPUT CONTRACT', [
                        'You are looking at a coding problem on screen. Your job is to SOLVE it completely.',
                        '',
                        'Your response MUST have exactly three sections in this order:',
                        '',
                        'SECTION 1 — Start with a bold header "Problem:" followed by the real problem name.',
                        'Write the actual name like "Two Sum" or "Reverse Linked List" — include the LeetCode number or platform if you can see it.',
                        'Then write 1-2 sentences explaining what the problem actually asks.',
                        '',
                        'SECTION 2 — Write a bold header "Approach:" then explain YOUR chosen algorithm.',
                        'Use 3-5 bullet points describing the actual steps of the algorithm you will implement.',
                        'Name the specific data structure (hash map, stack, two pointers, etc.) and explain why you chose it.',
                        'State the actual time and space complexity with reasoning.',
                        '',
                        'SECTION 3 — Write a bold header "Solution:" then write the FULL working code.',
                        'The code MUST be inside a fenced code block with the language tag.',
                        'The code must be COMPLETE — a real implementation that compiles and runs correctly.',
                        'Add inline comments on non-obvious lines explaining the logic.',
                        'Use the programming language visible on screen, or Python/JavaScript by default.',
                        '',
                        'CRITICAL: Do NOT output placeholder text like "complete optimized solution" or "state the algorithm".',
                        'You must write the REAL problem name, REAL algorithm explanation, and REAL working code.',
                        'If you output template/placeholder text instead of real content, you have FAILED.',
                    ].join('\n')),
                ];
            }
            return [
                createInstruction('intent', 'INTENT', basePrompt),
                createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                createInstruction('output_contract', 'OUTPUT CONTRACT', [
                    'Analyze the screen content. If it contains a coding problem, you MUST solve it completely.',
                    '',
                    'For coding problems, respond with three sections:',
                    '1. "Problem:" — the actual problem name/number and a 1-2 sentence description of what it asks.',
                    '2. "Approach:" — your chosen algorithm with 3-5 bullets explaining the strategy and complexity.',
                    '3. "Solution:" — the FULL working code in a fenced code block. Not pseudocode, not placeholders — real code.',
                    '',
                    'CRITICAL: Write REAL content — real problem names, real explanations, real working code.',
                    'Never output template text or placeholders.',
                    '',
                    'If the screen is not code-related, answer directly in the most useful format.',
                ].join('\n')),
            ];
        case 'what_to_answer':
        default:
            if (responseProfile === 'coding') {
                return [
                    createInstruction('intent', 'INTENT', basePrompt),
                    createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                    createInstruction('output_contract', 'OUTPUT CONTRACT', [
                        'Return a strong next coding answer for the user.',
                        'Start with one direct answer sentence.',
                        'Then add an "Approach:" section with 2 to 4 short bullets.',
                        'Then add one concise "Complexity:" line when algorithmic.',
                        'Keep it moderate and ready to say aloud.',
                        ...modeAwareRules,
                    ].join('\n')),
                ];
            }

            if (responseProfile === 'resume_or_jd') {
                return [
                    createInstruction('intent', 'INTENT', basePrompt),
                    createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                    createInstruction('output_contract', 'OUTPUT CONTRACT', [
                        'Return a strong next answer for the user.',
                        'Start with one direct answer sentence.',
                        'Then provide 2 to 3 short bullets with only the most relevant resume or JD points.',
                        'Keep it moderate, natural, and ready to say aloud.',
                        'Do not add unrelated older experience.',
                        ...modeAwareRules,
                    ].join('\n')),
                ];
            }

            if (responseProfile === 'fresh_general' || responseProfile === 'general') {
                return [
                    createInstruction('intent', 'INTENT', basePrompt),
                    createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                    createInstruction('output_contract', 'OUTPUT CONTRACT', [
                        'Return a strong next answer for the user.',
                        'Start with one direct answer sentence.',
                        'Then provide at most 2 short bullets or one short supporting sentence.',
                        'Keep it moderate, natural, and ready to say aloud.',
                        'Do not pad with old context unless the latest question needs it.',
                        ...modeAwareRules,
                    ].join('\n')),
                ];
            }

            return [
                createInstruction('intent', 'INTENT', basePrompt),
                createInstruction('context_priority', 'CONTEXT PRIORITY', contextPriorityRules.join('\n')),
                createInstruction('output_contract', 'OUTPUT CONTRACT', [
                    'Return a strong next answer for the user.',
                    'Start with one direct answer sentence.',
                    'Then provide 2 to 4 short bullets the user can speak from.',
                    'Use first person when appropriate.',
                    'Keep it concise, natural, and ready to say aloud.',
                    ...modeAwareRules,
                ].join('\n')),
            ];
    }
}

function buildSupplementalContext(additionalContext?: string): PromptContextSection | null {
    const content = additionalContext?.trim();
    if (!content) return null;
    return {
        title: 'ADDITIONAL CONTEXT',
        content,
        approxTokens: sessionTokenEstimate(content),
    };
}

function buildRagContext(rag?: ActionRagContext | null): PromptContextSection | null {
    const content = rag?.content?.trim();
    if (!content) return null;

    const title = rag.title?.trim()
        || (rag.scope === 'global'
            ? 'RAG MEMORY (GLOBAL)'
            : rag.scope === 'live'
                ? 'RAG MEMORY (LIVE)'
                : 'RAG MEMORY (MEETING)');

    return {
        title,
        content,
        approxTokens: sessionTokenEstimate(content),
    };
}

export async function buildContextLayers({
    session,
    intent,
    mode,
    profile,
    message,
    profilePreference = 'default',
    additionalContext,
    rag,
    includeModeCustomContext = true,
    screenScanMode,
}: BuildContextArgs): Promise<BuiltContextLayers> {
    const resolvedPolicy = resolveActionContextPolicy({
        intent,
        profilePreference,
        includeModeCustomContext,
        hasAdditionalContext: Boolean(additionalContext?.trim()),
        hasRag: Boolean(rag?.content?.trim()),
        profileEnabled: profile?.isKnowledgeMode?.() === true,
    });
    const baseLayer = buildBaseContext(session);
    const defaultQuestion = buildDefaultQuestion(baseLayer, intent, mode);
    const question = (() => {
        if (intent === 'code_hint') {
            const sessionQuestion = session.getDetectedCodingQuestion();
            return buildCodeHintMessage(
                message?.trim() || sessionQuestion.question || null,
                message?.trim() ? 'screenshot' : sessionQuestion.source,
                additionalContext?.trim() || null
            ).trim();
        }
        if (intent === 'screen_scan') {
            return buildScreenScanMessage(screenScanMode || 'ui_general', message?.trim() || null).trim();
        }
        return (message || defaultQuestion).trim();
    })();
    const transcript = buildTranscriptContext(session, intent, question, mode);
    const modeInstructions = buildModeContext(mode, { includeModeCustomContext: resolvedPolicy.includeModeCustomContext });
    const profileResult = await buildProfileContext(intent, profile, question, resolvedPolicy.resolvedProfilePreference);
    const intentInstructions = buildIntentPrompt(intent, mode, screenScanMode, question, profileResult.profile?.used === true);
    const profileInstruction = profileResult.profile?.instruction?.trim()
        ? [createInstruction('profile_instruction', 'PROFILE INTELLIGENCE', profileResult.profile.instruction.trim())]
        : [];
    const ragContext = resolvedPolicy.includeRag ? buildRagContext(rag) : null;
    const supplementalContext = resolvedPolicy.includeAdditionalContext ? buildSupplementalContext(additionalContext) : null;
    const ragInstructions = ragContext
        ? [createInstruction('rag_rules', 'RAG RULES', [
            'If RAG MEMORY is present, answer using it as the primary factual source.',
            'If the requested detail is not in RAG MEMORY, say so briefly and do not invent it.',
            'Do not mention retrieval, chunks, embeddings, or internal systems.',
        ].join('\n'))]
        : [];

    const promptObject: PromptObject = {
        mode,
        intent,
        question,
        transcript,
        profile: profileResult.profile ?? null,
        supplemental: supplementalContext,
        rag: ragContext,
        instructions: [
            ...intentInstructions,
            ...modeInstructions,
            ...profileInstruction,
            ...ragInstructions,
        ].map((instruction) => ({
            ...instruction,
            content: normalizeInstructionContent(instruction.content),
        })),
    };

    return {
        promptObject,
        directResponse: profileResult.directResponse,
        profileApplied: profileResult.profile?.used === true,
        profilePolicy: profileResult.profile?.policy ?? resolvedPolicy.profilePolicy,
        transcriptStrategy: transcript.strategy,
        transcriptLength: transcript.content.length,
        transcriptApproxTokens: transcript.approxTokens,
    };
}

export async function buildContext(args: BuildContextArgs): Promise<BuiltActionContext> {
    const layers = await buildContextLayers(args);
    return {
        layers,
        serialized: serializePromptObject(layers.promptObject),
    };
}

export function serializePromptObject(promptObject: PromptObject): SerializedPrompt {
    const systemPrompt = promptObject.instructions
        .map((section) => `## ${section.title}\n${section.content}`)
        .join('\n\n')
        .trim();

    const contextSections = [
        promptObject.rag?.content?.trim()
            ? `[${promptObject.rag.title}]\n${promptObject.rag.content.trim()}`
            : '',
        promptObject.supplemental?.content?.trim()
            ? `[${promptObject.supplemental.title}]\n${promptObject.supplemental.content.trim()}`
            : '',
        promptObject.profile?.context?.trim()
            ? `[${promptObject.profile.title}]\n${promptObject.profile.context.trim()}`
            : '',
        promptObject.transcript.content.trim()
            ? `[${promptObject.transcript.title}]\n${promptObject.transcript.content.trim()}`
            : '',
    ].filter(Boolean);

    const context = contextSections.join('\n\n').trim();
    const finalPrompt = [
        systemPrompt ? `[SYSTEM PROMPT]\n${systemPrompt}` : '',
        context ? `[CONTEXT]\n${context}` : '',
        `[USER QUESTION]\n${promptObject.question}`,
    ].filter(Boolean).join('\n\n');

    return {
        systemPrompt,
        context,
        finalPrompt,
    };
}
