// electron/intelligence/brains/GeneralBrain.ts
// Default fallback brain for conversational, general-purpose questions.
// Handles: general knowledge, fresh questions, ambiguous intents.

import type { BrainId } from '../types';
import type { Brain, BrainInput, BrainOutput } from './Brain';
import type { PromptInstruction } from '../../ActionContextBuilder';

export class GeneralBrain implements Brain {
    readonly id: BrainId = 'general';
    readonly name = 'General Brain';
    readonly latencyTarget = 400;

    execute(input: BrainInput): BrainOutput {
        const { analysis, strategy, context } = input;
        const instructions: PromptInstruction[] = [];

        // Core reasoning directive
        instructions.push({
            key: 'brain_directive',
            title: 'BRAIN: GENERAL',
            content: [
                'You are answering a general interview question.',
                'Be direct, natural, and concise.',
                'Answer the latest question first — do not repeat older context.',
                'Sound confident. Avoid filler phrases like "it depends" or "maybe".',
                'Use first person when answering for the user.',
            ].join('\n'),
        });

        // Depth-aware output contract
        const [minBullets, maxBullets] = strategy.bulletRange;
        const depthRules: string[] = [];

        if (strategy.depth === 'short') {
            depthRules.push(
                'Return one concise paragraph.',
                `Use at most ${maxBullets} short bullets only if they help clarity.`,
                `Keep the response under ${strategy.maxWords} words.`,
            );
        } else if (strategy.depth === 'deep') {
            depthRules.push(
                'Provide a thorough answer with supporting reasoning.',
                `Use ${minBullets} to ${maxBullets} bullets for structure.`,
                `Target ${strategy.maxWords} words.`,
            );
        } else {
            depthRules.push(
                'Start with one direct opening sentence.',
                `Then provide ${minBullets} to ${maxBullets} short supporting bullets.`,
                'End cleanly without extra padding.',
                `Keep the response under ${strategy.maxWords} words.`,
            );
        }

        instructions.push({
            key: 'output_contract',
            title: 'OUTPUT CONTRACT',
            content: depthRules.join('\n'),
        });

        // Context priority rules
        if (context.profileApplied) {
            instructions.push({
                key: 'context_priority',
                title: 'CONTEXT PRIORITY',
                content: [
                    'Answer the latest question first.',
                    'Use PROFILE INTELLIGENCE only when directly relevant.',
                    'Ignore unrelated resume, JD, salary, or negotiation details.',
                    'Prefer the freshest transcript turns over older context.',
                ].join('\n'),
            });
        }

        return {
            instructions,
            outputContract: 'Response must be a direct, concise answer. No meta commentary.',
            streamStrategy: 'direct',
        };
    }
}
