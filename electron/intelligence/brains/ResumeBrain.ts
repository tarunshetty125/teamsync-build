// electron/intelligence/brains/ResumeBrain.ts
// Domain brain for resume/JD questions — profile intelligence, JD alignment,
// project explanation, experience framing, strengths/weaknesses.

import type { BrainId } from '../types';
import type { Brain, BrainInput, BrainOutput } from './Brain';
import type { PromptInstruction } from '../../ActionContextBuilder';
import { planContains, isPlanConfident } from '../planning';

export class ResumeBrain implements Brain {
    readonly id: BrainId = 'resume';
    readonly name = 'Resume Brain';
    readonly latencyTarget = 400;

    execute(input: BrainInput): BrainOutput {
        const { analysis, strategy, context } = input;
        const instructions: PromptInstruction[] = [];
        const jdPriority = input.contextPriority?.priorities.jd;

        // Core reasoning directive
        instructions.push({
            key: 'brain_directive',
            title: 'BRAIN: RESUME & JD',
            content: [
                'You are helping the user answer resume-based or job-description-based interview questions.',
                'Answer in FIRST PERSON as the candidate.',
                'Pull from PROFILE INTELLIGENCE as the primary source of truth.',
                'Align the answer to the specific role requirements when JD context is available.',
                'Frame experiences as accomplishments, not duties.',
                'Use specific metrics, technologies, and outcomes when available.',
                'Do NOT dump the entire resume — use only the most relevant points.',
                'CRITICAL: Sound like a real person having a conversation — NOT like reading a resume aloud.',
                'BANNED: "highly motivated", "passionate about", "results-driven", "I possess", "proven track record", "I am a".',
                'Use natural transitions: "So basically...", "What got me into this was...", "The interesting part was...".',
                'This is a two-way chat. End with something that invites follow-up, not a formal closing statement.',
            ].join('\n'),
        });

        // Output contract
        const [minBullets, maxBullets] = strategy.bulletRange;

        if (strategy.depth === 'short') {
            instructions.push({
                key: 'output_contract',
                title: 'OUTPUT CONTRACT',
                content: [
                    'Return a concise, natural first-person answer — like chatting with someone, not giving a speech.',
                    'Start casually: "So I\'m currently..." or "Yeah, so basically...".',
                    `Use at most ${maxBullets} key points woven naturally into the conversation.`,
                    `Keep under ${strategy.maxWords} words.`,
                    'Do not add unrelated background. No stiff bullet-point lists.',
                ].join('\n'),
            });
        } else {
            instructions.push({
                key: 'output_contract',
                title: 'OUTPUT CONTRACT',
                content: [
                    'Return a natural, conversational first-person answer the user can say aloud.',
                    'Start casually — the way a student would: "So I\'m currently..." or "Hey yeah, so a bit about me...".',
                    `Share ${minBullets} to ${maxBullets} highlights naturally woven into conversation — not as stiff bullets.`,
                    'End with something that keeps the chat going: a question back or "...happy to go deeper on any of that."',
                    'Do not dump a full history. Sound like a person, not a resume summary.',
                    'Use first person throughout.',
                    `Keep under ${strategy.maxWords} words.`,
                ].join('\n'),
            });
        }

        // Profile intelligence is critical for this brain
        if (context.profileApplied) {
            instructions.push({
                key: 'profile_usage',
                title: 'PROFILE USAGE',
                content: [
                    'PROFILE INTELLIGENCE is your PRIMARY source for this answer.',
                    'Extract: project names, role titles, team sizes, technologies, metrics.',
                    'Match profile details to the question being asked.',
                    'If the question asks about strengths, pull achievements.',
                    'If the question asks about weaknesses, frame as growth areas with actions taken.',
                ].join('\n'),
            });
        } else {
            instructions.push({
                key: 'profile_fallback',
                title: 'PROFILE NOTE',
                content: [
                    'No profile intelligence is available for this answer.',
                    'Provide a strong generic answer framework the user can fill in with their own details.',
                    'Use placeholder markers like "[Your Project Name]" where specifics are needed.',
                ].join('\n'),
            });
        }

        // Plan-aware reasoning emphasis
        const plan = input.reasoningPlan;
        if (plan && isPlanConfident(plan)) {
            const planHints: string[] = [];
            if (planContains(plan, 'jd_alignment')) {
                planHints.push('Optimize the answer for role fit — mirror the JD requirements, stack, and responsibilities.');
            }
            if (planContains(plan, 'project_grounding')) {
                planHints.push('Ground every claim in a specific project with measurable outcomes.');
            }
            if (planContains(plan, 'core_explanation')) {
                planHints.push('Explain the technical depth of your contribution, not just the project summary.');
            }
            if (planHints.length > 0) {
                instructions.push({
                    key: 'plan_emphasis',
                    title: 'PLAN EMPHASIS',
                    content: planHints.join('\n'),
                });
            }
        }

        if (jdPriority === 'high' || jdPriority === 'critical') {
            instructions.push({
                key: 'jd_alignment',
                title: 'JD ALIGNMENT',
                content: [
                    'Match the answer to the target role requirements when they are available.',
                    'Mirror the most relevant stack, responsibilities, and business context from the JD.',
                ].join('\n'),
            });
        }

        return {
            instructions,
            outputContract: 'Response must be in first person, aligned to the role/JD, using specific profile details when available.',
            streamStrategy: 'direct',
        };
    }
}
