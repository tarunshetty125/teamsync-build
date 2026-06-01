import type { SessionMode } from './SessionTracker';
import {
    getQuestionResponseProfile,
    resolveCodingContractLanguage,
    type CodingContractLanguage,
    type UnifiedActionIntent,
} from './ActionContextBuilder';
import {
    normalizeActionContract,
    resolveEffectiveActionContract,
    type ActionContract,
} from '../src/lib/overlay/actionContextTypes';

export interface ActionOutputValidationResult {
    valid: boolean;
    correctedContent: string;
    autoCorrected: boolean;
    issues: string[];
    warnings?: string[];
    repairApplied?: boolean;
}

function describeRepairCodingLanguage(language: CodingContractLanguage): string {
    switch (language.source) {
        case 'explicit':
            return `Required solution language for repair: ${language.label}, because the latest question explicitly requested it.`;
        case 'preference':
            return `Required solution language for repair: ${language.label}, from the user preferred coding language setting.`;
        case 'default':
        default:
            return 'Required solution language for repair: JavaScript, because no explicit language or user preference was provided.';
    }
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
    const normalized = normalizeCodingMarkdown(content);
    const trimmed = normalized.text.trim();
    const codeSyntaxIssues = hasFencedCodeBlock(trimmed) ? validateFencedCodeSyntax(trimmed) : [];
    if (codeSyntaxIssues.length > 0) {
        return {
            valid: false,
            correctedContent: trimmed,
            autoCorrected: normalized.changed,
            issues: codeSyntaxIssues,
        };
    }
    // Lenient validation: accept any substantive response from the LLM.
    // The old strict validation (requiring 3+ lines with 2+ bullets) was rejecting
    // real LLM answers and replacing them with hardcoded template placeholder text
    // — which is worse than any imperfect answer.
    if (trimmed.length > 50) {
        return {
            valid: true,
            correctedContent: trimmed,
            autoCorrected: normalized.changed,
            issues: normalized.changed ? ['normalized_coding_markdown_fences'] : [],
        };
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
    const normalized = normalizeCodingMarkdown(content);
    const trimmed = normalized.text.trim();
    const codeSyntaxIssues = hasFencedCodeBlock(trimmed) ? validateFencedCodeSyntax(trimmed) : [];
    if (codeSyntaxIssues.length > 0) {
        return {
            valid: false,
            correctedContent: trimmed,
            autoCorrected: normalized.changed,
            issues: codeSyntaxIssues,
        };
    }
    return {
        valid: Boolean(trimmed),
        correctedContent: trimmed,
        autoCorrected: normalized.changed,
        issues: trimmed ? (normalized.changed ? ['normalized_coding_markdown_fences'] : []) : ['empty_output'],
    };
}

function normalizeCodingMarkdown(content: string): { text: string; changed: boolean } {
    let text = content.replace(/\r\n?/g, '\n').trim();
    const original = text;
    const languageTag = '(?:c|cpp|c\\+\\+|c#|csharp|c\\s*sharp|python|py|javascript|java\\s*script|js|typescript|type\\s*script|ts|node(?:\\.js)?|node\\s*js|nodejs|java|go|golang|rust|ruby|kotlin|swift|scala|php|dart|r|matlab|sql|mysql|postgres|bash|shell|sh|powershell)';
    const inlineTwoTickOpen = new RegExp(`(^|[\\s:])\`\`[ \\t]*(${languageTag})[ \\t]+(?=\\S)`, 'gi');
    const inlineTripleOpen = new RegExp(`(^|[\\s:])\`\`\`[ \\t]*(${languageTag})[ \\t]+(?=\\S)`, 'gi');

    text = text
        .replace(/(^|\n)([ \t]*)\*{0,2}(Problem|Approach|Complexity|Solution):\*{0,2}[ \t]*/gi, (_match, lineStart, indent, title) => {
            return `${lineStart}${indent}**${title}:**\n`;
        })
        .replace(/(^|\n)([ \t]*)```([A-Za-z][A-Za-z0-9_#+.-]*)[ \t]+(?=\S)/g, '$1$2```$3\n')
        .replace(/(^|\n)([ \t]*)``([A-Za-z][A-Za-z0-9_#+.-]*)[ \t]*/g, '$1$2```$3\n')
        .replace(inlineTripleOpen, (_match, prefix, lang) => `${prefix}\`\`\`${lang}\n`)
        .replace(inlineTwoTickOpen, (_match, prefix, lang) => `${prefix}\`\`\`${lang}\n`)
        .replace(/\n[ \t]*``[ \t]*(?=\n|$)/g, '\n```');

    const fenceCount = (text.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) {
        text = `${text.replace(/[ \t]*`{1,2}[ \t]*$/, '').trimEnd()}\n\`\`\``;
    }

    return { text: text.trim(), changed: text.trim() !== original };
}

function extractFencedCodeBlocks(content: string): Array<{ lang: string; code: string }> {
    const blocks: Array<{ lang: string; code: string }> = [];
    const blockRe = /```[ \t]*([^\n`]*)\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(content)) !== null) {
        const lang = (match[1] || '').trim().split(/\s+/)[0] || 'text';
        const code = (match[2] || '').trim();
        if (code) blocks.push({ lang, code });
    }
    return blocks;
}

