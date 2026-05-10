// electron/intelligence/brains/SystemDesignBrain.ts
// Domain brain for system design interviews — architecture, tradeoffs,
// scalability, databases, caching, queues, bottlenecks, failure handling.

import type { BrainId } from '../types';
import type { Brain, BrainInput, BrainOutput } from './Brain';
import type { PromptInstruction } from '../../ActionContextBuilder';

export class SystemDesignBrain implements Brain {
    readonly id: BrainId = 'system_design';
    readonly name = 'System Design Brain';
    readonly latencyTarget = 600;

    execute(input: BrainInput): BrainOutput {
        const { analysis, strategy, context } = input;
        const instructions: PromptInstruction[] = [];

        // Core reasoning directive
        instructions.push({
            key: 'brain_directive',
            title: 'BRAIN: SYSTEM DESIGN',
            content: [
                'You are a Staff+ engineer in a live system design interview.',
                'Focus on architecture, tradeoffs, scalability, reliability, and failure handling.',
                'Lead with the architecture direction before diving into details.',
                'Call out tradeoffs explicitly — never present a design as the only option.',
                'Include scale estimates when relevant (QPS, storage, bandwidth).',
                'Mention specific technologies by name (Redis, Kafka, PostgreSQL, etc.).',
                'Address failure modes and how the system recovers.',
            ].join('\n'),
        });

        // Structured output based on depth
        const [minBullets, maxBullets] = strategy.bulletRange;
        const isDeep = analysis.estimatedDepth === 'deep' || strategy.depth === 'deep';

        if (isDeep) {
            instructions.push({
                key: 'output_contract',
                title: 'OUTPUT CONTRACT',
                content: [
                    'Structure your answer in this order:',
                    '1. "Requirements:" — 2-3 bullets clarifying functional and non-functional requirements.',
                    '2. "High-Level Design:" — describe the architecture with key components.',
                    '3. "Deep Dive:" — detail the most critical component (data model, API design, or scaling strategy).',
                    '4. "Tradeoffs:" — 2-3 bullets on key design decisions and their alternatives.',
                    '5. "Failure Handling:" — how the system handles the most likely failure modes.',
                    '',
                    'Use concrete numbers: QPS, latency targets, storage estimates.',
                    `Target ${strategy.maxWords} words.`,
                ].join('\n'),
            });
        } else {
            instructions.push({
                key: 'output_contract',
                title: 'OUTPUT CONTRACT',
                content: [
                    'Lead with one direct sentence stating the architecture direction.',
                    `Then provide ${minBullets} to ${maxBullets} bullets covering:`,
                    '  - Key components and how they interact',
                    '  - The primary tradeoff in this design',
                    '  - Scale or reliability consideration',
                    'Keep it interview-ready — something the user can say aloud.',
                    `Keep under ${strategy.maxWords} words.`,
                ].join('\n'),
            });
        }

        // Reasoning hints
        const hints: string[] = [];
        if (analysis.isFollowUp) {
            hints.push('Continue from the current design — do not restart from requirements.');
        }
        if (analysis.referencesContext) {
            hints.push('The user referenced earlier discussion. Build on the existing architecture.');
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
                'Highlight architecture choices, tradeoffs, and open risks.',
                'Prefer architecture alternatives over generic brainstorming.',
                'Include operational tradeoffs for each option.',
            ].join('\n'),
        });

        return {
            instructions,
            outputContract: 'Response must address architecture direction with explicit tradeoffs. Must include scale/reliability considerations.',
            streamStrategy: isDeep ? 'collect_validate' : 'direct',
        };
    }
}
