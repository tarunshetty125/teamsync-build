import type { SessionMode } from './SessionTracker';
import type { UnifiedActionIntent } from './ActionContextBuilder';

export interface ActionOutputValidationResult {
    valid: boolean;
    correctedContent: string;
    autoCorrected: boolean;
    issues: string[];
}

function cleanLines(content: string): string[] {
    return content.split('\n').map((line) => line.trim()).filter(Boolean);
}

function extractQuestions(content: string): string[] {
    return content
        .split(/[\n\r]+|(?<=[?])/)
        .map((part) => part.trim())
        .filter((part) => part.includes('?'))
        .map((part) => {
            const idx = part.indexOf('?');
            return `${part.slice(0, idx).trim()}?`;
        })
        .filter(Boolean);
}

function ensureQuestion(text: string): string {
    const trimmed = text.trim().replace(/^[\-\d.\s]+/, '');
    if (!trimmed) return 'Could you clarify that?';
    return trimmed.endsWith('?') ? trimmed : `${trimmed.replace(/[.!]+$/, '')}?`;
}

function toBullets(lines: string[]): string {
    return lines.map((line) => `- ${line.replace(/^[\-\d.\s]+/, '').trim()}`).join('\n');
}

function extractSentences(content: string): string[] {
    return content
        .replace(/\n+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
}

function validateClarify(content: string): ActionOutputValidationResult {
    const questions = extractQuestions(content);
    if (questions.length === 1 && content.trim() === questions[0]) {
        return { valid: true, correctedContent: questions[0], autoCorrected: false, issues: [] };
    }
    const corrected = ensureQuestion(questions[0] || content);
    return {
        valid: corrected.endsWith('?'),
        correctedContent: corrected,
        autoCorrected: true,
        issues: ['clarify_requires_exactly_one_question'],
    };
}

function validateBulletQuestions(content: string): ActionOutputValidationResult {
    const questions = extractQuestions(content);
    const corrected = toBullets(questions.slice(0, 5).map((question) => ensureQuestion(question)));
    const valid = questions.length >= 1 && cleanLines(content).every((line) => line.startsWith('- ') && line.trim().endsWith('?'));
    return {
        valid: valid || Boolean(corrected),
        correctedContent: valid ? content.trim() : corrected,
        autoCorrected: !valid,
        issues: valid ? [] : ['follow_up_requires_question_bullets'],
    };
}

function validateRecap(content: string): ActionOutputValidationResult {
    const lines = cleanLines(content);
    const valid = lines.length >= 1 && lines.every((line) => line.startsWith('- '));
    if (valid) {
        return { valid: true, correctedContent: content.trim(), autoCorrected: false, issues: [] };
    }

    const sentences = extractSentences(content).slice(0, 6);
    const corrected = toBullets(sentences.length > 0 ? sentences : lines.slice(0, 6));
    return {
        valid: Boolean(corrected),
        correctedContent: corrected,
        autoCorrected: true,
        issues: ['recap_requires_bullets'],
    };
}

function validateBrainstorm(content: string): ActionOutputValidationResult {
    const lines = cleanLines(content);
    const valid = lines.length >= 2 && lines.every((line) => line.startsWith('- '));
    if (valid) {
        return { valid: true, correctedContent: content.trim(), autoCorrected: false, issues: [] };
    }
    const sentences = extractSentences(content).slice(0, 5);
    const corrected = toBullets(sentences);
    return {
        valid: Boolean(corrected),
        correctedContent: corrected,
        autoCorrected: true,
        issues: ['brainstorm_requires_multiple_bullets'],
    };
}

function validateStructuredAnswer(content: string): ActionOutputValidationResult {
    const lines = cleanLines(content);
    const bulletCount = lines.filter((line) => line.startsWith('- ')).length;
    const valid = lines.length >= 3 && bulletCount >= 2;
    if (valid) {
        return { valid: true, correctedContent: content.trim(), autoCorrected: false, issues: [] };
    }

    const sentences = extractSentences(content);
    const opening = sentences[0] || 'I would approach it directly.';
    const middle = sentences.slice(1, 4);
    const closing = sentences[4] || middle.pop() || 'That is how I would frame it.';
    const corrected = [
        opening,
        ...middle.map((sentence) => `- ${sentence}`),
        closing,
    ].filter(Boolean).join('\n');
    return {
        valid: Boolean(corrected),
        correctedContent: corrected,
        autoCorrected: true,
        issues: ['answer_requires_structured_format'],
    };
}

function validateDirectAnswer(content: string): ActionOutputValidationResult {
    const trimmed = content.trim();
    return {
        valid: Boolean(trimmed),
        correctedContent: trimmed,
        autoCorrected: false,
        issues: trimmed ? [] : ['empty_output'],
    };
}

function validateCodingScreenScan(content: string): ActionOutputValidationResult {
    const trimmed = content.trim();
    const hasProblem = /(^|\n)(problem|problem identification)\s*:?/i.test(trimmed);
    const hasApproach = /(^|\n)approach\s*:?/i.test(trimmed);
    const hasComplexity = /(^|\n)complexity\s*:?/i.test(trimmed)
        || (/time complexity/i.test(trimmed) && /space complexity/i.test(trimmed));
    const hasCodeBlock = /```[\s\S]+```/.test(trimmed);

    const valid = hasProblem && hasApproach && hasComplexity && hasCodeBlock;
    if (valid) {
        return {
            valid: true,
            correctedContent: trimmed,
            autoCorrected: false,
            issues: [],
        };
    }

    return {
        valid: false,
        correctedContent: '',
        autoCorrected: false,
        issues: [
            !hasProblem ? 'screen_scan_missing_problem_section' : '',
            !hasApproach ? 'screen_scan_missing_approach_section' : '',
            !hasComplexity ? 'screen_scan_missing_complexity_section' : '',
            !hasCodeBlock ? 'screen_scan_missing_code_block' : '',
        ].filter(Boolean),
    };
}

export function validateActionOutput(
    intent: UnifiedActionIntent,
    mode: SessionMode,
    content: string
): ActionOutputValidationResult {
    const trimmed = content.trim();
    if (!trimmed) {
        return {
            valid: false,
            correctedContent: '',
            autoCorrected: false,
            issues: ['empty_output'],
        };
    }

    switch (intent) {
        case 'clarify':
            return validateClarify(trimmed);
        case 'recap':
            return validateRecap(trimmed);
        case 'follow_up_questions':
            return validateBulletQuestions(trimmed);
        case 'brainstorm':
            return validateBrainstorm(trimmed);
        case 'manual_chat':
        case 'code_hint':
            return validateDirectAnswer(trimmed);
        case 'screen_scan':
            return mode === 'coding'
                ? validateCodingScreenScan(trimmed)
                : validateDirectAnswer(trimmed);
        case 'system_design_tradeoffs':
            return validateBrainstorm(trimmed);
        case 'answer_now':
        case 'what_to_answer':
        default:
            return validateStructuredAnswer(trimmed);
    }
}

export function buildRepairInstruction(intent: UnifiedActionIntent, issues: string[]): string {
    return [
        `The previous draft violated the output contract for intent "${intent}".`,
        `Fix these issues: ${issues.join(', ')}.`,
        'Return only the corrected final answer.',
        'Do not explain the correction.',
    ].join(' ');
}

export function buildSafeActionFallback(
    intent: UnifiedActionIntent,
    mode: SessionMode,
    question: string
): string {
    const modePrefix = mode === 'system_design'
        ? 'architecture'
        : mode === 'coding'
            ? 'implementation'
            : 'response';

    switch (intent) {
        case 'clarify':
            return 'Could you clarify the most important constraint you want me to address?';
        case 'recap':
            return [
                '- We covered the current topic and its main goal.',
                '- The key requirements and constraints were identified at a high level.',
                '- The next step is to confirm the most important open detail before continuing.',
            ].join('\n');
        case 'follow_up_questions':
            return [
                '- What is the most important constraint to optimize for?',
                '- Which tradeoff matters most in this decision?',
                '- What would success look like for this answer?',
            ].join('\n');
        case 'brainstorm':
            return [
                `- Start with the simplest ${modePrefix} that satisfies the core requirement, with the tradeoff that it may not scale far.`,
                `- Use a balanced ${modePrefix} that improves robustness, with the tradeoff of added complexity.`,
                `- Use a more advanced ${modePrefix} for scale and resilience, with the tradeoff of higher operational cost.`,
            ].join('\n');
        case 'screen_scan':
            if (mode === 'coding') {
                return [
                    'Problem: Identify the exact coding problem in 1-2 lines.',
                    'Approach:',
                    '- State the algorithm clearly.',
                    '- Mention the key insight or data structure.',
                    'Complexity: Time O(n), Space O(1).',
                    'Code:',
                    '```python',
                    '# complete optimized solution',
                    '```',
                ].join('\n');
            }
        case 'manual_chat':
            return `I would answer this directly using the strongest available evidence about ${question}.`;
        case 'code_hint':
            return 'Focus on the next implementation step, the core edge case, or the incorrect assumption in the current approach.';
        case 'system_design_tradeoffs':
            return [
                '- The simplest architecture reduces operational cost, but it limits future scale.',
                '- A more distributed design improves resilience, but it adds coordination and debugging overhead.',
                '- Stronger consistency guarantees reduce ambiguity, but they can increase latency and write contention.',
            ].join('\n');
        case 'answer_now':
        case 'what_to_answer':
        default:
            return [
                `I would answer this by focusing on the clearest ${modePrefix} first.`,
                '- State the main point directly and confidently.',
                '- Support it with one concrete detail or tradeoff.',
                '- Close with the most practical next step or outcome.',
                'That gives a concise answer that is safe to say aloud.',
            ].join('\n');
    }
}
