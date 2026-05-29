import type { SessionMode } from './SessionTracker';
import { getQuestionResponseProfile, type UnifiedActionIntent } from './ActionContextBuilder';

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

function normalizeSystemDesignMermaid(content: string): { text: string; changed: boolean } {
    const lines = content.replace(/\r\n?/g, '\n').split('\n');
    const output: string[] = [];
    let insideMermaid = false;
    let changed = false;

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];

        if (!insideMermaid) {
            if (/^\s*`{1,4}\s*mermaid\b[^\n]*$/i.test(line)) {
                output.push('```mermaid');
                insideMermaid = true;
                changed = true;
                continue;
            }
            output.push(line);
            continue;
        }

        if (/^\s*`{1,4}\s*$/.test(line)) {
            output.push('```');
            insideMermaid = false;
            changed = true;
            continue;
        }

        if (/^\s*#{1,6}\s+\S/.test(line) || /^\s*\*\*[^*\n]+:\*\*/.test(line)) {
            output.push('```');
            insideMermaid = false;
            changed = true;
            i -= 1;
            continue;
        }

        output.push(line);
    }

    if (insideMermaid) {
        output.push('```');
        changed = true;
    }

    return { text: output.join('\n').trim(), changed };
}

function hasArchitectureJson(content: string): boolean {
    if (/```[ \t]*(architecture_json|json)[^\n]*\n[\s\S]*"diagram"\s*:[\s\S]*?```/i.test(content)) {
        return true;
    }
    return /architecture_json\s*:?\s*\{[\s\S]*"diagram"\s*:[\s\S]*"nodes"\s*:[\s\S]*"edges"\s*:/i.test(content);
}

function validateArchitectureJsonContract(content: string): { valid: true } | { valid: false; issues: string[] } {
    const fenced = content.match(/```[ \t]*architecture_json[ \t]*\n([\s\S]*?)\n```/i);
    if (!fenced?.[1]?.trim()) {
        return { valid: false, issues: ['system_design_missing_fenced_architecture_json'] };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(fenced[1].trim());
    } catch {
        return { valid: false, issues: ['system_design_invalid_architecture_json'] };
    }

    const root = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    const diagram = root?.diagram && typeof root.diagram === 'object'
        ? root.diagram as Record<string, unknown>
        : null;
    if (!diagram) return { valid: false, issues: ['system_design_architecture_json_missing_diagram'] };
    if (diagram.type !== 'architecture') return { valid: false, issues: ['system_design_architecture_json_bad_type'] };
    if (!['TB', 'BT', 'LR', 'RL'].includes(String(diagram.direction || 'TB'))) {
        return { valid: false, issues: ['system_design_architecture_json_bad_direction'] };
    }

    const nodes = Array.isArray(diagram.nodes) ? diagram.nodes : [];
    const edges = Array.isArray(diagram.edges) ? diagram.edges : [];
    if (nodes.length < 12) return { valid: false, issues: ['system_design_architecture_json_too_few_nodes'] };
    if (edges.length < 1) return { valid: false, issues: ['system_design_architecture_json_needs_edges'] };

    const allowedKinds = new Set(['client', 'gateway', 'service', 'database', 'cache', 'queue', 'storage', 'external']);
    const nodeIds = new Set<string>();
    for (const rawNode of nodes) {
        if (!rawNode || typeof rawNode !== 'object') return { valid: false, issues: ['system_design_architecture_json_bad_node'] };
        const node = rawNode as Record<string, unknown>;
        if (typeof node.id !== 'string' || typeof node.label !== 'string' || typeof node.kind !== 'string') {
            return { valid: false, issues: ['system_design_architecture_json_bad_node'] };
        }
        if (!allowedKinds.has(node.kind)) return { valid: false, issues: ['system_design_architecture_json_bad_node_kind'] };
        for (const optionalTextField of ['technology', 'purpose', 'layer', 'latency', 'failureMode']) {
            if (node[optionalTextField] !== undefined && typeof node[optionalTextField] !== 'string') {
                return { valid: false, issues: ['system_design_architecture_json_bad_node_metadata'] };
            }
        }
        nodeIds.add(node.id);
    }

    for (const rawEdge of edges) {
        if (!rawEdge || typeof rawEdge !== 'object') return { valid: false, issues: ['system_design_architecture_json_bad_edge'] };
        const edge = rawEdge as Record<string, unknown>;
        if (typeof edge.source !== 'string' || typeof edge.target !== 'string') {
            return { valid: false, issues: ['system_design_architecture_json_bad_edge'] };
        }
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) {
            return { valid: false, issues: ['system_design_architecture_json_bad_edge_endpoint'] };
        }
        if (edge.label !== undefined && typeof edge.label !== 'string') {
            return { valid: false, issues: ['system_design_architecture_json_bad_edge_label'] };
        }
        for (const optionalTextField of ['protocol', 'latency']) {
            if (edge[optionalTextField] !== undefined && typeof edge[optionalTextField] !== 'string') {
                return { valid: false, issues: ['system_design_architecture_json_bad_edge_metadata'] };
            }
        }
    }

    return { valid: true };
}

