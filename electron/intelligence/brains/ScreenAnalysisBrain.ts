// electron/intelligence/brains/ScreenAnalysisBrain.ts
// Domain brain for screen/screenshot analysis — OCR-aware reasoning,
// coding screenshot analysis, UI understanding, contextual suggestions.
//
// NOTE: This brain intentionally does NOT consume reasoningPlan.
// Screen scan has its own specialized pipeline with coding detection
// and OCR-aware prompt construction. Plan-awareness is not needed here.

import type { BrainId } from '../types';
import type { Brain, BrainInput, BrainOutput } from './Brain';
import type { PromptInstruction } from '../../ActionContextBuilder';

export class ScreenAnalysisBrain implements Brain {
    readonly id: BrainId = 'screen_analysis';
    readonly name = 'Screen Analysis Brain';
    readonly latencyTarget = 700;

    execute(input: BrainInput): BrainOutput {
        const { analysis, strategy, context, imagePaths, userMessage } = input;
        const instructions: PromptInstruction[] = [];
        const hasImages = !!(imagePaths && imagePaths.length > 0);
        const previousPriority = input.contextPriority?.priorities.previous_response;

        // Detect if this is likely a coding problem on screen
        const screenText = context.sources.find(s => s.type === 'screen_content')?.content
            ?? userMessage
            ?? '';
        const looksLikeCodingProblem = /\b(function|class|def |const |let |var |int |void |public |private |array|string|return|input|output|example|constraint|leetcode|hackerrank)\b/i.test(screenText);

        // Core reasoning directive
        instructions.push({
            key: 'brain_directive',
            title: 'BRAIN: SCREEN ANALYSIS',
            content: [
                'You are analyzing content visible on the user\'s screen.',
                hasImages
                    ? 'Screenshots have been provided — analyze the visual content directly.'
                    : 'Screen text has been extracted via OCR — work with the extracted text.',
                'Focus on accurately interpreting the visible content.',
                'Extract relevant details and ignore noise or UI chrome.',
                'If the screen shows a coding problem, you MUST solve it completely.',
                'For OCR text, treat partial noise as normal and recoverable.',
                'When a LeetCode/HackerRank title, URL, number, examples, constraints, signature, or distinctive keywords are visible, treat the problem as identified.',
                'If context includes VISIBLE EDITOR LANGUAGE or REQUIRED SOLUTION LANGUAGE, that detected language is authoritative.',
                'If the editor language, starter function signature, or syntax pattern is visible, the final solution MUST use that language.',
                'Do not default to Python when visible OCR shows C++, Java, Python3, Python, JavaScript, TypeScript, C#, C, Go, Kotlin, Swift, Rust, Ruby, PHP, Dart, Scala, Elixir, Erlang, Racket, or another coding language.',
                'Do not ask for another screenshot or say the screen could not be analyzed unless the extracted text is genuinely unusable.',
            ].join('\n'),
        });

        // Output contract: coding problem vs general screen content
        if (looksLikeCodingProblem) {
            instructions.push({
                key: 'coding_contract',
                title: 'CODING CONTRACT',
                content: [
                    'You are looking at a coding problem on screen. Your job is to SOLVE it completely.',
                    '',
                    'Your response MUST have exactly three sections in this order:',
                    '',
                    'SECTION 1 — Start with a bold header "Problem:" followed by the real problem name.',
                    'Write the actual name like "Two Sum" or "Reverse Linked List" — include the platform number if visible.',
                    'Then write 1-2 sentences explaining what the problem actually asks.',
                    '',
                    'SECTION 2 — Write a bold header "Approach:" then explain YOUR chosen algorithm.',
                    'Use 3-5 bullet points describing the actual steps of the algorithm you will implement.',
                    'Name the specific data structure (hash map, stack, two pointers, etc.) and explain why.',
                    'State the actual time and space complexity with reasoning.',
                    '',
                    'SECTION 3 — Write a bold header "Solution:" then write the FULL working code.',
                    'The code MUST be inside a fenced code block with the language tag.',
                    'The code must be COMPLETE — a real implementation that compiles and runs correctly.',
                    'Add inline comments on non-obvious lines explaining the logic.',
                    'If VISIBLE EDITOR LANGUAGE or REQUIRED CODE FENCE is present in context, use that exact language and fence.',
                    'Use the programming language visible on screen. Default to Python only when no editor language, starter signature, or syntax pattern is visible.',
                    '',
                    'CRITICAL: Do NOT output placeholder text like "complete optimized solution".',
                    'You must write the REAL problem name, REAL algorithm, and REAL working code.',
                ].join('\n'),
            });
            instructions.push({
                key: 'ocr_reconstruction_rules',
                title: 'OCR RECONSTRUCTION RULES',
                content: [
                    'A partially noisy OCR extraction is normal and recoverable.',
                    'When OCR contains a recognizable LeetCode/HackerRank problem title, URL, number, examples, constraints, function signature, or distinctive keywords, treat the problem as identified and solve it.',
                    'If a LeetCode number or title is visible, assume that problem and solve it.',
                    'If OCR confidence is moderate but problem identity confidence is above 70%, proceed with best-effort reconstruction.',
                    'Do NOT request another screenshot when enough evidence exists.',
                    'Do NOT state that the screen could not be analyzed unless the extracted text is genuinely unusable.',
                    'Never output "I could not fully analyze the screen content" when OCR length is above 500 characters, a known coding problem is recognized, or examples are present.',
                ].join('\n'),
            });
        } else {
            instructions.push({
                key: 'output_contract',
                title: 'OUTPUT CONTRACT',
                content: [
                    'Analyze the screen content and return the most useful answer.',
                    'If it contains a question or problem, answer it directly.',
                    'If it shows a UI or application, describe what\'s relevant and suggest actions.',
                    'If it contains text content, extract and summarize the key information.',
                    `Keep the response under ${strategy.maxWords} words unless code is required.`,
                    'Be direct — no meta commentary about the screenshot itself.',
                ].join('\n'),
            });
        }

        // Context priority for screen analysis
        instructions.push({
            key: 'context_priority',
            title: 'CONTEXT PRIORITY',
            content: [
                'Screen content is your PRIMARY source — prioritize it over transcript.',
                previousPriority === 'high' || previousPriority === 'critical'
                    ? 'Use transcript or previous answer context only to continue the visible task, not to override the screen.'
                    : 'Use transcript context only to understand what the user is working on.',
                'Ignore unrelated earlier conversation.',
            ].join('\n'),
        });

        return {
            instructions,
            outputContract: looksLikeCodingProblem
                ? 'Response must contain Problem, Approach, and Solution sections with real working code.'
                : 'Response must directly address the visible screen content.',
            streamStrategy: looksLikeCodingProblem ? 'collect_validate' : 'direct',
        };
    }
}
