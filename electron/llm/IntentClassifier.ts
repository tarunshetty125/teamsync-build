// electron/llm/IntentClassifier.ts
// Lightweight intent classification for "What should I say?"
// Micro step that runs before answer generation
//
// Two-tier classification:
//   1. Regex fast-path (< 1ms) for common patterns
//   2. Local SLM fallback (zero-shot, ~10-50ms) for messy/ambiguous speech

import path from 'path';
import { app } from 'electron';

export type ConversationIntent =
    | 'clarification'      // "Can you explain that?"
    | 'follow_up'          // "What happened next?"
    | 'deep_dive'          // "Tell me more about X"
    | 'behavioral'         // "Give me an example of..."
    | 'example_request'    // "Can you give a concrete example?"
    | 'summary_probe'      // "So to summarize..."
    | 'system_design'      // "Design a scalable system" / architecture / tradeoffs
    | 'coding'             // "Write code for X" or implementation questions
    | 'general';           // Default fallback

export interface IntentResult {
    intent: ConversationIntent;
    confidence: number;
    answerShape: string;
}

/**
 * Answer shapes mapped to intents
 * This controls HOW the answer is structured, not just WHAT it says
 */
const INTENT_ANSWER_SHAPES: Record<ConversationIntent, string> = {
    clarification: 'Give a direct, focused 1-2 sentence clarification. No setup, no context-setting.',
    follow_up: 'Continue the narrative naturally. 1-2 sentences. No recap of what was already said.',
    deep_dive: 'Provide a structured but concise explanation. Use concrete specifics, not abstract concepts.',
    behavioral: 'Lead with a specific example or story. Use the STAR pattern implicitly. Focus on actions and outcomes.',
    example_request: 'Provide ONE concrete, detailed example. Make it realistic and specific.',
    summary_probe: 'Confirm the summary briefly and add one clarifying point if needed.',
    system_design: 'Answer like a senior engineer in a real system design interview: clarify scale and constraints, outline the architecture, explain core components, highlight tradeoffs, then call out scaling and failure handling.',
    coding: 'Provide a FULL, complete, working and production-ready code implementation (including necessary boilerplate like Java imports/classes). Start with a brief approach description, then the fully runnable code block, then a concise explanation of why this approach works.',
    general: 'Respond naturally based on context. Keep it conversational and direct.'
};

// ========================
// Zero-Shot SLM Classifier
// ========================

/**
 * Candidate labels for zero-shot classification.
 * These map to ConversationIntent types.
 */
const ZERO_SHOT_LABELS: Record<string, ConversationIntent> = {
    'asking for clarification or explanation': 'clarification',
    'asking about what happened next or follow-up': 'follow_up',
    'requesting more detail or deeper explanation': 'deep_dive',
    'asking for a personal experience or behavioral example': 'behavioral',
    'requesting a concrete example or instance': 'example_request',
    'summarizing or confirming understanding': 'summary_probe',
    'asking about system design, architecture, scaling, or tradeoffs': 'system_design',
    'asking about code, programming, or implementation': 'coding',
    'general conversation or question': 'general',
};

const ZERO_SHOT_LABEL_KEYS = Object.keys(ZERO_SHOT_LABELS);

/** Minimum confidence from the SLM to trust its classification */
const SLM_CONFIDENCE_THRESHOLD = 0.35;

/**
 * Singleton lazy-loaded zero-shot classifier using @xenova/transformers
 */
class ZeroShotClassifier {
    private static instance: ZeroShotClassifier | null = null;
    private pipe: any = null;
    private loadingPromise: Promise<void> | null = null;
    private loadFailed = false;

    private constructor() {}

    static getInstance(): ZeroShotClassifier {
        if (!ZeroShotClassifier.instance) {
            ZeroShotClassifier.instance = new ZeroShotClassifier();
        }
        return ZeroShotClassifier.instance;
    }

    /**
     * Lazy-load the zero-shot classification model.
     * Uses Xenova/mobilebert-uncased-mnli — tiny (~100MB quantized), fast (~10-50ms inference).
     */
    private async ensureLoaded(): Promise<void> {
        if (this.pipe) return;
        if (this.loadFailed) return;

        if (this.loadingPromise) {
            await this.loadingPromise;
            return;
        }

        this.loadingPromise = (async () => {
            try {
                // Bypass TypeScript converting import() to require() for ESM packages
                const { pipeline, env } = await new Function("return import('@xenova/transformers')")();

                // In production, use bundled model. In dev, allow remote download.
                if (app.isPackaged) {
                    env.allowRemoteModels = false;
                    env.localModelPath = path.join(process.resourcesPath, 'models');
                } else {
                    // Dev mode: allow downloading from HuggingFace Hub
                    env.allowRemoteModels = true;
                    env.cacheDir = path.join(__dirname, '../../resources/models');
                }

                console.log('[IntentClassifier] Loading zero-shot classifier (mobilebert-uncased-mnli)...');
                this.pipe = await pipeline(
                    'zero-shot-classification',
                    'Xenova/mobilebert-uncased-mnli',
                    { local_files_only: app.isPackaged }
                );
                console.log('[IntentClassifier] Zero-shot classifier loaded successfully.');
            } catch (e) {
                console.warn('[IntentClassifier] Failed to load zero-shot model, regex-only fallback:', e);
                this.loadFailed = true;
                this.pipe = null;
            }
        })();

        try {
            await this.loadingPromise;
        } catch {
            this.loadingPromise = null;
        }
    }

