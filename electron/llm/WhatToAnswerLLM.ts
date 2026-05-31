import { LLMHelper } from "../LLMHelper";
import { UNIVERSAL_WHAT_TO_ANSWER_PROMPT } from "./prompts";
import { TemporalContext } from "./TemporalContextBuilder";
import { IntentResult } from "./IntentClassifier";

// ---------------------------------------------------------------------------
// 1. Input Normalization — clean messy STT / OCR output before classification
// ---------------------------------------------------------------------------

function normalizeInput(text: string): string {
    let q = text.toLowerCase();

    // Remove filler words
    q = q.replace(/\b(yeah|um|uh|uh+m|like|so|okay|ok|well|you know|i mean|basically|actually|right)\b/g, ' ');

    // Fix broken OCR / speech: "polymor. phism" → "polymorphism"
    q = q.replace(/(\w)\.\s+(\w)/g, '$1$2');

    // Remove extra punctuation noise
    q = q.replace(/[.]{2,}/g, '.').replace(/[-]{2,}/g, '-').replace(/[,]{2,}/g, ',');

    // Collapse whitespace
    q = q.replace(/\s+/g, ' ').trim();

    return q;
}

// ---------------------------------------------------------------------------
// 2. Vague Input Detection
// ---------------------------------------------------------------------------

const VAGUE_INPUT = /^(?:\s)*(solve|code|answer|help|hint|implement|solution|do it|go)(?:\s*(this|it|problem|question)?)?(?:\s*)$/i;

function isVagueInput(text: string): boolean {
    const cleaned = normalizeInput(text);
    return !cleaned || cleaned.length < 5 || VAGUE_INPUT.test(cleaned);
}

// ---------------------------------------------------------------------------
// 3. Code Block Validation — regex check for valid markdown code blocks
// ---------------------------------------------------------------------------

const CODE_BLOCK_REGEX = /```[a-zA-Z]*[\s\S]*?```/;

function hasValidCodeBlock(text: string): boolean {
    return CODE_BLOCK_REGEX.test(text);
}

// ---------------------------------------------------------------------------
// 4. Correction Prompt — used for retry when code block is missing
// ---------------------------------------------------------------------------

const CORRECTION_PROMPT = `

Your previous response was invalid because it did not include a code block.

You MUST:
* Include code inside triple backticks
* Include a language tag (e.g. javascript)
* Follow the exact required format

Return ONLY the corrected answer.`;

// ---------------------------------------------------------------------------
// 5. Auto-wrap Fallback — detect code-like content and wrap in markdown fences
// ---------------------------------------------------------------------------

const CODE_LIKE_PATTERN = /\b(function|class|def |const |let |var |import |return |if |for |while )\b/;

function autoWrapCodeResponse(response: string): string {
    if (!response || response.includes('```') || !CODE_LIKE_PATTERN.test(response)) {
        return response;
    }
    console.log('[WhatToAnswerLLM] Auto-wrapping detected code in markdown block');
    // Find the first blank line or the start of code-like content
    const lines = response.split('\n');
    let codeStartIdx = 0;
    for (let i = 0; i < lines.length; i++) {
        if (CODE_LIKE_PATTERN.test(lines[i])) {
            codeStartIdx = i;
            break;
        }
    }
    const explanation = lines.slice(0, codeStartIdx).join('\n').trim();
    const code = lines.slice(codeStartIdx).join('\n').trim();
    return (explanation ? explanation + '\n\n' : '') + '```javascript\n' + code + '\n```';
}

// ---------------------------------------------------------------------------
// 6. WhatToAnswerLLM — adaptive answering pipeline with streaming
// ---------------------------------------------------------------------------

