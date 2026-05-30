// electron/intelligence/brains/CodingBrain.ts
// Domain brain for coding interviews, DSA reasoning, code generation,
// complexity analysis, optimization, edge cases, and debugging.

import type { BrainId } from '../types';
import type { Brain, BrainInput, BrainOutput } from './Brain';
import type { PromptInstruction } from '../../ActionContextBuilder';
import { planContains, isPlanConfident } from '../planning';
import { runSubBrains } from '../multibrain/runSubBrains';

export class CodingBrain implements Brain {
    readonly id: BrainId = 'coding';
    readonly name = 'Coding Brain';
    readonly latencyTarget = 600;

    execute(input: BrainInput): BrainOutput {
        const { analysis, strategy, context } = input;
        const instructions: PromptInstruction[] = [];
        const screenPriority = input.contextPriority?.priorities.screen;
        const previousResponsePriority = input.contextPriority?.priorities.previous_response;

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
                'For implementation answers, the final solution must be in one fenced markdown code block using exactly three backticks.',
            ].join('\n'),
        });

        // Structured output format
        const isShortCoding = strategy.depth === 'short';
        const isDeepCoding = analysis.estimatedDepth === 'deep' || strategy.depth === 'deep';
        const [minBullets, maxBullets] = strategy.bulletRange;

        if (isShortCoding) {
            instructions.push({
                key: 'output_contract',
                title: 'OUTPUT CONTRACT',
                content: [
                    'Start with one direct answer sentence.',
                    `Add ${minBullets} to ${maxBullets} short bullets for the key steps only.`,
                    'Include one concise "Complexity:" line when algorithmic.',
                    'If code is requested, put the complete solution in one fenced markdown code block with exactly three backticks.',
                    'Prefer the quickest correct fix over a long walkthrough.',
                    `Keep the response under ${strategy.maxWords} words.`,
                ].join('\n'),
            });
        } else if (isDeepCoding) {
            instructions.push({
                key: 'output_contract',
                title: 'OUTPUT CONTRACT',
                content: [
                    'Structure your answer in this order:',
                    '1. One direct answer sentence stating the approach.',
                    `2. "Approach:" section with ${minBullets} to ${maxBullets} bullet points describing the algorithm steps.`,
                    '3. "Edge Cases:" with the most important tricky inputs or failure modes.',
                    '4. A complete, production-ready code solution in a fenced code block.',
                    '5. "Complexity:" line with time and space analysis.',
                    '',
                    'The code must be COMPLETE — not pseudocode, not placeholders.',
                    'Use exactly this fence shape: opening line ```c (or detected language), code on following lines, closing line ```.',
                    'Never use two backticks, inline code, or code on the same line as the opening fence.',
                    'Add inline comments on non-obvious lines.',
                    'Mention one alternative only if it clarifies a major tradeoff.',
                    `Target ${strategy.maxWords} words total (excluding code).`,
                ].join('\n'),
            });
        } else {
            instructions.push({
                key: 'output_contract',
                title: 'OUTPUT CONTRACT',
                content: [
                    'Structure your answer in this order:',
                    '1. **Problem:** — restate inputs, outputs, and constraints in 1-2 sentences.',
                    `2. **Approach:** — ${minBullets} to ${maxBullets} bullets (algorithm, data structure, why).`,
                    '3. **Complexity:** — time and space with brief reasoning.',
                    '4. **Solution:** — FULL working code in a fenced markdown block (required).',
                    '',
                    'The code must be complete and runnable — not pseudocode.',
                    'Use exactly this fence shape: opening line ```c (or detected language), code on following lines, closing line ```.',
                    'Never use two backticks, inline code, or code on the same line as the opening fence.',
                    `Keep prose under ${strategy.maxWords} words (code block excluded).`,
                ].join('\n'),
            });
        }

        // Plan-aware reasoning emphasis
        const plan = input.reasoningPlan;
        if (plan && isPlanConfident(plan)) {
            const planHints: string[] = [];
            if (planContains(plan, 'complexity_analysis')) {
                planHints.push('Emphasize Big-O time and space complexity analysis.');
            }
            if (planContains(plan, 'edge_cases')) {
                planHints.push('Explicitly reason through edge cases before finalizing the solution.');
            }
            if (planContains(plan, 'optimization')) {
                planHints.push('Show the optimization path: brute-force → optimized, with complexity comparison.');
            }
            if (planContains(plan, 'algorithm')) {
                planHints.push('Name the algorithm or technique being applied.');
            }
            if (planHints.length > 0) {
                instructions.push({
                    key: 'plan_emphasis',
                    title: 'PLAN EMPHASIS',
                    content: planHints.join('\n'),
                });
            }
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
                screenPriority === 'critical' || screenPriority === 'high'
                    ? 'Treat visible screen/OCR code as a primary artifact and prefer it over transcript when they conflict.'
                    : 'Prefer screen content and code snippets over transcript when they conflict.',
                previousResponsePriority === 'high' || previousResponsePriority === 'critical'
                    ? 'Reuse the previous assistant answer only to continue the current reasoning, not to repeat it.'
                    : 'Use previous responses only if they directly help the latest fix or implementation step.',
                'Do not repeat setup the interviewer already knows.',
            ].join('\n'),
        });

        const baseOutput: BrainOutput = {
            instructions,
            outputContract: 'Response must contain a clear approach with complexity analysis. Code block required for implementation questions.',
            streamStrategy: isDeepCoding ? 'collect_validate' : 'direct',
            preferredModel: isDeepCoding ? undefined : undefined, // ModelRouter handles this
        };

        return this.appendSubBrainInsights(input, baseOutput);
    }

    /**
     * Run technical interview sub-brains and append high-confidence insights.
     * Capability-gated, failure-safe, prompt-bloat-safe.
     */
    private appendSubBrainInsights(input: BrainInput, output: BrainOutput): BrainOutput {
        return runSubBrains('technical_interview', input, output, 'multi_brain_technical_interview', 'MULTI-BRAIN TECHNICAL INTERVIEW INSIGHTS', 'CodingBrain');
    }
}