function hasFencedCodeBlock(content: string): boolean {
    return extractFencedCodeBlocks(content).length > 0;
}

function stripCodeCommentsAndStrings(code: string): string {
    let output = '';
    let state: 'normal' | 'line_comment' | 'block_comment' | 'single' | 'double' | 'template' = 'normal';
    let escaped = false;

    for (let i = 0; i < code.length; i += 1) {
        const ch = code[i];
        const next = code[i + 1];

        if (state === 'line_comment') {
            if (ch === '\n') {
                state = 'normal';
                output += '\n';
            }
            continue;
        }

        if (state === 'block_comment') {
            if (ch === '*' && next === '/') {
                state = 'normal';
                i += 1;
            }
            continue;
        }

        if (state === 'single' || state === 'double' || state === 'template') {
            const quote = state === 'single' ? '\'' : state === 'double' ? '"' : '`';
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === quote) {
                state = 'normal';
            }
            if (ch === '\n') output += '\n';
            continue;
        }

        if (ch === '/' && next === '/') {
            state = 'line_comment';
            i += 1;
            continue;
        }
        if (ch === '/' && next === '*') {
            state = 'block_comment';
            i += 1;
            continue;
        }
        if (ch === '\'') {
            state = 'single';
            continue;
        }
        if (ch === '"') {
            state = 'double';
            continue;
        }
        if (ch === '`') {
            state = 'template';
            continue;
        }

        output += ch;
    }

    return output;
}

function findDelimiterIssue(code: string): string | null {
    const cleaned = stripCodeCommentsAndStrings(code);
    const stack: string[] = [];
    const pairs: Record<string, string> = { ')': '(', '}': '{', ']': '[' };
    const openers = new Set(['(', '{', '[']);

    for (const ch of cleaned) {
        if (openers.has(ch)) {
            stack.push(ch);
            continue;
        }
        if (pairs[ch]) {
            if (stack.pop() !== pairs[ch]) {
                return 'coding_unbalanced_delimiters';
            }
        }
    }

    return stack.length > 0 ? 'coding_unbalanced_delimiters' : null;
}

function normalizeCodeLang(lang: string): string {
    return lang.trim().toLowerCase().replace(/\s+/g, '');
}

function hasInconsistentCSharpRectangularArrayRows(code: string): boolean {
    const arrayRe = /\b(?:int|long|double|float|decimal|bool|string|char)\s*\[\s*,\s*\]\s+\w+\s*=\s*\{([\s\S]*?)\};/g;
    let match: RegExpExecArray | null;
    while ((match = arrayRe.exec(code)) !== null) {
        const body = match[1] || '';
        const rowLengths = Array.from(body.matchAll(/\{([^{}]*)\}/g))
            .map((row) => row[1].split(',').map((cell) => cell.trim()).filter(Boolean).length)
            .filter((length) => length > 0);
        if (rowLengths.length > 1 && new Set(rowLengths).size > 1) {
            return true;
        }
    }
    return false;
}

