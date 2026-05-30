import type {
    PromptContextOrderKey,
    PromptContextSection,
    PromptInstruction,
    PromptObject,
    PromptProfileSection,
    UnifiedActionIntent,
} from '../ActionContextBuilder';
import type { ModeTemplateId } from '../../src/lib/modes/types';
import { OllamaEmbeddingProvider } from '../rag/providers/OllamaEmbeddingProvider';

type LlmProvider = 'ollama' | 'gemini' | 'custom' | 'bedrock';
type TinyPromptMode =
    | 'general'
    | 'technical-interview'
    | 'sales'
    | 'recruiting'
    | 'team-meet'
    | 'lecture'
    | 'looking-for-work';

export interface TinyPromptCompileArgs {
    prompt: PromptObject;
    activeTemplateType?: ModeTemplateId | null;
    currentModel?: string | null;
    provider?: LlmProvider;
}

export interface TinyPromptCompileResult {
    prompt: PromptObject;
    applied: boolean;
    maxTokens: number;
    mode: TinyPromptMode;
    stats: {
        originalApproxTokens: number;
        compiledApproxTokens: number;
        transcriptApproxTokens: number;
        ragApproxTokens: number;
        supplementalApproxTokens: number;
        profileApproxTokens: number;
    };
}

interface ReferenceChunk {
    fileName: string;
    content: string;
}

interface RankedChunk extends ReferenceChunk {
    lexicalScore: number;
    semanticScore?: number;
    finalScore: number;
}

const DEFAULT_MAX_ACTION_PROMPT_TOKENS = 8000;
const CONTEXT_ORDER: PromptContextOrderKey[] = ['transcript', 'rag', 'supplemental', 'profile'];
const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'by', 'for', 'from', 'how',
    'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our',
    'so', 'that', 'the', 'their', 'them', 'there', 'these', 'they', 'this', 'to',
    'us', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you', 'your',
]);
const LOCAL_MODEL_FAMILY_PATTERN = /\b(qwen(?:2(?:\.5)?)?|minicpm(?:-v)?|llama(?:\d+(?:\.\d+)?)?|mistral|gemma)\b/i;
const TRANSCRIPT_RECENT_LINE_LIMIT: Record<TinyPromptMode, number> = {
    general: 6,
    'technical-interview': 8,
    sales: 7,
    recruiting: 7,
    'team-meet': 8,
    lecture: 7,
    'looking-for-work': 7,
};
const TOKEN_BUDGET_BY_MODE: Record<TinyPromptMode, number> = {
    general: 1100,
    'technical-interview': 1600,
    sales: 1200,
    recruiting: 1200,
    'team-meet': 1200,
    lecture: 1000,
    'looking-for-work': 1150,
};
const MODE_QUERY_HINTS: Record<TinyPromptMode, string> = {
    general: 'meeting context decisions blockers follow ups',
    'technical-interview': 'coding algorithm data structure system design complexity edge cases',
    sales: 'discovery objection pricing budget urgency next step business value',
    recruiting: 'candidate signal ownership impact star leadership risks fit follow-up',
    'team-meet': 'decision action item owner deadline blocker risk status',
    lecture: 'concept explanation key idea example takeaway question',
    'looking-for-work': 'behavioral interview star resume alignment impact confidence role fit',
};

