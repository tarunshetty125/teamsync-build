// electron/intelligence/brains/BehavioralBrain.ts
// Domain brain for behavioral interviews — STAR format, first-person answers,
// project grounding, resume personalization, and achievement framing.

import type { BrainId } from '../types';
import type { Brain, BrainInput, BrainOutput } from './Brain';
import type { PromptInstruction } from '../../ActionContextBuilder';

export class BehavioralBrain implements Brain {
    readonly id: BrainId = 'behavioral';
    readonly name = 'Behavioral Brain';
    readonly latencyTarget = 500;

    execute(input: BrainInput): BrainOutput {
        const { analysis, strategy, context } = input;
        const instructions: PromptInstruction[] = [];

        // Core reasoning directive
        instructions.push({
            key: 'brain_directive',
            title: 'BRAIN: BEHAVIORAL',
            content: [
                'You are coaching the user through a behavioral interview.',
                'Answer in FIRST PERSON as if the user is speaking.',
                'Ground every answer in a concrete, real project or experience.',
                'Use the STAR format naturally: Situation → Task → Action → Result.',
                'Do NOT say "I would" — say "I did" or "We did".',
                'Sound confident, specific, and authentic — never generic.',
                'Frame achievements with measurable impact when possible.',
            ].join('\n'),
        });

        // Output contract based on depth
        const [minBullets, maxBullets] = strategy.bulletRange;

        if (strategy.depth === 'short') {
            instructions.push({
                key: 'output_contract',
                title: 'OUTPUT CONTRACT',
                content: [
                    'Return a concise, first-person story the user can say aloud.',
                    'Start with one strong opening sentence that names the project.',
                    'Then provide the key action and result in 1-2 sentences.',
                    `Keep under ${strategy.maxWords} words.`,
                    'No bullet points — use natural speech flow.',
                ].join('\n'),
            });
        } else if (strategy.depth === 'deep') {
            instructions.push({
                key: 'output_contract',
                title: 'OUTPUT CONTRACT',
                content: [
                    'Return a structured first-person story with STAR flow.',
                    'Start with one opening sentence naming the project and context.',
                    `Use ${minBullets} to ${maxBullets} structured points covering:`,
                    '  - The situation and challenge',
                    '  - Your specific actions and decisions',
                    '  - The measurable result and learnings',
                    'End with one sentence on what you learned or would do differently.',
                    `Target ${strategy.maxWords} words.`,
                ].join('\n'),
            });
        } else {
            instructions.push({
                key: 'output_contract',
                title: 'OUTPUT CONTRACT',
                content: [
                    'Return a moderate first-person answer the user can say immediately.',
                    'Start with one direct opening sentence naming the project.',
                    `Then provide ${minBullets} to ${maxBullets} short bullets covering action and result.`,
                    'End with one concise closing sentence.',
                    `Keep under ${strategy.maxWords} words.`,
                    'Use first person throughout.',
                ].join('\n'),
            });
        }

        // Profile intelligence integration
        if (context.profileApplied) {
            instructions.push({
                key: 'profile_usage',
                title: 'PROFILE USAGE',
                content: [
                    'Use the PROFILE INTELLIGENCE to ground your answer in real experiences.',
                    'Pull specific project names, technologies, team sizes, and outcomes.',
                    'Do NOT dump the entire resume — use only the most relevant detail.',
                    'If no profile detail is relevant to this question, answer from general experience.',
                ].join('\n'),
            });
        }

        // Reasoning hints
        if (analysis.isFollowUp) {
            instructions.push({
                key: 'reasoning_hints',
                title: 'REASONING HINTS',
                content: 'Continue the story naturally. Do not restart from the beginning.',
            });
        }

        return {
            instructions,
            outputContract: 'Response must be in first person, grounded in a concrete example, with STAR-style flow.',
            streamStrategy: 'direct',
        };
    }
}