function hasLikelyPythonSyntaxIssue(code: string): boolean {
    const cleaned = stripCodeCommentsAndStrings(code);
    const lines = code.split('\n').map((line) => line.trim()).filter(Boolean);
    const nonCommentLines = lines.filter((line) => !line.startsWith('#'));

    if (/\bimport\s+[A-Za-z_]\w*\s+import\s+[A-Za-z_]\w*/.test(cleaned)) {
        return true;
    }

    if (/\bheapop\b|\bheappuh\b|\bpritn\b|\bretrun\b|\bwhle\b|\belif\s*:/.test(code)) {
        return true;
    }

    if (nonCommentLines.some((line) => /^[A-Z][A-Za-z0-9 _-]{2,}:$/.test(line))) {
        return true;
    }

    if (/\b(def|class|if|elif|else|for|while|try|except|finally|with)\b[^\n]*:[ \t]+\S/.test(cleaned)) {
        return true;
    }

    if (/\b(return|continue|break|pass|raise)\b[^\n;#]+\b(if|for|while|return|continue|break|pass|raise|[A-Za-z_]\w*\s*=)\b/.test(cleaned)) {
        return true;
    }

    if (/\b[A-Za-z_]\w*\s*=\s*[^\n;#]+?[ \t]+\b(print|return|for|while|if|def|class|[A-Za-z_]\w*\s*=)\b/.test(cleaned)) {
        return true;
    }

    return false;
}

function findLikelyCompileIssue(lang: string, code: string): string | null {
    const normalizedLang = normalizeCodeLang(lang);
    const cleaned = stripCodeCommentsAndStrings(code);
    const isCSharpLike = ['csharp', 'c#', 'c'].includes(normalizedLang) || normalizedLang === 'cs';
    const isJavaLike = normalizedLang === 'java';
    const isJsLike = ['javascript', 'js', 'typescript', 'ts', 'node.js', 'nodejs'].includes(normalizedLang);
    const isCLike = ['c', 'cpp', 'c++'].includes(normalizedLang);
    const isPythonLike = ['python', 'py', 'python3'].includes(normalizedLang);

    if (/\b[A-Za-z_]\w*\+\s*(?:\)|;)|\b[A-Za-z_]\w*-\s*(?:\)|;)/.test(cleaned)) {
        return 'coding_likely_compile_error';
    }

    if ((isCSharpLike || isJavaLike || isCLike || isJsLike) && /\bclas\b|\bpublc\b|\bprivte\b|\bstaitc\b|\bretrun\b|\bretun\b|\bwhlie\b|\bbol\b|\bColections\b|\bCollectons\b|\bSystm\b|\bConsol\b|\bWriteline\b|\bReadline\b/.test(code)) {
        return 'coding_likely_compile_error';
    }

    if (isCSharpLike && hasInconsistentCSharpRectangularArrayRows(code)) {
        return 'coding_likely_compile_error';
    }

    if (isPythonLike && hasLikelyPythonSyntaxIssue(code)) {
        return 'coding_likely_compile_error';
    }

    return null;
}

function validateFencedCodeSyntax(content: string): string[] {
    const issues: string[] = [];
    for (const block of extractFencedCodeBlocks(content)) {
        if (block.code.length < 20) continue;
        const delimiterIssue = findDelimiterIssue(block.code);
        if (delimiterIssue) issues.push(delimiterIssue);
        const compileIssue = findLikelyCompileIssue(block.lang, block.code);
        if (compileIssue) issues.push(compileIssue);
    }
    return Array.from(new Set(issues));
}