    /**
     * Classify text using the zero-shot model.
     * Returns null if the model isn't loaded or classification fails.
     */
    async classify(text: string): Promise<IntentResult | null> {
        await this.ensureLoaded();
        if (!this.pipe) return null;

        try {
            const result = await this.pipe(text, ZERO_SHOT_LABEL_KEYS, {
                multi_label: false,
            });

            // result has { labels: string[], scores: number[] }
            const topLabel = result.labels[0];
            const topScore = result.scores[0];

            if (topScore < SLM_CONFIDENCE_THRESHOLD) {
                return null; // Not confident enough
            }

            const intent = ZERO_SHOT_LABELS[topLabel] || 'general';
            console.log(`[IntentClassifier] SLM classified as "${intent}" (${(topScore * 100).toFixed(1)}%): "${text.substring(0, 60)}..."`);

            return {
                intent,
                confidence: topScore,
                answerShape: INTENT_ANSWER_SHAPES[intent],
            };
        } catch (e) {
            console.warn('[IntentClassifier] SLM classification error:', e);
            return null;
        }
    }

    /**
     * Warm up the model in background (non-blocking).
     * Call this early in app lifecycle to avoid cold-start latency.
     */
    warmup(): void {
        this.ensureLoaded().catch(() => {});
    }
}

// ========================
// Regex Fast-Path
// ========================

/**
 * Normalize text for pattern matching (fix OCR/STT artifacts)
 */
function normalizeForDetection(text: string): string {
    let q = text.toLowerCase().trim();
    // Fix broken OCR/speech: "polymor. phism" → "polymorphism"
    q = q.replace(/(\w)\.\s+(\w)/g, '$1$2');
    // Remove filler words
    q = q.replace(/\b(yeah|um|uh|uh+m|like|so|okay|ok|well|you know|i mean|basically|actually|right)\b/g, ' ');
    // Collapse whitespace
    q = q.replace(/\s+/g, ' ').trim();
    return q;
}

/**
 * Pattern-based intent detection (fast, no model call)
 * For common patterns this is sufficient
 *
 * PRIORITY ORDER: coding > system_design > behavioral > deep_dive > clarification > follow_up > example > summary
 */
