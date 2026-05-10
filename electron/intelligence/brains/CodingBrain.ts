// electron/intelligence/brains/CodingBrain.ts
// Domain brain for coding interviews, DSA reasoning, code generation,
// complexity analysis, optimization, edge cases, and debugging.

import type { BrainId } from '../types';
import type { Brain, BrainInput, BrainOutput } from './Brain';
import type { PromptInstruction } from '../../ActionContextBuilder';

export class CodingBrain implements Brain {
    readonly id: BrainId = 'coding';
    readonly name = 'Coding Brain';
    readonly latencyTarget = 600;

    execute(input: BrainInput): BrainOutput {
        const { analysis, strategy, context } = input;
        const instructions: PromptInstruction[] = [];

        // Core reasoning directive
        instructions.push({
            key: 'brain_directive',
            title: 'BRAIN: CODING',
            content: [
                'You are a senior software engineer in a live coding interview.',
                'Prioritize correctness, implementation detail, and concise technical reasoning.',
                'Think through edge cases before writing code.',
                'Mention time and space complexity when algorithmic.',
                'If the question involves debugging, identify the root cause first, then fix.',
                'Use the programming language visible in context, or Python if unclear.',
            ].join('\n'),
        });

        // Structured output format
        const isDeepCoding = analysis.estimatedDepth === 'deep' || strategy.depth === 'deep';
        const [minBullets, maxBullets] = strategy.bulletRange;

        if (isDeepCoding) {
            instructions.push({
                key: 'output_contract',
                title: 'OUTPUT CONTRACT',
                content: [
                    'Structure your answer in this order:',
                    '1. One direct answer sentence stating the approach.',
                    `2. "Approach:" section with ${minBullets} to ${maxBullets} bullet points describing the algorithm steps.`,
                    '3. A complete, production-ready code solution in a fenced code block.',
                    '4. "Complexity:" line with time and space analysis.',
                    '',
                    'The code must be COMPLETE — not pseudocode, not placeholders.',
                    'Add inline comments on non-obvious lines.',
                    `Target ${strategy.maxWords} words total (excluding code).`,
                ].join('\n'),
            });
        } else {
            instructions.push({
                key: 'output_contract',
                title: 'OUTPUT CONTRACT',
                content: [
                    'Start with one direct answer sentence.',
                    `Then add an "Approach:" section with ${minBullets} to ${maxBullets} short bullet points.`,
                    'Include a "Complexity:" line with time and space when algorithmic.',
                    'Include code only if the user explicitly asked for implementation.',
                    'Keep it interview-ready and concise.',
                    `Keep the response under ${strategy.maxWords} words (excluding code).`,
                ].join('\n'),
            });
        }

        // Reasoning hints based on question signals
        const hints: string[] = [];
        if (analysis.referencesContext) {
            hints.push('The user is referencing earlier context — build on the previous discussion.');
        }
        if (analysis.isFollowUp) {
            hints.push('This is a follow-up. Do not restart the explanation from scratch.');
        }

        if (hints.length > 0) {
            instructions.push({
                key: 'reasoning_hints',
                title: 'REASONING HINTS',
                content: hints.join('\n'),
            });
        }

        // Context priority
        instructions.push({
            key: 'context_priority',
            title: 'CONTEXT PRIORITY',
            content: [
                'Answer the latest question first.',
                'Prefer screen content and code snippets over transcript when they conflict.',
                'Do not repeat setup the interviewer already knows.',
            ].join('\n'),
        });

        return {
            instructions,
            outputContract: 'Response must contain a clear approach with complexity analysis. Code block required for implementation questions.',
            streamStrategy: isDeepCoding ? 'collect_validate' : 'direct',
            preferredModel: isDeepCoding ? undefined : undefined, // ModelRouter handles this
        };
    }
}
