// electron/intelligence/PromptAssembler.ts
// Serializes a ContextBundle + ResponseStrategy into a final prompt ready for LLM consumption.
//
// Replaces: ActionContextBuilder.serializePromptObject()
// Consumed by: Brain.execute(), StreamingEngine
//
// The PromptAssembler is the LAST stage before LLM invocation.
// It combines:
//   1. Context sources (from KnowledgeOrchestratorV2) → context block
//   2. Intent instructions (from ActionContextBuilder.buildIntentPrompt) → system prompt
//   3. Response strategy constraints (from ResponseStrategy) → appended rules
//   4. User question → user message
//
// Output is a SerializedPrompt: { systemPrompt, context, finalPrompt }

import type { ContextBundle, ContextSource } from './ContextBundle';
import type { ResponseStrategy, DepthPreset } from './ResponseStrategy';
import type { QuestionAnalysis } from './QuestionAnalysis';
import type { UnifiedActionIntent, ProfilePolicy } from './types';
import type { PromptInstruction, SerializedPrompt, SessionActionMode } from '../ActionContextBuilder';
import {
    buildIntentPrompt,
    buildModeContext,
    serializePromptObject,
    type PromptObject,
    type PromptTranscriptSection,
    type PromptProfileSection,
    type PromptContextSection,
} from '../ActionContextBuilder';

// ---------------------------------------------------------------------------
// AssembleParams
// ---------------------------------------------------------------------------

export interface AssembleParams {
    /** The question analysis from the QuestionUnderstandingEngine */
    analysis: QuestionAnalysis;

    /** The prioritized context bundle from KnowledgeOrchestratorV2 */
    bundle: ContextBundle;

    /** The response strategy from the ResponseStrategyCalculator */
    strategy: ResponseStrategy;

    /** The user's original message / question */
    question: string;

    /** Action intent (what_to_answer, answer_now, recap, etc.) */
    intent: UnifiedActionIntent;

    /** Session mode (general, coding, behavioral, system_design) */
    mode: SessionActionMode;

    /** Screen scan mode (for screen_scan intent only) */
    screenScanMode?: import('./types').ScreenContentMode;

    /** Whether to include mode custom context */
    includeModeCustomContext?: boolean;
}

// ---------------------------------------------------------------------------
// PromptAssembler
// ---------------------------------------------------------------------------

export class PromptAssembler {
    /**
     * Assemble a final prompt from the intelligence pipeline outputs.
     *
     * This is the primary API. It:
     *   1. Extracts source-typed content from the ContextBundle
     *   2. Builds intent and mode instructions via the existing buildIntentPrompt/buildModeContext
     *   3. Appends response strategy constraints (depth, tone, word budget)
     *   4. Delegates to serializePromptObject() for the final string format
     *
     * The result is a SerializedPrompt that can be passed directly to the StreamingEngine.
     */
    assemble(params: AssembleParams): SerializedPrompt {
        const {
            analysis,
            bundle,
            strategy,
            question,
            intent,
            mode,
            screenScanMode,
            includeModeCustomContext = true,
        } = params;

        // 1. Extract typed sections from the ContextBundle
        const transcript = this.extractTranscript(bundle);
        const profile = this.extractProfile(bundle);
        const rag = this.extractSection(bundle, 'rag_memory');
        const supplemental = this.extractSection(bundle, 'supplemental');

        // 2. Build intent instructions (reuses existing logic)
        const intentInstructions = buildIntentPrompt(
            intent,
            mode,
            screenScanMode,
            question,
            bundle.profileApplied,
        );

        // 3. Build mode instructions
        const modeInstructions = buildModeContext(mode, {
            includeModeCustomContext,
        });

        // 4. Build profile instruction (if profile injected a system prompt)
        const profileInstruction = profile?.instruction?.trim()
            ? [{ key: 'profile_instruction', title: 'PROFILE INTELLIGENCE', content: profile.instruction.trim() }]
            : [];

        // 5. Build RAG rules (if RAG context is present)
        const ragInstructions: PromptInstruction[] = rag
            ? [{
                key: 'rag_rules',
                title: 'RAG RULES',
                content: [
                    'If RAG MEMORY is present, answer using it as the primary factual source.',
                    'If the requested detail is not in RAG MEMORY, say so briefly and do not invent it.',
                    'Do not mention retrieval, chunks, embeddings, or internal systems.',
                ].join('\n'),
            }]
            : [];

        // 6. Build response strategy constraints
        const strategyInstructions = this.buildStrategyInstructions(strategy);

        // 7. Assemble the PromptObject
        const promptObject: PromptObject = {
            mode,
            intent,
            question,
            transcript,
            profile,
            supplemental,
            rag,
            instructions: [
                ...intentInstructions,
                ...modeInstructions,
                ...profileInstruction,
                ...ragInstructions,
                ...strategyInstructions,
            ].map(i => ({
                ...i,
                content: i.content.trim().replace(/\n{3,}/g, '\n\n'),
            })),
        };

        // 8. Serialize via existing serializer (preserves exact format)
        return serializePromptObject(promptObject);
    }