export class WhatToAnswerLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    // Deprecated non-streaming method (redirect to streaming or implement if needed)
    async generate(cleanedTranscript: string): Promise<string> {
        // Simple wrapper around stream
        const stream = this.generateStream(cleanedTranscript);
        let full = "";
        for await (const chunk of stream) full += chunk;
        return full;
    }

    async *generateStream(
        cleanedTranscript: string,
        temporalContext?: TemporalContext,
        intentResult?: IntentResult,
        imagePaths?: string[]
    ): AsyncGenerator<string> {
        try {
            // --- Input Normalization & Vague Input Handling ---
            const normalizedTranscript = normalizeInput(cleanedTranscript);
            const vague = isVagueInput(cleanedTranscript);

            // Build a rich message context
            let contextParts: string[] = [];

            if (intentResult) {
                contextParts.push(`<intent_and_shape>
DETECTED INTENT: ${intentResult.intent}
ANSWER SHAPE: ${intentResult.answerShape}
</intent_and_shape>`);
            }

            if (temporalContext && temporalContext.hasRecentResponses) {
                const history = temporalContext.previousResponses.map((r, i) => `${i + 1}. "${r}"`).join('\n');
                contextParts.push(`PREVIOUS RESPONSES (Avoid Repetition):\n${history}`);
            }

            // Detect if this is a coding question
            const isCodingIntent = intentResult?.intent === 'coding';
            const isSystemDesignIntent = intentResult?.intent === 'system_design';

            if (isCodingIntent) {
                console.log('[WhatToAnswerLLM] Coding intent detected — universal prompt owns output format');
            }

            if (isSystemDesignIntent) {
                console.log('[WhatToAnswerLLM] System design intent detected — universal prompt owns output format');
            }

            const extraContext = contextParts.join('\n\n');

            // If input is vague and we have transcript context, use context as the problem
            let fullMessage: string;
            let finalQuestion: string;
            if (vague && normalizedTranscript.length > 10) {
                fullMessage = extraContext
                    ? `${extraContext}\n\nSolve the following problem:\n\n${normalizedTranscript}`
                    : `Solve the following problem:\n\n${normalizedTranscript}`;
                finalQuestion = normalizedTranscript;
                console.log(`[WhatToAnswerLLM] Vague input detected — using transcript as problem`);
            } else {
                fullMessage = extraContext
                    ? `${extraContext}\n\nCONVERSATION:\n${cleanedTranscript}`
                    : cleanedTranscript;
                finalQuestion = normalizedTranscript || cleanedTranscript;
            }

            // Pipeline debug log
            console.log({
                input: cleanedTranscript.slice(0, 120),
                cleaned: normalizedTranscript.slice(0, 120),
                detectedType: intentResult?.intent || 'unknown',
                finalQuestion: finalQuestion.slice(0, 120),
                isCoding: isCodingIntent,
                isSystemDesign: isSystemDesignIntent,
                isVague: vague
            });

            console.log(`[WhatToAnswerLLM] intent=${intentResult?.intent || 'unknown'} | transcript length=${cleanedTranscript.length}`);

            // For coding questions, collect the full response for validation
            if (isCodingIntent) {
                // Collect full response first, validate, then yield
                let fullResponse = "";
                for await (const chunk of this.llmHelper.streamChat(fullMessage, imagePaths, undefined, UNIVERSAL_WHAT_TO_ANSWER_PROMPT)) {
                    fullResponse += chunk;
                }

                // Server-side enforcement: validate coding response has a code block
                if (fullResponse.trim() && !hasValidCodeBlock(fullResponse)) {
                    console.log('[WhatToAnswerLLM] Coding response missing code block — retrying with correction prompt');

                    const retryMessage = fullMessage + CORRECTION_PROMPT;
                    let retryResponse = "";
                    for await (const chunk of this.llmHelper.streamChat(retryMessage, imagePaths, undefined, UNIVERSAL_WHAT_TO_ANSWER_PROMPT)) {
                        retryResponse += chunk;
                    }

                    if (retryResponse.trim() && hasValidCodeBlock(retryResponse)) {
                        fullResponse = retryResponse;
                        console.log('[WhatToAnswerLLM] Retry succeeded — code block found');
                    } else {
                        // Auto-wrap fallback: detect code-like content and wrap it
                        const candidate = retryResponse.trim() || fullResponse.trim();
                        const wrapped = autoWrapCodeResponse(candidate);
                        if (wrapped !== candidate) {
                            fullResponse = wrapped;
                            console.log('[WhatToAnswerLLM] Auto-wrap fallback applied — code wrapped in markdown fences');
                        } else {
                            console.log('[WhatToAnswerLLM] Retry also failed and no code-like content detected — using original response');
                        }
                    }
                }

                // Yield the validated response as a single chunk
                yield fullResponse;

            } else {
                // Non-coding: stream directly for low latency
                yield* this.llmHelper.streamChat(fullMessage, imagePaths, undefined, UNIVERSAL_WHAT_TO_ANSWER_PROMPT);
            }

        } catch (error) {
            console.error("[WhatToAnswerLLM] Stream failed:", error);
            yield "Could you repeat that? I want to make sure I address your question properly.";
        }
    }
}