function validateCodingInterviewAnswer(content: string): ActionOutputValidationResult {
    const normalized = normalizeCodingMarkdown(content);
    const trimmed = normalized.text.trim();
    const hasCodeBlock = hasFencedCodeBlock(trimmed);
    const hasProblem = /\*\*problem:?\*\*|^problem:/im.test(trimmed);
    const hasApproach = /\*\*approach:?\*\*|^approach:/im.test(trimmed);
    const hasComplexity = /\*\*complexity:?\*\*|^complexity:/im.test(trimmed);
    const hasSolution = /\*\*solution:?\*\*|^solution:/im.test(trimmed);
    const codeSyntaxIssues = hasCodeBlock ? validateFencedCodeSyntax(trimmed) : [];
    const hasCompleteCodingShape = hasProblem && hasApproach && hasComplexity && hasSolution && hasCodeBlock && trimmed.length > 180;

    if (hasCompleteCodingShape) {
        if (codeSyntaxIssues.length > 0) {
            return {
                valid: false,
                correctedContent: trimmed,
                autoCorrected: normalized.changed,
                issues: codeSyntaxIssues,
            };
        }

        return {
            valid: true,
            correctedContent: trimmed,
            autoCorrected: normalized.changed,
            issues: [
                ...(normalized.changed ? ['normalized_coding_markdown_fences'] : []),
            ],
            warnings: codeSyntaxIssues.map((issue) => `${issue}_warning_only`),
        };
    }

    if (codeSyntaxIssues.length > 0) {
        return {
            valid: false,
            correctedContent: trimmed,
            autoCorrected: normalized.changed,
            issues: codeSyntaxIssues,
        };
    }

    if (hasCodeBlock && (hasApproach || hasComplexity || trimmed.length > 200)) {
        return {
            valid: true,
            correctedContent: trimmed,
            autoCorrected: normalized.changed,
            issues: normalized.changed ? ['normalized_coding_markdown_fences'] : [],
        };
    }

    if (hasCodeBlock) {
        return {
            valid: true,
            correctedContent: trimmed,
            autoCorrected: normalized.changed,
            issues: normalized.changed ? ['normalized_coding_markdown_fences'] : [],
        };
    }

    if (trimmed.length > 40 && !hasCodeBlock) {
        return {
            valid: false,
            correctedContent: trimmed,
            autoCorrected: false,
            issues: ['coding_missing_code_block'],
        };
    }

    return { valid: true, correctedContent: trimmed, autoCorrected: false, issues: [] };
}

function hasSolutionSection(content: string): boolean {
    return /\*\*solution:?\*\*|^solution:/im.test(content);
}