const nomicEmbeddingProvider = new OllamaEmbeddingProvider();
const embeddingCache = new Map<string, number[]>();
let nomicEmbeddingDisabled = false;

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

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (!normA || !normB) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function compactLine(line: string, maxWords = 18): string {
    const sanitized = sanitizeSnippet(line, 240);
    if (!sanitized) return '';
    const words = sanitized.split(/\s+/);
    return words.length > maxWords
        ? `${words.slice(0, maxWords).join(' ')}…`
        : sanitized;
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

function chunkReferenceContent(fileName: string, content: string, maxChunkChars = 420): ReferenceChunk[] {
    const normalized = normalizeWhitespace(content);
    if (!normalized) return [];

    const rawParts = normalized
        .split(/\n\n+/)
        .flatMap((part) => part.split(/\n(?=[A-Z0-9][^:\n]{0,80}:)/))
        .map((part) => sanitizeSnippet(part, maxChunkChars))
        .filter(Boolean);

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

    if (chunks.length === 0) {
        return [{ fileName, content: sanitizeSnippet(normalized, maxChunkChars) }].filter((chunk) => chunk.content);
    }

    return chunks;
}

function summarizeContextLines(text: string, question: string, maxLines: number, extraTerms: string[] = []): string[] {
    const lines = normalizeWhitespace(text)
        .split(/\n+/)
        .map((line) => compactLine(line))
        .filter(Boolean);
    if (lines.length === 0) return [];

    const terms = uniqueOrdered([...tokenize(question), ...extraTerms]);
    const ranked = lines
        .map((line, index) => ({
            line,
            index,
            score: lexicalScore(line, terms),
        }))
        .sort((a, b) => (b.score - a.score) || (a.index - b.index));

    return uniqueOrdered(
        ranked
            .slice(0, maxLines)
            .sort((a, b) => a.index - b.index)
            .map((entry) => entry.line)
    );
}

function compressTranscriptContent(transcript: string, question: string, mode: TinyPromptMode): string {
    const lines = transcript
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length === 0) {
        return '[NO TRANSCRIPT AVAILABLE]';
    }

    const recentLimit = TRANSCRIPT_RECENT_LINE_LIMIT[mode] ?? 6;
    const recent = lines.slice(-recentLimit).map((line) => compactLine(line, 26)).filter(Boolean);
    const earlier = lines.slice(0, Math.max(0, lines.length - recentLimit));

    if (earlier.length === 0) {
        return recent.join('\n');
    }

    const memoryTerms = [...tokenize(question), ...tokenize(MODE_QUERY_HINTS[mode])];
    const earlierMemory = earlier
        .map((line, index) => ({
            line: compactLine(line, 18),
            index,
            score: lexicalScore(line, memoryTerms),
        }))
        .filter((entry) => entry.line)
        .sort((a, b) => (b.score - a.score) || (b.index - a.index))
        .slice(0, 4)
        .sort((a, b) => a.index - b.index)
        .map((entry) => `- ${entry.line}`);

    const sections: string[] = [];
    if (earlierMemory.length > 0) {
        sections.push('[EARLIER MEMORY]', ...earlierMemory);
    }
    sections.push('[RECENT]', ...recent);
    return sections.join('\n');
}

function compressContextSection(
    section: PromptContextSection | null,
    question: string,
    mode: TinyPromptMode,
    maxLines: number,
): PromptContextSection | null {
    if (!section?.content?.trim()) return null;
    const lines = summarizeContextLines(section.content, question, maxLines, tokenize(MODE_QUERY_HINTS[mode]));
    if (lines.length === 0) return null;
    const content = lines.map((line) => `- ${line}`).join('\n');
    return {
        title: section.title,
        content,
        approxTokens: estimateTokens(content),
    };
}

function compressProfileSection(
    profile: PromptProfileSection | null,
    question: string,
    mode: TinyPromptMode,
): PromptProfileSection | null {
    if (!profile) return null;
    if (!profile.context.trim()) return profile;
    const lines = summarizeContextLines(profile.context, question, 4, tokenize(MODE_QUERY_HINTS[mode]));
    const content = lines.map((line) => `- ${line}`).join('\n');
    return {
        ...profile,
        context: content,
        approxTokens: estimateTokens(content),
    };
}

