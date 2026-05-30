// electron/intelligence/brains/SystemDesignBrain.ts
// Domain brain for system design interviews — architecture, tradeoffs,
// scalability, databases, caching, queues, bottlenecks, failure handling.

import type { BrainId } from '../types';
import type { Brain, BrainInput, BrainOutput } from './Brain';
import type { PromptInstruction } from '../../ActionContextBuilder';
import { planContains, isPlanConfident } from '../planning';
import { runSubBrains } from '../multibrain/runSubBrains';

export class SystemDesignBrain implements Brain {
    readonly id: BrainId = 'system_design';
    readonly name = 'System Design Brain';
    readonly latencyTarget = 600;

    execute(input: BrainInput): BrainOutput {
        const { analysis, strategy, context } = input;
        const instructions: PromptInstruction[] = [];
        const ragPriority = input.contextPriority?.priorities.rag;
        const screenPriority = input.contextPriority?.priorities.screen;

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
                'Failure Handling: address the most likely failure modes and how the system recovers.',
                ragPriority === 'high' || ragPriority === 'critical'
                    ? 'RAG MEMORY: use only architecture-specific facts, constraints, or prior decisions that directly affect the design.'
                    : 'Use prior context only when it materially changes the architecture.',
            ].join('\n'),
        });

        const [minBullets, maxBullets] = strategy.bulletRange;
        const isShort = strategy.depth === 'short';
        const isDeep = analysis.estimatedDepth === 'deep' || strategy.depth === 'deep';
        instructions.push({
            key: 'answer_focus',
            title: 'SYSTEM DESIGN FOCUS',
            content: [
                isShort
                    ? `Keep prose tight: one architecture direction plus ${minBullets}-${maxBullets} bullets.`
                    : isDeep
                        ? `Deep dive on the hardest component and include concrete scale assumptions. Target ${strategy.maxWords} words outside the diagram.`
                        : 'Cover architecture direction, component roles, data flow, scaling, and tradeoffs concisely.',
                'The canonical output contract is supplied by ActionContextBuilder; do not repeat schema examples here.',
            ].join('\n'),
        });

        // Plan-aware reasoning emphasis
        const plan = input.reasoningPlan;
        if (plan && isPlanConfident(plan)) {
            const planHints: string[] = [];
            if (planContains(plan, 'scale_estimation')) {
                planHints.push('Include concrete scale assumptions: QPS, storage, bandwidth, latency targets.');
            }
            if (planContains(plan, 'failure_handling')) {
                planHints.push('Explicitly address failure modes and recovery strategies.');
            }
            if (planContains(plan, 'database')) {
                planHints.push('Discuss data model, schema choices, and database selection rationale.');
            }
            if (planContains(plan, 'cache')) {
                planHints.push('Address caching strategy: what to cache, invalidation, TTL.');
            }
            if (planContains(plan, 'tradeoffs')) {
                planHints.push('Call out at least 2 design alternatives with explicit tradeoffs.');
            }
            if (planContains(plan, 'requirements')) {
                planHints.push('Start by clarifying functional and non-functional requirements before diving into design.');
            }
            if (planHints.length > 0) {
                instructions.push({
                    key: 'plan_emphasis',
                    title: 'PLAN EMPHASIS',
                    content: planHints.join('\n'),
                });
            }
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

        void screenPriority;

        const baseOutput: BrainOutput = {
            instructions,
            outputContract: 'Response must address architecture direction with explicit tradeoffs. Must include scale/reliability considerations.',
            streamStrategy: isDeep ? 'collect_validate' : 'direct',
        };

        return this.appendSubBrainInsights(input, baseOutput);
    }

    /**
     * Run technical interview sub-brains and append high-confidence insights.
     * Capability-gated, failure-safe, prompt-bloat-safe.
     */
    private appendSubBrainInsights(input: BrainInput, output: BrainOutput): BrainOutput {
        return runSubBrains('technical_interview', input, output, 'multi_brain_technical_interview', 'MULTI-BRAIN TECHNICAL INTERVIEW INSIGHTS', 'SystemDesignBrain');
    }
}