function hasImplementationLanguage(content: string): boolean {
    return /\b(implementation|full solution|complete solution|here'?s the code|code below)\b/i.test(content);
}

function validateCodingNoCodeContract(
    content: string,
    contract: Exclude<ActionContract, 'default' | 'optimal_solution' | 'bruteforce_only'>
): ActionOutputValidationResult {
    const normalized = normalizeCodingMarkdown(content);
    const trimmed = normalized.text.trim();
    if (!trimmed) {
        return {
            valid: false,
            correctedContent: '',
            autoCorrected: normalized.changed,
            issues: ['empty_output'],
        };
    }

    const hasCodeBlock = hasFencedCodeBlock(trimmed);
    const issues: string[] = [];
    if (hasCodeBlock) issues.push(`coding_${contract}_must_not_include_code_block`);
    if (hasSolutionSection(trimmed)) issues.push(`coding_${contract}_must_not_include_solution_section`);
    if (contract === 'hint_only' && hasImplementationLanguage(trimmed)) {
        issues.push('coding_hint_only_must_not_present_implementation');
    }

    if (issues.length > 0) {
        return {
            valid: false,
            correctedContent: trimmed,
            autoCorrected: normalized.changed,
            issues,
        };
    }

    return {
        valid: true,
        correctedContent: trimmed,
        autoCorrected: normalized.changed,
        issues: normalized.changed ? ['normalized_coding_markdown_fences'] : [],
    };
}

function validateBruteforceOnlyAnswer(content: string): ActionOutputValidationResult {
    const normalized = normalizeCodingMarkdown(content);
    const trimmed = normalized.text.trim();
    if (!trimmed) {
        return {
            valid: false,
            correctedContent: '',
            autoCorrected: normalized.changed,
            issues: ['empty_output'],
        };
    }

    if (/\b(optimal|optimized|best approach|most efficient)\b/i.test(trimmed)) {
        return {
            valid: false,
            correctedContent: trimmed,
            autoCorrected: normalized.changed,
            issues: ['coding_bruteforce_only_must_not_present_optimal_solution'],
        };
    }

    return {
        valid: true,
        correctedContent: trimmed,
        autoCorrected: normalized.changed,
        issues: normalized.changed ? ['normalized_coding_markdown_fences'] : [],
    };
}

function validateCodingContractAnswer(
    content: string,
    actionContract?: ActionContract
): ActionOutputValidationResult {
    const contract = normalizeActionContract(actionContract);
    switch (contract) {
        case 'hint_only':
        case 'complexity_only':
        case 'edge_cases_only':
        case 'debugging_only':
        case 'followup_questions_only':
            return validateCodingNoCodeContract(content, contract);
        case 'bruteforce_only':
            return validateBruteforceOnlyAnswer(content);
        case 'optimal_solution':
        case undefined:
        default:
            return validateCodingInterviewAnswer(content);
    }
}

function stripSystemDesignPostDiagramDetail(content: string): { text: string; changed: boolean } {
    let changed = false;
    let text = content;

    const withoutIntermediateSections = text.replace(
        /(^|\n)#{1,6}\s*(?:5|6|7|8|9)\.\s+[^\n]*(?:\n[\s\S]*?)(?=\n#{1,6}\s*(?:[1-9]|10)\.\s+|\n#{1,6}\s*Problem Description\b|$)/gi,
        (match, prefix: string) => {
            changed = true;
            return prefix;
        }
    );
    text = withoutIntermediateSections.replace(/\n{3,}/g, '\n\n').trim();

    const fenceMatch = /```[ \t]*architecture_json[^\n]*\n[\s\S]*?\n```/i.exec(text);
    if (!fenceMatch) return { text, changed };

    const afterFenceStart = fenceMatch.index + fenceMatch[0].length;
    const beforeAndFence = text.slice(0, afterFenceStart).trimEnd();
    const afterFence = text.slice(afterFenceStart);
    const finalAnswerMatch = /(?:^|\n)(#{1,6}\s*10\.\s*Interview-Ready Final Answer[\s\S]*)/i.exec(afterFence);
    const trimmedAfterFence = finalAnswerMatch?.[1]?.trim() ?? '';

    const next = [beforeAndFence, trimmedAfterFence].filter(Boolean).join('\n\n').trim();
    if (next !== text) {
        changed = true;
        text = next;
    }

    return { text, changed };
}

function validateSystemDesignInterviewAnswer(content: string, question: string = ''): ActionOutputValidationResult {
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
            issues: [
                ...(normalized.changed ? ['normalized_mermaid_fences'] : []),
            ],
        };
    }

    if (hasArchitectureJson(trimmed) && trimmed.length > 250) {
        return {
            valid: true,
            correctedContent: trimmed,
            autoCorrected: normalized.changed,
            issues: [
                ...(normalized.changed ? ['normalized_mermaid_fences'] : []),
            ],
        };
    }

    return { valid: true, correctedContent: trimmed, autoCorrected: false, issues: [] };
}

