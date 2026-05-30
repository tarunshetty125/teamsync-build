import type { PromptContextOrderKey, PromptInstruction, PromptObject, PromptProfileSection, PromptContextSection } from '../ActionContextBuilder';
import type { ModeTemplateId } from '../../src/lib/modes/types';

type LlmProvider = 'ollama' | 'gemini' | 'custom' | 'bedrock';
type AdaptivePromptTier = 'weak_local' | 'medium_local' | 'strong_local' | 'cloud';
type AdaptivePromptMode =
    | 'general'
    | 'technical-interview'
    | 'sales'
    | 'recruiting'
    | 'team-meet'
    | 'lecture'
    | 'looking-for-work';

interface ReferenceChunk {
    fileName: string;
    content: string;
}

interface RankedChunk extends ReferenceChunk {
    score: number;
}

interface TierPolicy {
    transcriptRecentLines: number;
    transcriptMemoryLines: number;
    brainSignalLines: number;
    ruleLines: number;
    referenceChunks: number;
    userContextLines: number;
    supplementalLines: number;
    ragLines: number;
    profileLines: number;
    keepReliabilityLines: number;
    useOriginalTranscript: boolean;
}

export interface AdaptivePromptBudgetArgs {
    originalPrompt: PromptObject;
    compiledPrompt: PromptObject;
    tinyPromptApplied: boolean;
    tinyPromptMode?: ModeTemplateId | null;
    currentModel?: string | null;
    provider?: LlmProvider;
}

export interface AdaptivePromptBudgetResult {
    prompt: PromptObject;
    maxTokens: number;
    tier: AdaptivePromptTier;
    mode: AdaptivePromptMode;
    applied: boolean;
    metrics: {
        inputTokens: number;
        outputTokens: number;
        compressionRatio: number;
        budgetLatencyMs: number;
    };
}

const DEFAULT_MAX_ACTION_PROMPT_TOKENS = 8000;
const LOCAL_MODEL_FAMILY_PATTERN = /\b(qwen(?:2(?:\.5)?)?|minicpm(?:-v)?|llama(?:\d+(?:\.\d+)?)?|mistral|gemma)\b/i;
const CLOUD_MODEL_FAMILY_PATTERN = /\b(gpt|claude|gemini|groq)\b/i;
const CONTEXT_ORDER: PromptContextOrderKey[] = ['transcript', 'supplemental', 'rag', 'profile'];
const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'by', 'for', 'from', 'how',
    'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our',
    'so', 'that', 'the', 'their', 'them', 'there', 'these', 'they', 'this', 'to',
    'us', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you', 'your',
]);

const MODE_HINTS: Record<AdaptivePromptMode, string> = {
    general: 'meeting context decisions blockers next steps',
    'technical-interview': 'coding algorithm complexity edge cases system design',
    sales: 'objection pricing budget urgency discovery value next step',
    recruiting: 'ownership leadership measurable impact star signals risks',
    'team-meet': 'decision action item owner deadline blocker risk',
    lecture: 'concept explanation takeaway question example',
    'looking-for-work': 'behavioral star resume alignment role fit confidence',
};

const MODE_BUDGETS: Record<AdaptivePromptTier, Record<AdaptivePromptMode, number>> = {
    weak_local: {
        general: 800,
        'technical-interview': 900,
        sales: 700,
        recruiting: 700,
        'team-meet': 700,
        lecture: 650,
        'looking-for-work': 750,
    },
    medium_local: {
        general: 1200,
        'technical-interview': 1500,
        sales: 1100,
        recruiting: 1100,
        'team-meet': 1200,
        lecture: 1000,
        'looking-for-work': 1100,
    },
    strong_local: {
        general: 1800,
        'technical-interview': 2200,
        sales: 1600,
        recruiting: 1600,
        'team-meet': 1700,
        lecture: 1500,
        'looking-for-work': 1600,
    },
    cloud: {
        general: DEFAULT_MAX_ACTION_PROMPT_TOKENS,
        'technical-interview': DEFAULT_MAX_ACTION_PROMPT_TOKENS,
        sales: DEFAULT_MAX_ACTION_PROMPT_TOKENS,
        recruiting: DEFAULT_MAX_ACTION_PROMPT_TOKENS,
        'team-meet': DEFAULT_MAX_ACTION_PROMPT_TOKENS,
        lecture: DEFAULT_MAX_ACTION_PROMPT_TOKENS,
        'looking-for-work': DEFAULT_MAX_ACTION_PROMPT_TOKENS,
    },
};