function detectIntentByPattern(lastInterviewerTurn: string): IntentResult | null {
    const text = normalizeForDetection(lastInterviewerTurn);

    // HIGHEST PRIORITY: Coding patterns (must be checked first so mixed coding+concept → coding)
    if (/(write code|write a? ?(?:function|program|method|class|script)|program|implement|function for|algorithm|how to code|setup a .* project|using .* library|debug this|snippet|boilerplate|example of .* in .*|optimize|refactor|best practice for .* code|utility method|component for|logic for|reverse|sort|array|linked list|tree|graph|stack|queue|hash ?map|binary search|dynamic programming|recursion|recursive|iterate|loop|pointer|two pointer|sliding window|backtrack|greedy|bfs|dfs|matrix|string manipulation|big o|time complexity|space complexity|fibonacci|palindrome|anagram|substring|subarray|merge sort|quick sort|bubble sort|insertion sort|heap|trie|topological|shortest path|factorial|prime|duplicate|remove duplicates|flatten|depth first|breadth first|binary tree|level order|in ?order traversal|pre ?order|post ?order|promise|async await|callback)/i.test(text)) {
        return { intent: 'coding', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.coding };
    }

    // System design / architecture patterns
    if (/(system design|design (?:a|an|the)|architecture|architect|scalab(?:le|ility)|distributed system|distributed architecture|microservices?|load balanc(?:er|ing)|api gateway|database schema|database design|caching|cache layer|cdn|message queue|event driven|event-driven|pub\/sub|queueing|sharding|partition(?:ing)?|replica(?:tion)?|eventual consistency|strong consistency|consistency|availability|cap theorem|high availability|fault toleran(?:ce|t)|throughput|latency|rate limit(?:ing)?|qps|rps|read write ratio|read\/write ratio|single region|multi region|multi-region|backpressure|fanout|fan-out|leader election|service discovery|how would you scale|handle millions of users|design twitter|design uber|design youtube|design whatsapp|tradeoff|trade-off|pros? and cons|bottleneck|failure mode)/i.test(text)) {
        return { intent: 'system_design', confidence: 0.92, answerShape: INTENT_ANSWER_SHAPES.system_design };
    }

    // Behavioral patterns
    if (/(give me an example|tell me about a time|describe a situation|when have you|share an experience|tell me about|experience|challenge|conflict|pressure|teamwork|strength|weakness|leader(?:ship)?|mentor|mistake|failure|difficult|disagree|feedback|prioriti[zs]e|deadline|collaborate|accomplishment)/i.test(text)) {
        return { intent: 'behavioral', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.behavioral };
    }

    // Deep dive patterns (includes indirect phrasing)
    if (/(tell me more|dive deeper|explain further|walk me through|how does that work|can you walk me through|how would you approach|how would you go about|what happens when|what would happen if|talk me through|take me through|step me through)/i.test(text)) {
        return { intent: 'deep_dive', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.deep_dive };
    }

    // Clarification patterns
    if (/(can you explain|what do you mean|clarify|could you elaborate on that specific|could you explain|what is|what's|what are|explain|define|definition|difference between|compare)/i.test(text)) {
        return { intent: 'clarification', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.clarification };
    }

    // Follow-up patterns  
    if (/(what happened|then what|and after that|what.s next|how did that go)/i.test(text)) {
        return { intent: 'follow_up', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.follow_up };
    }

    // Example request patterns
    if (/(for example|concrete example|specific instance|like what|such as)/i.test(text)) {
        return { intent: 'example_request', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.example_request };
    }

    // Summary probe patterns
    if (/(so to summarize|in summary|so basically|so you.re saying|let me make sure)/i.test(text)) {
        return { intent: 'summary_probe', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.summary_probe };
    }

    return null; // No clear pattern detected
}

// ========================
// Context-Aware Fallback
// ========================

/**
 * Context-aware intent detection
 * Looks at conversation flow, not just the last turn
 */
function detectIntentByContext(
    recentTranscript: string,
    assistantMessageCount: number
): IntentResult {
    // If we've given multiple answers and interviewer is probing, likely follow_up
    if (assistantMessageCount >= 2) {
        // Check if interviewer is drilling down
        const lines = recentTranscript.split('\n');
        const interviewerLines = lines.filter(l => l.includes('[INTERVIEWER'));

        // Short interviewer prompts after long exchanges = follow-up probe
        const lastInterviewerLine = interviewerLines[interviewerLines.length - 1] || '';
        if (lastInterviewerLine.length < 50 && assistantMessageCount >= 2) {
            return { intent: 'follow_up', confidence: 0.7, answerShape: INTENT_ANSWER_SHAPES.follow_up };
        }
    }

    // Default to general
    return { intent: 'general', confidence: 0.5, answerShape: INTENT_ANSWER_SHAPES.general };
}

// ========================
// Public API
// ========================

/**
 * Main intent classification function (async)
 *
 * Three-tier priority:
 *   1. Regex fast-path (< 1ms, high confidence)
 *   2. Zero-shot SLM fallback (~10-50ms, medium-high confidence)
 *   3. Context-based heuristic (0ms, low confidence)
 */
export async function classifyIntent(
    lastInterviewerTurn: string | null,
    recentTranscript: string,
    assistantMessageCount: number
): Promise<IntentResult> {
    // Tier 1: Try regex-based first (high confidence, instant)
    if (lastInterviewerTurn) {
        const patternResult = detectIntentByPattern(lastInterviewerTurn);
        if (patternResult) {
            return patternResult;
        }

        // Tier 2: Try zero-shot SLM (if regex didn't match)
        if (lastInterviewerTurn.trim().length > 5) {
            const slmResult = await ZeroShotClassifier.getInstance().classify(lastInterviewerTurn);
            if (slmResult) {
                return slmResult;
            }
        }
    }

    // Tier 3: Fall back to context-based heuristic
    return detectIntentByContext(recentTranscript, assistantMessageCount);
}

/**
 * Get answer shape guidance for prompt injection
 */
export function getAnswerShapeGuidance(intent: ConversationIntent): string {
    return INTENT_ANSWER_SHAPES[intent];
}

/**
 * Pre-warm the SLM model in background.
 * Call this during app initialization to avoid cold-start on first classification.
 */
export function warmupIntentClassifier(): void {
    ZeroShotClassifier.getInstance().warmup();
}