function validateCodingScreenScan(content: string): ActionOutputValidationResult {
    const normalized = normalizeCodingMarkdown(content);
    const trimmed = normalized.text.trim();
    // Lenient validation: accept the response if it has meaningful content.
    // The old strict validation was rejecting real LLM answers and replacing
    // them with template placeholder text — which is worse than any imperfect answer.
    const hasCodeBlock = hasFencedCodeBlock(trimmed);
    const hasSubstantialContent = trimmed.length > 100;
    const codeSyntaxIssues = hasCodeBlock ? validateFencedCodeSyntax(trimmed) : [];

    // Screen scan OCR/model output is allowed to be imperfect. Do not replace a
    // complete answer with a fallback just because the lightweight syntax
    // heuristic thinks a code block may be truncated or unbalanced.
    if (hasCodeBlock || hasSubstantialContent) {
        const ignoredSyntaxIssues = codeSyntaxIssues.map((issue) => `${issue}_ignored_for_screen_scan`);
        return {
            valid: true,
            correctedContent: trimmed,
            autoCorrected: normalized.changed,
            issues: [
                ...(normalized.changed ? ['normalized_coding_markdown_fences'] : []),
                ...ignoredSyntaxIssues,
            ],
            warnings: ignoredSyntaxIssues,
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
    question?: string,
    actionContract?: ActionContract
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

    if (intent === 'system_design_tradeoffs') {
        return validateBrainstorm(trimmed);
    }

    if (profile === 'system_design' && (
        intent === 'manual_chat'
        || intent === 'what_to_answer'
        || intent === 'answer_now'
    )) {
        return validateSystemDesignInterviewAnswer(trimmed, question);
    }

    const effectiveActionContract = resolveEffectiveActionContract({ intent, actionContract });

    if (profile === 'coding' && (
        intent === 'manual_chat'
        || intent === 'what_to_answer'
        || intent === 'answer_now'
        || intent === 'clarify'
        || intent === 'brainstorm'
        || intent === 'code_hint'
    )) {
        return validateCodingContractAnswer(trimmed, effectiveActionContract);
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
                ? effectiveActionContract
                    ? validateCodingContractAnswer(trimmed, effectiveActionContract)
                    : validateCodingScreenScan(trimmed)
                : validateDirectAnswer(trimmed);
        case 'answer_now':
        case 'what_to_answer':
        default:
            return validateStructuredAnswer(trimmed);
    }
}

function buildActionContractRepairInstruction(actionContract?: ActionContract): string {
    const contract = normalizeActionContract(actionContract);
    switch (contract) {
        case 'hint_only':
            return 'For this hint-only coding action, return hints only: 2 to 4 concise bullets, no full solution, no Solution section, and no fenced code block.';
        case 'complexity_only':
            return 'For this complexity-only coding action, return only time and space complexity with brief reasoning. Do not include implementation, a Solution section, or any fenced code block.';
        case 'edge_cases_only':
            return 'For this edge-cases-only coding action, return only edge cases or test cases. Do not include algorithm walkthrough, implementation, a Solution section, or any fenced code block.';
        case 'debugging_only':
            return 'For this debugging-only coding action, return likely failure points and the next diagnostic step. Do not include a full rewrite or fenced code block.';
        case 'bruteforce_only':
            return 'For this brute-force-only coding action, explain the naive approach and its complexity. Do not present the optimal solution.';
        case 'followup_questions_only':
            return 'For this follow-up-questions-only action, return questions only as concise bullets. Do not include answers or code.';
        default:
            return '';
    }
}

function buildCodingRepairInstruction(question?: string, preferredCodingLanguage?: string | null): string {
    const language = resolveCodingContractLanguage(question, preferredCodingLanguage);
    return [
        'For coding answers, include the complete runnable solution inside one fenced markdown code block.',
        describeRepairCodingLanguage(language),
        `Use exactly three backticks: opening fence \`\`\`${language.fence} on its own line, code on following lines, closing fence \`\`\` on its own line.`,
        'Never use two backticks or inline code for the solution.',
        `The code must compile in ${language.label}: balance all parentheses, braces, and brackets; fix typos in keywords and standard libraries; use valid loop syntax for ${language.label}; keep prose like "Example usage" outside code or as comments; and for rectangular arrays, every row must have the same length.`,
    ].join(' ');
}

export function buildRepairInstruction(
    intent: UnifiedActionIntent,
    issues: string[],
    actionContract?: ActionContract,
    question?: string,
    preferredCodingLanguage?: string | null
): string {
    const isArchitectureJsonIssue = (issue: string) => (
        issue.startsWith('system_design_architecture_json')
        || issue === 'system_design_missing_fenced_architecture_json'
    );
    const repairIssues = intent === 'system_design_tradeoffs'
        ? issues.filter((issue) => !isArchitectureJsonIssue(issue))
        : issues;
    const effectiveRepairIssues = repairIssues.length > 0
        ? repairIssues
        : ['system_design_tradeoffs_requires_concise_tradeoff_bullets'];
    const architectureJsonRepair = intent !== 'system_design_tradeoffs' && issues.some(isArchitectureJsonIssue);
    const codingRepair = effectiveRepairIssues.some((issue) => issue === 'coding_missing_code_block' || issue === 'coding_unbalanced_delimiters' || issue === 'coding_likely_compile_error');
    const contractRepair = buildActionContractRepairInstruction(resolveEffectiveActionContract({ intent, actionContract }));
    const screenScanLanguageRepair = issues.some((issue) => issue.startsWith('screen_scan_language_mismatch_expected_'));
    return [
        `The previous draft violated the output contract for intent "${intent}".`,
        `Fix these issues: ${effectiveRepairIssues.join(', ')}.`,
        contractRepair,
        architectureJsonRepair
            ? 'For system design answers, include one fenced ```architecture_json``` block with valid JSON only. MINIMUM 12 nodes required. Simple systems need 12+ nodes, medium production systems need 20+ nodes, FAANG-scale systems need 35-60+ nodes. Each node requires id, label, kind and should include technology, purpose, layer, latency, failureMode. Each edge requires source, target and should include label, protocol, latency. Kinds: client, gateway, service, database, cache, queue, storage, external. Include client, edge/gateway, core services, async, data, cache, security, and observability layers. Do not use Mermaid.'
            : '',
        codingRepair
            ? buildCodingRepairInstruction(question, preferredCodingLanguage)
            : '',
        screenScanLanguageRepair
            ? 'For screen scan coding answers, the detected editor language is authoritative. Rewrite the solution in the required detected language and use the required code fence. Do not default to Python when a non-Python editor language was detected.'
            : '',
        'Return only the corrected final answer.',
        'Do not explain the correction.',
    ].filter(Boolean).join(' ');
}

function buildManualChatFallback(question: string): string {
    const normalized = question.trim().toLowerCase();
    const asksIdentity = /\b(who are you|what are you|your name|are you)\b/i.test(normalized);
    const isGreeting = /^(hi|hello|hey|yo|sup|gm|good\s+(morning|afternoon|evening))\b/i.test(normalized);

    if (asksIdentity || isGreeting) {
        return "Hi, I'm TeamSync Intelligence. I can answer typed questions, help with coding and interview responses, and use meeting or screen context when you ask for it.";
    }

    if (normalized.length <= 120) {
        return `I couldn't generate a reliable response for "${question.trim()}" on this attempt. Try sending it again or rephrasing it.`;
    }

    return "I couldn't generate a reliable response to that manual input on this attempt. Try sending it again or rephrasing it.";
}

export function buildSafeActionFallback(
    intent: UnifiedActionIntent,
    mode: SessionMode,
    question: string,
    actionContract?: ActionContract
): string {
    const effectiveActionContract = resolveEffectiveActionContract({ intent, actionContract });
    const responseProfile = getQuestionResponseProfile(question, mode, intent);
    if (mode === 'coding' || effectiveActionContract) {
        switch (effectiveActionContract) {
            case 'hint_only':
                return [
                    '- Identify the invariant before writing code.',
                    '- Work through the smallest edge case by hand.',
                    '- Choose the data structure that makes each operation cheap.',
                ].join('\n');
            case 'complexity_only':
                return [
                    '- Time complexity: state the dominant operation and how many times it runs.',
                    '- Space complexity: count the auxiliary data structures, excluding the input.',
                ].join('\n');
            case 'edge_cases_only':
                return [
                    '- Empty or minimum-size input.',
                    '- Duplicate values or repeated states.',
                    '- Boundary values at the stated constraints.',
                    '- Inputs that force the worst-case path.',
                ].join('\n');
            case 'debugging_only':
                return [
                    '- Check the first state mutation that can make the output diverge.',
                    '- Verify boundary conditions before changing the core algorithm.',
                    '- Add one tiny failing case and trace each variable update.',
                ].join('\n');
            case 'bruteforce_only':
                return [
                    '- Start by enumerating every candidate answer.',
                    '- Validate each candidate directly against the problem constraints.',
                    '- Use this baseline to reason about correctness before optimizing.',
                ].join('\n');
            case 'followup_questions_only':
                return [
                    '- What input size should the solution handle?',
                    '- Are duplicate or invalid inputs possible?',
                    '- Which language should the final implementation use?',
                ].join('\n');
            case 'optimal_solution':
            case undefined:
            default:
                if (mode === 'coding' || (effectiveActionContract === 'optimal_solution' && responseProfile === 'coding')) {
                    return 'I could not generate a contract-compliant coding solution on this attempt. Please retry so I can return the full Problem, Approach, Complexity, and Solution sections with runnable code.';
                }
        }
    }

    const modePrefix = mode === 'system_design'
        ? 'architecture'
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
        case 'manual_chat':
            return buildManualChatFallback(question);
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