    /**
     * Lightweight assembly that skips strategy constraints.
     * Used for simple intents (recap, clarify) where response depth is fixed.
     */
    assembleLightweight(params: Omit<AssembleParams, 'strategy'>): SerializedPrompt {
        return this.assemble({
            ...params,
            strategy: {
                depth: 'medium',
                tone: 'conversational',
                maxWords: 200,
                bulletRange: [2, 4],
                streamStrategy: 'direct',
                includeCodeBlock: false,
                includeComplexity: false,
            },
        });
    }

    // -----------------------------------------------------------------------
    // Extraction helpers
    // -----------------------------------------------------------------------

    private extractTranscript(bundle: ContextBundle): PromptTranscriptSection {
        const source = bundle.sources.find(s => s.type === 'transcript');
        if (!source) {
            return {
                title: 'TRANSCRIPT',
                content: '[NO TRANSCRIPT AVAILABLE]',
                strategy: 'rolling_window',
                approxTokens: 0,
            };
        }
        return {
            title: source.title,
            content: source.content,
            strategy: source.id.includes('capped') ? 'capped_full' : 'rolling_window',
            approxTokens: source.approxTokens,
        };
    }

    private extractProfile(bundle: ContextBundle): PromptProfileSection | null {
        const source = bundle.sources.find(s => s.type === 'profile_intelligence');
        if (!source && !bundle.profileApplied) return null;

        return {
            title: source?.title ?? 'PROFILE INTELLIGENCE',
            context: source?.content ?? '',
            used: bundle.profileApplied,
            policy: bundle.resolvedProfilePolicy,
            approxTokens: source?.approxTokens ?? 0,
        };
    }

    private extractSection(
        bundle: ContextBundle,
        type: 'rag_memory' | 'supplemental' | 'screen_content' | 'mode_custom',
    ): PromptContextSection | null {
        const source = bundle.sources.find(s => s.type === type);
        if (!source?.content) return null;
        return {
            title: source.title,
            content: source.content,
            approxTokens: source.approxTokens,
        };
    }

    // -----------------------------------------------------------------------
    // Strategy → Instructions
    // -----------------------------------------------------------------------

    private buildStrategyInstructions(strategy: ResponseStrategy): PromptInstruction[] {
        const rules: string[] = [];

        // Word budget
        if (strategy.maxWords) {
            rules.push(`Keep the response under ${strategy.maxWords} words.`);
        }

        // Bullet range
        if (strategy.bulletRange) {
            const [min, max] = strategy.bulletRange;
            rules.push(`Use ${min} to ${max} bullet points when structuring the answer.`);
        }

        // Code block inclusion
        if (strategy.includeCodeBlock) {
            rules.push('Include a code block if the answer benefits from code.');
        }

        // Complexity analysis
        if (strategy.includeComplexity) {
            rules.push('Include time and space complexity analysis.');
        }

        // Tone override
        if (strategy.tone === 'technical') {
            rules.push('Use precise technical language.');
        } else if (strategy.tone === 'formal') {
            rules.push('Use formal, professional language.');
        }

        if (rules.length === 0) return [];

        return [{
            key: 'response_strategy',
            title: 'RESPONSE CONSTRAINTS',
            content: rules.join('\n'),
        }];
    }
}