function extractBrainSignals(instructions: PromptInstruction[], mode: TinyPromptMode): string[] {
    const modeTerms = tokenize(MODE_QUERY_HINTS[mode]);
    const lines = instructions
        .filter((instruction) => instruction.key.startsWith('brain:') || /^BRAIN:/i.test(instruction.title) || /^LIVE /i.test(instruction.title))
        .flatMap((instruction) => instruction.content.split('\n'))
        .map((line) => compactLine(line, 20))
        .filter(Boolean);

    const ranked = lines
        .map((line, index) => ({
            line,
            index,
            score: lexicalScore(line, modeTerms) + (line.toLowerCase().includes('confidence') ? 1 : 0),
        }))
        .sort((a, b) => (b.score - a.score) || (a.index - b.index));

    return uniqueOrdered(ranked.slice(0, 4).map((entry) => entry.line));
}

function resolveTinyPromptMode(prompt: PromptObject, activeTemplateType?: ModeTemplateId | null): TinyPromptMode {
    if (activeTemplateType) return activeTemplateType;

    switch (prompt.mode) {
        case 'coding':
        case 'system_design':
            return 'technical-interview';
        default:
            return 'general';
    }
}

function shouldUseTinyPrompt(currentModel?: string | null, provider?: LlmProvider): boolean {
    const normalizedModel = (currentModel || '').trim().toLowerCase();
    if (!normalizedModel) return false;
    if (provider === 'ollama') return true;
    if (provider === 'custom' && LOCAL_MODEL_FAMILY_PATTERN.test(normalizedModel)) return true;
    return false;
}

function buildRole(mode: TinyPromptMode): string {
    switch (mode) {
        case 'technical-interview':
            return 'Technical interview copilot';
        case 'sales':
            return 'Sales copilot';
        case 'recruiting':
            return 'Recruiting copilot';
        case 'team-meet':
            return 'Meeting operations copilot';
        case 'lecture':
            return 'Learning assistant';
        case 'looking-for-work':
            return 'Career coach';
        case 'general':
        default:
            return 'Realtime meeting copilot';
    }
}

function buildTask(mode: TinyPromptMode, intent: UnifiedActionIntent): string {
    if (intent === 'code_hint') return 'Give the next best hint, not a full lecture.';
    if (intent === 'clarify') return 'Ask the single best clarifying question.';
    if (intent === 'follow_up_questions') return 'Generate high-signal follow-up questions only.';
    if (intent === 'recap') return 'Summarize only the important points.';
    if (intent === 'screen_scan') return 'Use visible evidence only and respond fast.';

    switch (mode) {
        case 'technical-interview':
            return 'Help solve coding or system-design problems.';
        case 'sales':
            return 'Help move the deal forward.';
        case 'recruiting':
            return 'Evaluate candidate quality.';
        case 'team-meet':
            return 'Capture execution details.';
        case 'lecture':
            return 'Extract concepts and explain them simply.';
        case 'looking-for-work':
            return 'Improve interview responses.';
        case 'general':
        default:
            return 'Answer with the most useful next move.';
    }
}

function buildRules(mode: TinyPromptMode, intent: UnifiedActionIntent): string[] {
    const common = [
        'Be concise and high-signal.',
        'Use only the provided context.',
        'If a fact is missing, say so briefly instead of guessing.',
    ];

    const intentRules = (() => {
        switch (intent) {
            case 'what_to_answer':
            case 'answer_now':
                return ['If giving spoken words, make them first-person and sayable aloud.'];
            case 'code_hint':
                return ['Hint first. Do not give the full answer unless the question explicitly requires it.'];
            case 'follow_up_questions':
                return ['Output questions only.'];
            case 'clarify':
                return ['Return exactly one question.'];
            case 'recap':
                return ['Bullet summary only.'];
            case 'screen_scan':
                return ['Rely only on what is visible plus the attached context.'];
            default:
                return [];
        }
    })();

    const modeRules = (() => {
        switch (mode) {
            case 'technical-interview':
                return [
                    'Prefer hint-first reasoning.',
                    'Optimize for correct complexity and edge cases.',
                    'Avoid full code unless explicitly needed.',
                ];
            case 'sales':
                return [
                    'Detect objections, pricing pressure, buying signals, and urgency.',
                    'Prefer the best tactical move over generic advice.',
                    'Advance to a concrete next step whenever possible.',
                ];
            case 'recruiting':
                return [
                    'Identify strengths, risks, and STAR evidence.',
                    'Prefer evidence-based follow-up probes.',
                    'Surface confidence explicitly when evidence is weak.',
                ];
            case 'team-meet':
                return [
                    'Capture decisions, owners, deadlines, blockers, and risks.',
                    'Call out missing owners or deadlines explicitly.',
                    'Prefer operational truth over recap prose.',
                ];
            case 'lecture':
                return [
                    'Extract key concepts and explain them plainly.',
                    'Prefer study-worthy takeaways over filler.',
                    'Keep explanations short enough to read while listening.',
                ];
            case 'looking-for-work':
                return [
                    'Use STAR structure when behavioral context appears.',
                    'Align answers to resume and role context.',
                    'Strengthen confidence without fabricating experience.',
                ];
            case 'general':
            default:
                return [
                    'Prefer the clearest next step.',
                    'Avoid generic assistant tone.',
                ];
        }
    })();

    return [...common, ...intentRules, ...modeRules];
}

