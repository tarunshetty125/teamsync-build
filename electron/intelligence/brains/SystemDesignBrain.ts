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
                'Address failure modes and how the system recovers.',
            ].join('\n'),
        });

        // Structured output based on depth
        const [minBullets, maxBullets] = strategy.bulletRange;
        const isShort = strategy.depth === 'short';
        const isDeep = analysis.estimatedDepth === 'deep' || strategy.depth === 'deep';

        if (isShort) {
            instructions.push({
                key: 'output_contract',
                title: 'OUTPUT CONTRACT',
                content: [
                    'Lead with one direct sentence stating the architecture direction.',
                    `Then provide ${minBullets} to ${maxBullets} concise bullets covering the core components and primary tradeoff.`,
                    'Mention scale or reliability only at a high level.',
                    `Keep under ${strategy.maxWords} words.`,
                ].join('\n'),
            });
        } else if (isDeep) {
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
                    '6. Include exactly one fenced ```architecture_json``` block with diagram.type="architecture", direction, nodes, and edges.',
                    '',
                    'architecture_json is mandatory for every system design answer. Do not use Mermaid or loose component lists as the diagram.',
                    'Allowed node kinds: client, gateway, service, database, cache, queue, storage, external.',
                    'Allowed edge fields: source, target, label.',
                    'Use concrete numbers: QPS, latency targets, storage estimates.',
                    `Target ${strategy.maxWords} words.`,
                ].join('\n'),
            });
        } else {
            instructions.push({
                key: 'output_contract',
                title: 'OUTPUT CONTRACT',
                content: [
                    'Use ### section headers in this order:',
                    'Problem Description — brief description of the problem being solved, what system is being designed and why it matters',
                    '1. High-Level Understanding',
                    '2. Clarifying Questions (2-5 bullets)',
                    '3. Requirements (functional + non-functional)',
                    '4. Architecture Diagram — fenced ```architecture_json``` block (mandatory)',
                    '5. Component Breakdown',
                    '6. Data Flow',
                    '7. Database Design',
                    '8. Scaling Strategy',
                    '9. Bottlenecks & Tradeoffs',
                    '10. Interview-Ready Final Answer',
                    '',
                    'Real architecture only — no placeholder labels.',
                    'The architecture_json must be valid JSON only: {"diagram":{"type":"architecture","direction":"TB","nodes":[{"id":"gateway","label":"API Gateway","kind":"gateway"},{"id":"service","label":"Core Service","kind":"service"}],"edges":[{"source":"gateway","target":"service","label":"routes"}]}}.',
                    'architecture_json is mandatory for every system design answer. Do not use Mermaid or loose component lists as the diagram.',
                    'Allowed node kinds: client, gateway, service, database, cache, queue, storage, external.',
                    'Allowed edge fields: source, target, label.',
                    `Keep prose concise; architecture_json + components are mandatory.`,
                ].join('\n'),
            });
        }

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

        // Context priority
        instructions.push({
            key: 'context_priority',
            title: 'CONTEXT PRIORITY',
            content: [
                'Answer the latest question first.',
                ragPriority === 'high' || ragPriority === 'critical'
                    ? 'If RAG MEMORY is present, use it for architecture-specific facts, constraints, or prior decisions.'
                    : 'Use only the most relevant prior context that sharpens the design.',
                screenPriority === 'high' || screenPriority === 'critical'
                    ? 'Use visible diagrams or OCR text as current-state evidence when present.'
                    : 'Use screen context only when it materially changes the architecture discussion.',
                'Highlight architecture choices, tradeoffs, and open risks.',
                'Prefer architecture alternatives over generic brainstorming.',
                'Include operational tradeoffs for each option.',
            ].join('\n'),
        });

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
