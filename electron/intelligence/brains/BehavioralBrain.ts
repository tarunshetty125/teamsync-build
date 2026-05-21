// electron/intelligence/brains/BehavioralBrain.ts
// Domain brain for behavioral interviews — STAR format, first-person answers,
// project grounding, resume personalization, and achievement framing.

import type { BrainId } from '../types';
import type { Brain, BrainInput, BrainOutput } from './Brain';
import type { PromptInstruction } from '../../ActionContextBuilder';
import { planContainsAny, isPlanConfident } from '../planning';

export class BehavioralBrain implements Brain {
    readonly id: BrainId = 'behavioral';
    readonly name = 'Behavioral Brain';
    readonly latencyTarget = 500;

    execute(input: BrainInput): BrainOutput {
        const { analysis, strategy, context } = input;
        const instructions: PromptInstruction[] = [];
        const resumePriority = input.contextPriority?.priorities.resume;
        const jdPriority = input.contextPriority?.priorities.jd;

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
                'CRITICAL: Talk like a real human in a real conversation — NOT like a LinkedIn post or cover letter.',
                'BANNED WORDS: "highly motivated", "passionate about", "results-driven", "proactive", "leveraging", "proven track record", "I possess".',
                'Use natural speech: "So basically what happened was...", "The cool part was...", "What I ended up doing was...".',
                'This is a two-way chat, not a monologue. End with a natural handoff or invite the interviewer to ask more.',
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
                    'Start casually — like a student naturally would: "So basically..." or "Yeah so...".',
                    'Then share the key action and result in 1-2 natural sentences.',
                    `Keep under ${strategy.maxWords} words.`,
                    'No bullet points — use natural speech flow.',
                    'End with something that keeps the conversation going.',
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
                    'Return a natural first-person answer the user can say aloud — like talking to a real person.',
                    'Start casually: "So I\'m currently..." or "Yeah, so what I\'ve been working on is...".',
                    `Then share ${minBullets} to ${maxBullets} key points woven naturally into the conversation — not as stiff bullets.`,
                    'End with something that invites the other person to respond: a question back or "...happy to go deeper on any of that."',
                    `Keep under ${strategy.maxWords} words.`,
                    'Use first person throughout. Sound like a real student, not a resume.',
                ].join('\n'),
            });
        }

        // Profile intelligence integration
        if (context.profileApplied) {
            instructions.push({
                key: 'profile_usage',
                title: 'PROFILE USAGE',
                content: [
                    resumePriority === 'critical'
                        ? 'Use the PROFILE INTELLIGENCE as your primary grounding source for the best matching story.'
                        : 'Use the PROFILE INTELLIGENCE to ground your answer in real experiences.',
                    'Pull specific project names, technologies, team sizes, and outcomes.',
                    'Do NOT dump the entire resume — use only the most relevant detail.',
                    'If no profile detail is relevant to this question, answer from general experience.',
                ].join('\n'),
            });
        }

        if (jdPriority === 'high' || jdPriority === 'critical') {
            instructions.push({
                key: 'jd_alignment',
                title: 'JD ALIGNMENT',
                content: 'When the role context is relevant, frame the story around the responsibilities and qualities the interviewer is likely screening for.',
            });
        }

        // Plan-aware reasoning emphasis
        const plan = input.reasoningPlan;
        if (plan && isPlanConfident(plan)) {
            const starSteps = ['star_situation', 'star_task', 'star_action', 'star_result'] as const;
            if (planContainsAny(plan, [...starSteps])) {
                instructions.push({
                    key: 'plan_emphasis',
                    title: 'PLAN EMPHASIS',
                    content: [
                        'Structure your answer using the STAR framework:',
                        '  - Situation: Set the scene with the specific project and context.',
                        '  - Task: What was your responsibility or the challenge?',
                        '  - Action: What specific steps did YOU take? Use first person.',
                        '  - Result: What was the measurable outcome?',
                        'Every section must be grounded in a real, specific example.',
                    ].join('\n'),
                });
            }
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