const TIER_POLICY: Record<AdaptivePromptTier, TierPolicy> = {
    weak_local: {
        transcriptRecentLines: 4,
        transcriptMemoryLines: 1,
        brainSignalLines: 2,
        ruleLines: 4,
        referenceChunks: 2,
        userContextLines: 2,
        supplementalLines: 1,
        ragLines: 2,
        profileLines: 2,
        keepReliabilityLines: 2,
        useOriginalTranscript: false,
    },
    medium_local: {
        transcriptRecentLines: 7,
        transcriptMemoryLines: 3,
        brainSignalLines: 3,
        ruleLines: 6,
        referenceChunks: 4,
        userContextLines: 3,
        supplementalLines: 2,
        ragLines: 4,
        profileLines: 3,
        keepReliabilityLines: 3,
        useOriginalTranscript: true,
    },
    strong_local: {
        transcriptRecentLines: 10,
        transcriptMemoryLines: 5,
        brainSignalLines: 4,
        ruleLines: 8,
        referenceChunks: 5,
        userContextLines: 4,
        supplementalLines: 3,
        ragLines: 6,
        profileLines: 5,
        keepReliabilityLines: 3,
        useOriginalTranscript: true,
    },
    cloud: {
        transcriptRecentLines: 0,
        transcriptMemoryLines: 0,
        brainSignalLines: 0,
        ruleLines: 0,
        referenceChunks: 0,
        userContextLines: 0,
        supplementalLines: 0,
        ragLines: 0,
        profileLines: 0,
        keepReliabilityLines: 0,
        useOriginalTranscript: true,
    },
};

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
}