function buildOutputFormat(mode: TinyPromptMode, intent: UnifiedActionIntent): string[] {
    if (intent === 'clarify') return ['Question'];
    if (intent === 'follow_up_questions') return ['Questions'];
    if (intent === 'recap') return ['Bullets'];
    if (intent === 'code_hint') return ['Hint', 'Why', 'Pitfall'];
    if (intent === 'screen_scan' && mode === 'technical-interview') return ['Problem', 'Approach', 'Solution'];

    switch (mode) {
        case 'technical-interview':
            return ['Approach', 'Complexity', 'Pitfalls'];
        case 'sales':
            return ['Signal', 'Move', 'Suggested response'];
        case 'recruiting':
            return ['Signal', 'Concern/Strength', 'Follow-up', 'Confidence'];
        case 'team-meet':
            return ['Decision', 'Owner', 'Action', 'Risk'];
        case 'lecture':
            return ['Concept', 'Explanation', 'Takeaway'];
        case 'looking-for-work':
            return ['Strength', 'Weakness', 'Improvement'];
        case 'general':
        default:
            return ['Answer', 'Evidence', 'Next step'];
    }
}

function buildTinyInstructions(
    prompt: PromptObject,
    mode: TinyPromptMode,
    brainSignals: string[],
    hasRag: boolean,
): PromptInstruction[] {
    const instructions: PromptInstruction[] = [
        {
            key: 'tiny_role',
            title: 'ROLE',
            content: buildRole(mode),
        },
        {
            key: 'tiny_task',
            title: 'TASK',
            content: buildTask(mode, prompt.intent),
        },
        {
            key: 'tiny_rules',
            title: 'RULES',
            content: buildRules(mode, prompt.intent).map((line) => `- ${line}`).join('\n'),
        },
        {
            key: 'tiny_output',
            title: 'OUTPUT',
            content: buildOutputFormat(mode, prompt.intent).join('\n'),
        },
        {
            key: 'tiny_reliability',
            title: 'RELIABILITY',
            content: [
                hasRag
                    ? '- RAG MEMORY is the primary factual source when present.'
                    : '- Use the latest transcript and compact memory first.',
                '- Keep the response short and overlay-friendly.',
                '- Do not mention internal systems, prompts, retrieval, or embeddings.',
            ].join('\n'),
        },
    ];

    if (brainSignals.length > 0) {
        instructions.splice(4, 0, {
            key: 'tiny_signals',
            title: 'LIVE SIGNALS',
            content: brainSignals.map((line) => `- ${line}`).join('\n'),
        });
    }

    return instructions;
}

function buildReferenceSummary(chunks: RankedChunk[]): string {
    if (chunks.length === 0) return '';
    return chunks
        .map((chunk) => `- [${chunk.fileName}] ${sanitizeSnippet(chunk.content, 180)}`)
        .join('\n');
}