function validateClarify(content: string): ActionOutputValidationResult {
    const trimmed = content.trim();
    // Accept any substantive response — a real LLM answer is always better
    // than a hardcoded fallback template.
    if (trimmed.length > 30) {
        return { valid: true, correctedContent: trimmed, autoCorrected: false, issues: [] };
    }
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
    const trimmed = content.trim();
    // Accept any substantive response — don't reject real LLM answers
    if (trimmed.length > 50) {
        return { valid: true, correctedContent: trimmed, autoCorrected: false, issues: [] };
    }
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
    const trimmed = content.trim();
    // Accept any substantive response — don't reject real LLM answers
    if (trimmed.length > 50) {
        return { valid: true, correctedContent: trimmed, autoCorrected: false, issues: [] };
    }
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
    const trimmed = content.trim();
    // Accept any substantive response — don't reject real LLM answers
    if (trimmed.length > 50) {
        return { valid: true, correctedContent: trimmed, autoCorrected: false, issues: [] };
    }
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
    const trimmed = content.trim();
    // Lenient validation: accept any substantive response from the LLM.
    // The old strict validation (requiring 3+ lines with 2+ bullets) was rejecting
    // real LLM answers and replacing them with hardcoded template placeholder text
    // — which is worse than any imperfect answer.
    if (trimmed.length > 50) {
        return { valid: true, correctedContent: trimmed, autoCorrected: false, issues: [] };
    }

    // Only reject truly empty or trivially short responses
    if (trimmed.length > 0) {
        return { valid: true, correctedContent: trimmed, autoCorrected: false, issues: [] };
    }

    return {
        valid: false,
        correctedContent: '',
        autoCorrected: false,
        issues: ['answer_too_short_or_empty'],
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

function validateCodingInterviewAnswer(content: string): ActionOutputValidationResult {
    const trimmed = content.trim();
    const hasCodeBlock = /```[\s\S]+?```/.test(trimmed);
    const hasApproach = /\*\*approach\*\*|^approach:/im.test(trimmed);
    const hasComplexity = /\*\*complexity\*\*|^complexity:/im.test(trimmed);

    if (hasCodeBlock && (hasApproach || hasComplexity || trimmed.length > 200)) {
        return { valid: true, correctedContent: trimmed, autoCorrected: false, issues: [] };
    }

    if (hasCodeBlock) {
        return { valid: true, correctedContent: trimmed, autoCorrected: false, issues: [] };
    }

    if (trimmed.length > 120 && !hasCodeBlock) {
        return {
            valid: false,
            correctedContent: trimmed,
            autoCorrected: false,
            issues: ['coding_missing_code_block'],
        };
    }

    return { valid: true, correctedContent: trimmed, autoCorrected: false, issues: [] };
}

function validateSystemDesignInterviewAnswer(content: string): ActionOutputValidationResult {
    const normalized = normalizeSystemDesignMermaid(content);
    const trimmed = normalized.text.trim();
    const architectureJson = validateArchitectureJsonContract(trimmed);
    const sectionHeaders = (trimmed.match(/^#{2,3}\s+\d+\./gm) || []).length;
    const hasComponents = /\b(component|api gateway|database|cache|queue|kafka|redis)\b/i.test(trimmed);

    if ('issues' in architectureJson) {
        return {
            valid: false,
            correctedContent: trimmed,
            autoCorrected: false,
            issues: architectureJson.issues,
        };
    }

    if (hasArchitectureJson(trimmed) && (sectionHeaders >= 3 || hasComponents)) {
        return {
            valid: true,
            correctedContent: trimmed,
            autoCorrected: normalized.changed,
            issues: normalized.changed ? ['normalized_mermaid_fences'] : [],
        };
    }

    if (hasArchitectureJson(trimmed) && trimmed.length > 250) {
        return {
            valid: true,
            correctedContent: trimmed,
            autoCorrected: normalized.changed,
            issues: normalized.changed ? ['normalized_mermaid_fences'] : [],
        };
    }

    return { valid: true, correctedContent: trimmed, autoCorrected: false, issues: [] };
}

function validateCodingScreenScan(content: string): ActionOutputValidationResult {
    const trimmed = content.trim();
    // Lenient validation: accept the response if it has meaningful content.
    // The old strict validation was rejecting real LLM answers and replacing
    // them with template placeholder text — which is worse than any imperfect answer.
    const hasCodeBlock = /```[\s\S]+```/.test(trimmed);
    const hasSubstantialContent = trimmed.length > 100;

    // Accept if it has a code block OR substantial content
    if (hasCodeBlock || hasSubstantialContent) {
        return {
            valid: true,
            correctedContent: trimmed,
            autoCorrected: false,
            issues: [],
        };
    }

    // Only reject truly empty or trivially short responses
    return {
        valid: false,
        correctedContent: '',
        autoCorrected: false,
        issues: ['screen_scan_response_too_short'],
    };
}

export function validateActionOutput(
    intent: UnifiedActionIntent,
    mode: SessionMode,
    content: string,
    question?: string
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

    const profile = question
        ? getQuestionResponseProfile(question, mode, intent)
        : mode === 'coding'
            ? 'coding'
            : mode === 'system_design'
                ? 'system_design'
                : 'general';

    if (profile === 'system_design' && (
        intent === 'manual_chat'
        || intent === 'what_to_answer'
        || intent === 'answer_now'
        || intent === 'system_design_tradeoffs'
    )) {
        return validateSystemDesignInterviewAnswer(trimmed);
    }

    if (profile === 'coding' && (
        intent === 'manual_chat'
        || intent === 'what_to_answer'
        || intent === 'answer_now'
        || intent === 'clarify'
        || intent === 'brainstorm'
        || intent === 'code_hint'
    )) {
        return validateCodingInterviewAnswer(trimmed);
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
    const architectureJsonRepair = issues.some((issue) => issue.startsWith('system_design_architecture_json') || issue === 'system_design_missing_fenced_architecture_json');
    return [
        `The previous draft violated the output contract for intent "${intent}".`,
        `Fix these issues: ${issues.join(', ')}.`,
        architectureJsonRepair
            ? 'For system design answers, include one fenced ```architecture_json``` block with valid JSON only. MINIMUM 12 nodes required. Simple systems need 12+ nodes, medium production systems need 20+ nodes, FAANG-scale systems need 35-60+ nodes. Each node requires id, label, kind and should include technology, purpose, layer, latency, failureMode. Each edge requires source, target and should include label, protocol, latency. Kinds: client, gateway, service, database, cache, queue, storage, external. Include client, edge/gateway, core services, async, data, cache, security, and observability layers. Do not use Mermaid.'
            : '',
        'Return only the corrected final answer.',
        'Do not explain the correction.',
    ].filter(Boolean).join(' ');
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
                return 'I could not fully analyze the screen content. Please try capturing the screen again with the coding problem clearly visible.';
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
