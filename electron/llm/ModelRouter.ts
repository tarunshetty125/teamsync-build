// electron/llm/ModelRouter.ts
// Model selection, fallback chain construction, and provider prioritization.
// Extracted from LLMHelper to isolate routing logic from execution.
//
// This module owns:
//   - Building ordered provider fallback chains (text-only vs multimodal)
//   - User-selected provider prioritization
//   - Natively API pinning (always first when configured)
//   - Tiered retry rotation construction for vision analysis

import type { ProviderRegistry } from './ProviderRegistry';
import { TextModelFamily, ModelFamily } from '../services/ModelVersionManager';

// ---------------------------------------------------------------------------
// Provider Attempt Types
// ---------------------------------------------------------------------------

/**
 * A single provider attempt for non-streaming calls.
 */
export interface ProviderAttempt {
    name: string;
    execute: () => Promise<string>;
}

/**
 * A single provider attempt for streaming calls.
 */
export interface StreamingProviderAttempt {
    name: string;
    execute: () => AsyncGenerator<string, void, unknown>;
}

// ---------------------------------------------------------------------------
// ModelRouter
// ---------------------------------------------------------------------------

export class ModelRouter {
    constructor(private registry: ProviderRegistry) { }

    /**
     * Get the text model IDs from the ModelVersionManager for all families.
     * Used by streaming and non-streaming fallback chain builders.
     */
    getTextModels(): {
        openai: string;
        geminiFlash: string;
        geminiPro: string;
        claude: string;
        groq: string;
    } {
        const mvm = this.registry.modelVersionManager;
        return {
            openai: mvm.getTextTieredModels(TextModelFamily.OPENAI).tier1,
            geminiFlash: mvm.getTextTieredModels(TextModelFamily.GEMINI_FLASH).tier1,
            geminiPro: mvm.getTextTieredModels(TextModelFamily.GEMINI_PRO).tier1,
            claude: mvm.getTextTieredModels(TextModelFamily.CLAUDE).tier1,
            groq: mvm.getTextTieredModels(TextModelFamily.GROQ).tier1,
        };
    }

    /**
     * Determine the "family label" for the currently selected model.
     * Used to prioritize the user's chosen provider in fallback chains.
     */
    getCurrentFamilyLabel(): string {
        const modelId = this.registry.currentModelId;
        if (modelId === 'natively') return 'Natively';
        if (this.registry.isClaudeModel(modelId)) return 'Claude';
        if (this.registry.isOpenAiModel(modelId)) return 'OpenAI';
        if (this.registry.isGroqModel(modelId)) return 'Groq';
        if (this.registry.isGeminiModel(modelId)) return 'Gemini';
        return '';
    }

    /**
     * Sort a list of streaming provider attempts to prioritize:
     *   1. The user's selected provider family (moved to front)
     *   2. Natively API (always first when configured, regardless of selection)
     */
    prioritizeProviders<T extends { name: string }>(providers: T[]): T[] {
        const familyLabel = this.getCurrentFamilyLabel();

        if (familyLabel) {
            providers.sort((a, b) => {
                if (a.name.startsWith(familyLabel) && !b.name.startsWith(familyLabel)) return -1;
                if (!a.name.startsWith(familyLabel) && b.name.startsWith(familyLabel)) return 1;
                return 0;
            });
        }

        // Natively is always first when configured
        if (this.registry.hasNatively() && providers[0]?.name !== 'Natively API') {
            const idx = providers.findIndex(p => p.name === 'Natively API');
            if (idx > 0) {
                const [entry] = providers.splice(idx, 1);
                providers.unshift(entry);
            }
        }

        return providers;
    }

    /**
     * Execute a fallback chain with rotation and exponential backoff.
     * Used by non-streaming generation methods.
     *
     * @param providers - Ordered list of provider attempts
     * @param maxRotations - Maximum number of full rotations through the chain
     * @returns The first successful non-empty response
     * @throws If all providers exhausted
     */
    async executeWithFallback(providers: ProviderAttempt[], maxRotations: number = 3): Promise<string> {
        if (providers.length === 0) {
            throw new Error("No AI providers configured. Please add at least one API key in Settings.");
        }

        for (let rotation = 0; rotation < maxRotations; rotation++) {
            if (rotation > 0) {
                const backoffMs = 1000 * rotation;
                console.log(`[ModelRouter] 🔄 Rotation ${rotation + 1}/${maxRotations} after ${backoffMs}ms backoff...`);
                await this.delay(backoffMs);
            }

            for (const provider of providers) {
                try {
                    console.log(`[ModelRouter] ${rotation === 0 ? '🚀' : '🔁'} Attempting ${provider.name}...`);
                    const result = await provider.execute();
                    if (result && result.trim().length > 0) {
                        console.log(`[ModelRouter] ✅ ${provider.name} succeeded`);
                        return result;
                    }
                    console.warn(`[ModelRouter] ⚠️ ${provider.name} returned empty response`);
                } catch (error: any) {
                    console.warn(`[ModelRouter] ⚠️ ${provider.name} failed: ${error.message}`);
                }
            }
        }

        throw new Error(`All AI providers exhausted after ${maxRotations} rotations`);
    }

    /**
     * Execute a streaming fallback chain with rotation and exponential backoff.
     * Yields tokens from the first successful provider.
     */
    async * streamWithFallback(
        providers: StreamingProviderAttempt[],
        maxRotations: number = 3,
    ): AsyncGenerator<string, void, unknown> {
        if (providers.length === 0) {
            yield "No AI providers configured. Please add at least one API key in Settings.";
            return;
        }

        for (let rotation = 0; rotation < maxRotations; rotation++) {
            if (rotation > 0) {
                const backoffMs = 1000 * rotation;
                console.log(`[ModelRouter] 🔄 Starting rotation ${rotation + 1}/${maxRotations} after ${backoffMs}ms backoff...`);
                await this.delay(backoffMs);
            }

            for (const provider of providers) {
                try {
                    console.log(`[ModelRouter] ${rotation === 0 ? '🚀' : '🔁'} Attempting ${provider.name}...`);
                    yield* provider.execute();
                    console.log(`[ModelRouter] ✅ ${provider.name} stream completed successfully`);
                    return; // SUCCESS
                } catch (err: any) {
                    console.warn(`[ModelRouter] ⚠️ ${provider.name} failed: ${err.message}`);
                }
            }
        }

        console.error(`[ModelRouter] ❌ All providers exhausted after ${maxRotations} rotations`);
        yield "All AI services are currently unavailable. Please check your API keys and try again.";
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