function buildCombinedSupplemental(
    existingSupplemental: PromptContextSection | null,
    userContext: string[],
    referenceSummary: string,
    question: string,
    mode: TinyPromptMode,
): PromptContextSection | null {
    const parts: string[] = [];

    const userContextLines = userContext
        .flatMap((entry) => summarizeContextLines(entry, question, 3, tokenize(MODE_QUERY_HINTS[mode])))
        .slice(0, 4);

    if (userContextLines.length > 0) {
        parts.push('[MODE NOTES]', ...userContextLines.map((line) => `- ${line}`));
    }

    if (referenceSummary.trim()) {
        parts.push('[REFERENCE SNIPPETS]', referenceSummary);
    }

    if (existingSupplemental?.content?.trim()) {
        const compactSupplemental = summarizeContextLines(existingSupplemental.content, question, 3, tokenize(MODE_QUERY_HINTS[mode]));
        if (compactSupplemental.length > 0) {
            parts.push('[ADDITIONAL CONTEXT]', ...compactSupplemental.map((line) => `- ${line}`));
        }
    }

    const content = parts.join('\n').trim();
    if (!content) return null;

    return {
        title: existingSupplemental?.title ?? 'MODE MEMORY',
        content,
        approxTokens: estimateTokens(content),
    };
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeoutHandle = setTimeout(() => reject(new Error(`TinyPrompt timeout after ${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
}

async function getEmbedding(text: string, query: boolean): Promise<number[]> {
    const normalized = normalizeWhitespace(text);
    const cacheKey = `${query ? 'q' : 'd'}:${normalized}`;
    const cached = embeddingCache.get(cacheKey);
    if (cached) return cached;

    const vector = query
        ? await nomicEmbeddingProvider.embedQuery(normalized)
        : await nomicEmbeddingProvider.embed(normalized);
    embeddingCache.set(cacheKey, vector);
    if (embeddingCache.size > 256) {
        const oldestKey = embeddingCache.keys().next().value;
        if (oldestKey) {
            embeddingCache.delete(oldestKey);
        }
    }
    return vector;
}

async function rankReferenceChunks(
    question: string,
    mode: TinyPromptMode,
    chunks: ReferenceChunk[],
    provider?: LlmProvider,
): Promise<RankedChunk[]> {
    if (chunks.length === 0) return [];

    const queryTerms = uniqueOrdered([...tokenize(question), ...tokenize(MODE_QUERY_HINTS[mode])]);
    const lexicalRanked = chunks
        .map((chunk) => ({
            ...chunk,
            lexicalScore: lexicalScore(`${chunk.fileName} ${chunk.content}`, queryTerms),
            finalScore: 0,
        }))
        .sort((a, b) => (b.lexicalScore - a.lexicalScore) || (a.content.length - b.content.length));

    const shortlisted = lexicalRanked.slice(0, 6);
    if ((provider !== 'ollama' && provider !== 'custom') || nomicEmbeddingDisabled || shortlisted.length <= 1) {
        return shortlisted.map((chunk, index) => ({
            ...chunk,
            finalScore: chunk.lexicalScore - (index * 0.01),
        })).sort((a, b) => b.finalScore - a.finalScore);
    }

    try {
        const query = `${MODE_QUERY_HINTS[mode]}\n${question}`;
        const [queryEmbedding, chunkEmbeddings] = await withTimeout(
            Promise.all([
                getEmbedding(query, true),
                Promise.all(shortlisted.map((chunk) => getEmbedding(`${chunk.fileName}\n${chunk.content}`, false))),
            ]),
            1200,
        );

        return shortlisted
            .map((chunk, index) => {
                const semanticScore = cosineSimilarity(queryEmbedding, chunkEmbeddings[index]);
                const finalScore = (semanticScore * 3) + chunk.lexicalScore;
                return {
                    ...chunk,
                    semanticScore,
                    finalScore,
                };
            })
            .sort((a, b) => b.finalScore - a.finalScore);
    } catch (error: any) {
        nomicEmbeddingDisabled = true;
        console.warn('[TinyPromptCompiler] Disabling nomic reference ranking fallback:', error?.message || error);
        return shortlisted.map((chunk, index) => ({
            ...chunk,
            finalScore: chunk.lexicalScore - (index * 0.01),
        })).sort((a, b) => b.finalScore - a.finalScore);
    }
}

function getTinyPromptBudget(mode: TinyPromptMode): number {
    return TOKEN_BUDGET_BY_MODE[mode] ?? 1100;
}

export async function compileTinyPrompt(args: TinyPromptCompileArgs): Promise<TinyPromptCompileResult> {
    const mode = resolveTinyPromptMode(args.prompt, args.activeTemplateType);
    const originalApproxTokens = approximatePromptTokens(args.prompt);

    if (!shouldUseTinyPrompt(args.currentModel, args.provider)) {
        return {
            prompt: args.prompt,
            applied: false,
            maxTokens: DEFAULT_MAX_ACTION_PROMPT_TOKENS,
            mode,
            stats: {
                originalApproxTokens,
                compiledApproxTokens: originalApproxTokens,
                transcriptApproxTokens: args.prompt.transcript.approxTokens,
                ragApproxTokens: args.prompt.rag?.approxTokens ?? 0,
                supplementalApproxTokens: args.prompt.supplemental?.approxTokens ?? 0,
                profileApproxTokens: args.prompt.profile?.approxTokens ?? 0,
            },
        };
    }

    const modeContextInstruction = args.prompt.instructions.find((instruction) => instruction.key === 'active_mode_context');
    const { userContext, referenceFiles } = parseModeContextBlock(modeContextInstruction?.content ?? '');
    const referenceChunks = referenceFiles.flatMap((file) => chunkReferenceContent(file.fileName, file.content));
    const rankedReferenceChunks = await rankReferenceChunks(args.prompt.question, mode, referenceChunks, args.provider);
    const referenceSummary = buildReferenceSummary(rankedReferenceChunks.slice(0, 3));
    const compressedTranscript = compressTranscriptContent(args.prompt.transcript.content, args.prompt.question, mode);

    const compiledPrompt: PromptObject = {
        ...args.prompt,
        instructions: buildTinyInstructions(
            args.prompt,
            mode,
            extractBrainSignals(args.prompt.instructions, mode),
            Boolean(args.prompt.rag?.content?.trim()),
        ),
        transcript: {
            ...args.prompt.transcript,
            content: compressedTranscript,
            approxTokens: estimateTokens(compressedTranscript),
        },
        rag: compressContextSection(args.prompt.rag, args.prompt.question, mode, 4),
        supplemental: buildCombinedSupplemental(
            args.prompt.supplemental,
            userContext,
            referenceSummary,
            args.prompt.question,
            mode,
        ),
        profile: compressProfileSection(args.prompt.profile, args.prompt.question, mode),
        contextOrder: CONTEXT_ORDER,
    };

    const compiledApproxTokens = approximatePromptTokens(compiledPrompt);
    console.log('[TinyPromptCompiler] Applied:', JSON.stringify({
        model: args.currentModel,
        provider: args.provider,
        mode,
        originalApproxTokens,
        compiledApproxTokens,
        targetBudget: getTinyPromptBudget(mode),
    }));

    return {
        prompt: compiledPrompt,
        applied: true,
        maxTokens: getTinyPromptBudget(mode),
        mode,
        stats: {
            originalApproxTokens,
            compiledApproxTokens,
            transcriptApproxTokens: compiledPrompt.transcript.approxTokens,
            ragApproxTokens: compiledPrompt.rag?.approxTokens ?? 0,
            supplementalApproxTokens: compiledPrompt.supplemental?.approxTokens ?? 0,
            profileApproxTokens: compiledPrompt.profile?.approxTokens ?? 0,
        },
    };
}