function normalizeWhitespace(text: string): string {
    return text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function sanitizeSnippet(text: string, maxChars = 220): string {
    const compact = normalizeWhitespace(text)
        .replace(/^[-*•]\s*/g, '')
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/\[\.{3}truncated\]/gi, '')
        .trim();
    if (!compact) return '';
    return compact.length > maxChars
        ? `${compact.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
        : compact;
}

function compactLine(line: string, maxWords = 18): string {
    const sanitized = sanitizeSnippet(line, 260);
    if (!sanitized) return '';
    const words = sanitized.split(/\s+/);
    return words.length > maxWords
        ? `${words.slice(0, maxWords).join(' ')}…`
        : sanitized;
}

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function uniqueOrdered<T>(values: T[]): T[] {
    const seen = new Set<T>();
    const result: T[] = [];
    for (const value of values) {
        if (seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }
    return result;
}

function lexicalScore(text: string, terms: string[]): number {
    if (!text.trim() || terms.length === 0) return 0;
    const normalized = text.toLowerCase();
    let score = 0;
    for (const term of terms) {
        if (normalized.includes(term)) {
            score += term.length >= 8 ? 2 : 1;
        }
    }
    return score;
}

function parseModelSizeBillions(model: string): number | null {
    const normalized = model.toLowerCase();
    const sizedMatch = normalized.match(/(\d+(?:\.\d+)?)\s*b\b/);
    if (sizedMatch) {
        return Number(sizedMatch[1]);
    }

    const compactMatch = normalized.match(/(?:^|[^a-z0-9])(\d{2,3})b?(?:[^a-z0-9]|$)/);
    if (compactMatch) {
        return Number(compactMatch[1]);
    }

    return null;
}

function detectTier(model: string | null | undefined, provider: LlmProvider | undefined): AdaptivePromptTier {
    const normalizedModel = (model || '').trim().toLowerCase();
    if (!normalizedModel) {
        return provider === 'ollama' ? 'weak_local' : 'cloud';
    }

    if (provider === 'gemini' || CLOUD_MODEL_FAMILY_PATTERN.test(normalizedModel)) {
        return 'cloud';
    }

    const looksLocalFamily = provider === 'ollama' || LOCAL_MODEL_FAMILY_PATTERN.test(normalizedModel);
    if (!looksLocalFamily) {
        return 'cloud';
    }

    if (/minicpm(?:-v)?/i.test(normalizedModel)) {
        return 'weak_local';
    }

    if (/mistral-medium/i.test(normalizedModel)) {
        return 'medium_local';
    }

    const sizeB = parseModelSizeBillions(normalizedModel);
    if (sizeB !== null) {
        if (sizeB >= 60) return 'strong_local';
        if (sizeB >= 12) return 'medium_local';
        return 'weak_local';
    }

    if (/\b(70b|72b|90b|120b)\b/i.test(normalizedModel)) {
        return 'strong_local';
    }

    if (/\b(13b|14b|20b|22b|27b|30b|34b)\b/i.test(normalizedModel)) {
        return 'medium_local';
    }

    return 'weak_local';
}

function resolveMode(mode?: ModeTemplateId | null): AdaptivePromptMode {
    switch (mode) {
        case 'technical-interview':
        case 'sales':
        case 'recruiting':
        case 'team-meet':
        case 'lecture':
        case 'looking-for-work':
            return mode;
        default:
            return 'general';
    }
}

function parseModeContextBlock(block: string): { userContext: string[]; referenceFiles: ReferenceChunk[] } {
    const userContext: string[] = [];
    const referenceFiles: ReferenceChunk[] = [];
    const normalized = block || '';

    const userContextRegex = /<user_context>\s*([\s\S]*?)\s*<\/user_context>/gi;
    let userMatch: RegExpExecArray | null = userContextRegex.exec(normalized);
    while (userMatch) {
        if (userMatch[1]?.trim()) {
            userContext.push(userMatch[1].trim());
        }
        userMatch = userContextRegex.exec(normalized);
    }

    const referenceRegex = /<reference_file name="([^"]+)">\s*([\s\S]*?)\s*<\/reference_file>/gi;
    let referenceMatch: RegExpExecArray | null = referenceRegex.exec(normalized);
    while (referenceMatch) {
        const fileName = referenceMatch[1]?.trim();
        const content = referenceMatch[2]?.trim();
        if (fileName && content) {
            referenceFiles.push({ fileName, content });
        }
        referenceMatch = referenceRegex.exec(normalized);
    }

    return { userContext, referenceFiles };
}

function chunkReferenceContent(fileName: string, content: string, maxChunkChars = 460): ReferenceChunk[] {
    const normalized = normalizeWhitespace(content);
    if (!normalized) return [];

    const rawParts = normalized
        .split(/\n\n+/)
        .flatMap((part) => part.split(/\n(?=[A-Z0-9][^:\n]{0,80}:)/))
        .map((part) => sanitizeSnippet(part, maxChunkChars))
        .filter(Boolean);

    if (rawParts.length === 0) return [];

    const chunks: ReferenceChunk[] = [];
    let current = '';

    for (const part of rawParts) {
        if (!current) {
            current = part;
            continue;
        }

        if ((current.length + part.length + 1) <= maxChunkChars) {
            current = `${current}\n${part}`;
            continue;
        }

        chunks.push({ fileName, content: current });
        current = part;
    }

    if (current) {
        chunks.push({ fileName, content: current });
    }

    return chunks;
}

function summarizeContextLines(text: string, terms: string[], maxLines: number): string[] {
    const lines = normalizeWhitespace(text)
        .split(/\n+/)
        .map((line) => compactLine(line))
        .filter(Boolean);
    if (lines.length === 0) return [];

    return uniqueOrdered(
        lines
            .map((line, index) => ({
                line,
                index,
                score: lexicalScore(line, terms),
            }))
            .sort((a, b) => (b.score - a.score) || (a.index - b.index))
            .slice(0, maxLines)
            .sort((a, b) => a.index - b.index)
            .map((entry) => entry.line)
    );
}

function approximatePromptTokens(prompt: PromptObject): number {
    const instructionTokens = prompt.instructions.reduce((sum, instruction) => (
        sum + estimateTokens(instruction.title) + estimateTokens(instruction.content)
    ), 0);
    const transcriptTokens = prompt.transcript?.approxTokens ?? estimateTokens(prompt.transcript?.content ?? '');
    const ragTokens = prompt.rag?.approxTokens ?? estimateTokens(prompt.rag?.content ?? '');
    const supplementalTokens = prompt.supplemental?.approxTokens ?? estimateTokens(prompt.supplemental?.content ?? '');
    const profileTokens = prompt.profile?.approxTokens ?? estimateTokens(prompt.profile?.context ?? '');
    return instructionTokens + transcriptTokens + ragTokens + supplementalTokens + profileTokens + estimateTokens(prompt.question);
}

function compressTranscript(rawTranscript: string, question: string, mode: AdaptivePromptMode, policy: TierPolicy): string {
    const lines = rawTranscript
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length === 0) {
        return '[NO TRANSCRIPT AVAILABLE]';
    }

    const recent = lines
        .slice(-policy.transcriptRecentLines)
        .map((line) => compactLine(line, 26))
        .filter(Boolean);
    const earlier = lines.slice(0, Math.max(0, lines.length - policy.transcriptRecentLines));

    if (policy.transcriptMemoryLines <= 0 || earlier.length === 0) {
        return recent.join('\n');
    }

    const memoryTerms = uniqueOrdered([...tokenize(question), ...tokenize(MODE_HINTS[mode])]);
    const memory = earlier
        .map((line, index) => ({
            line: compactLine(line, 18),
            index,
            score: lexicalScore(line, memoryTerms),
        }))
        .filter((entry) => entry.line)
        .sort((a, b) => (b.score - a.score) || (b.index - a.index))
        .slice(0, policy.transcriptMemoryLines)
        .sort((a, b) => a.index - b.index)
        .map((entry) => `- ${entry.line}`);

    return [
        memory.length > 0 ? '[MEMORY]' : '',
        ...memory,
        '[RECENT]',
        ...recent,
    ].filter(Boolean).join('\n');
}

function compressProfile(profile: PromptProfileSection | null, question: string, mode: AdaptivePromptMode, policy: TierPolicy): PromptProfileSection | null {
    if (!profile?.context?.trim() || policy.profileLines <= 0) return null;
    const lines = summarizeContextLines(
        profile.context,
        uniqueOrdered([...tokenize(question), ...tokenize(MODE_HINTS[mode])]),
        policy.profileLines,
    );
    if (lines.length === 0) return null;
    const content = lines.map((line) => `- ${line}`).join('\n');
    return {
        ...profile,
        context: content,
        approxTokens: estimateTokens(content),
    };
}

function compressSection(section: PromptContextSection | null, question: string, mode: AdaptivePromptMode, maxLines: number): PromptContextSection | null {
    if (!section?.content?.trim() || maxLines <= 0) return null;
    const lines = summarizeContextLines(
        section.content,
        uniqueOrdered([...tokenize(question), ...tokenize(MODE_HINTS[mode])]),
        maxLines,
    );
    if (lines.length === 0) return null;
    const content = lines.map((line) => `- ${line}`).join('\n');
    return {
        title: section.title,
        content,
        approxTokens: estimateTokens(content),
    };
}

function rankReferenceChunks(referenceFiles: ReferenceChunk[], question: string, mode: AdaptivePromptMode): RankedChunk[] {
    const chunks = referenceFiles.flatMap((file) => chunkReferenceContent(file.fileName, file.content));
    const terms = uniqueOrdered([...tokenize(question), ...tokenize(MODE_HINTS[mode])]);
    return chunks
        .map((chunk) => ({
            ...chunk,
            score: lexicalScore(`${chunk.fileName} ${chunk.content}`, terms),
        }))
        .sort((a, b) => (b.score - a.score) || (a.content.length - b.content.length));
}

function buildSupplemental(
    originalPrompt: PromptObject,
    question: string,
    mode: AdaptivePromptMode,
    policy: TierPolicy,
): PromptContextSection | null {
    const modeContextInstruction = originalPrompt.instructions.find((instruction) => instruction.key === 'active_mode_context');
    const { userContext, referenceFiles } = parseModeContextBlock(modeContextInstruction?.content ?? '');
    const rankedReferences = rankReferenceChunks(referenceFiles, question, mode).slice(0, policy.referenceChunks);
    const terms = uniqueOrdered([...tokenize(question), ...tokenize(MODE_HINTS[mode])]);

    const parts: string[] = [];
    const userContextLines = userContext
        .flatMap((entry) => summarizeContextLines(entry, terms, policy.userContextLines))
        .slice(0, policy.userContextLines);

    if (userContextLines.length > 0) {
        parts.push('[MODE NOTES]', ...userContextLines.map((line) => `- ${line}`));
    }

    if (rankedReferences.length > 0) {
        parts.push(
            '[REFERENCE SNIPPETS]',
            ...rankedReferences.map((chunk) => `- [${chunk.fileName}] ${sanitizeSnippet(chunk.content, 190)}`),
        );
    }

    const extraContext = originalPrompt.supplemental?.content?.trim();
    if (extraContext && policy.supplementalLines > 0) {
        const extraLines = summarizeContextLines(extraContext, terms, policy.supplementalLines);
        if (extraLines.length > 0) {
            parts.push('[LEGACY CONTEXT]', ...extraLines.map((line) => `- ${line}`));
        }
    }

    const content = parts.join('\n').trim();
    if (!content) return null;
    return {
        title: originalPrompt.supplemental?.title ?? 'MODE MEMORY',
        content,
        approxTokens: estimateTokens(content),
    };
}

function compressInstructionList(content: string, maxLines: number): string {
    if (maxLines <= 0) return '';
    const lines = content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    return lines.slice(0, maxLines).join('\n');
}

function buildAdaptiveInstructions(compiledPrompt: PromptObject, policy: TierPolicy): PromptInstruction[] {
    return compiledPrompt.instructions
        .map((instruction) => {
            if (instruction.key === 'tiny_signals') {
                return {
                    ...instruction,
                    content: compressInstructionList(instruction.content, policy.brainSignalLines),
                };
            }

            if (instruction.key === 'tiny_rules') {
                return {
                    ...instruction,
                    content: compressInstructionList(instruction.content, policy.ruleLines),
                };
            }

            if (instruction.key === 'tiny_reliability') {
                return {
                    ...instruction,
                    content: compressInstructionList(instruction.content, policy.keepReliabilityLines),
                };
            }

            return instruction;
        })
        .filter((instruction) => instruction.content.trim().length > 0);
}

export function adaptPromptBudget(args: AdaptivePromptBudgetArgs): AdaptivePromptBudgetResult {
    const startedAt = Date.now();
    const mode = resolveMode(args.tinyPromptMode);
    const tier = detectTier(args.currentModel, args.provider);
    const inputPrompt = args.tinyPromptApplied ? args.compiledPrompt : args.originalPrompt;
    const inputTokens = approximatePromptTokens(inputPrompt);

    if (tier === 'cloud') {
        return {
            prompt: inputPrompt,
            maxTokens: MODE_BUDGETS.cloud[mode],
            tier,
            mode,
            applied: false,
            metrics: {
                inputTokens,
                outputTokens: inputTokens,
                compressionRatio: 0,
                budgetLatencyMs: Date.now() - startedAt,
            },
        };
    }

    const policy = TIER_POLICY[tier];
    const transcriptSource = policy.useOriginalTranscript
        ? args.originalPrompt.transcript.content
        : args.compiledPrompt.transcript.content;
    const transcriptContent = compressTranscript(transcriptSource, inputPrompt.question, mode, policy);
    const adaptedPrompt: PromptObject = {
        ...inputPrompt,
        instructions: buildAdaptiveInstructions(args.compiledPrompt, policy),
        transcript: {
            ...inputPrompt.transcript,
            content: transcriptContent,
            approxTokens: estimateTokens(transcriptContent),
        },
        supplemental: buildSupplemental(args.originalPrompt, inputPrompt.question, mode, policy),
        rag: compressSection(args.originalPrompt.rag, inputPrompt.question, mode, policy.ragLines),
        profile: compressProfile(args.originalPrompt.profile, inputPrompt.question, mode, policy),
        contextOrder: CONTEXT_ORDER,
    };

    const outputTokens = approximatePromptTokens(adaptedPrompt);
    const compressionRatio = inputTokens > 0
        ? Math.max(0, (inputTokens - outputTokens) / inputTokens)
        : 0;
    const budgetLatencyMs = Date.now() - startedAt;
    const maxTokens = MODE_BUDGETS[tier][mode];

    console.log(
        `[AdaptiveBudget] model=${args.currentModel || 'unknown'} provider=${args.provider || 'unknown'} tier=${tier} mode=${mode} tokens=${outputTokens} budget=${maxTokens} compression=${Math.round(compressionRatio * 100)}% latency_ms=${budgetLatencyMs}`
    );

    return {
        prompt: adaptedPrompt,
        maxTokens,
        tier,
        mode,
        applied: true,
        metrics: {
            inputTokens,
            outputTokens,
            compressionRatio,
            budgetLatencyMs,
        },
    };
}
