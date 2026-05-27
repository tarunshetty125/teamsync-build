const MERMAID_TYPES = [
    'graph',
    'flowchart',
    'sequenceDiagram',
    'classDiagram',
    'stateDiagram-v2',
    'stateDiagram',
    'erDiagram',
    'journey',
    'gantt',
    'pie',
    'mindmap',
    'timeline',
    'gitGraph',
    'C4Context',
    'C4Container',
    'C4Component',
    'C4Dynamic',
    'C4Deployment',
] as const;

export const MERMAID_DIAGRAM_RE = new RegExp(`^(${MERMAID_TYPES.join('|')})\\b`, 'i');

const MERMAID_FENCE_OPEN_RE = /^\s*`{1,4}\s*mermaid\b[^\n]*$/i;
const MERMAID_FENCE_ANY_OPEN_RE = /^\s*`{3,4}\s*mermaid\b[^\n]*$/i;
const MERMAID_PREFIX_LINE_RE = /^\s*mermaid\s*$/i;
const FENCE_ONLY_RE = /^\s*`{1,4}\s*$/;
const MARKDOWN_BOUNDARY_RE = /^\s*(#{1,6}\s+\S|```[A-Za-z]|\*\*[^\n]+:\*\*)/;
const FLOWCHART_ARROW_RE = /(^|[^<-])\->(?!>)/g;
const FLOWCHART_KEYWORDS = new Set([
    'graph',
    'flowchart',
    'subgraph',
    'direction',
    'end',
    'classDef',
    'class',
    'style',
    'linkStyle',
    'click',
    'accTitle',
    'accDescr',
]);

export interface MermaidChartNormalizationResult {
    chart: string;
    diagramType: string;
    issues: string[];
}

function normalizeNewlines(value: string): string {
    return value.replace(/\r\n?/g, '\n');
}

function isDiagramTypeLine(line: string): boolean {
    return MERMAID_DIAGRAM_RE.test(line.trim());
}

function stripNodeWrapper(shape: string): string {
    return shape
        .replace(/^\(\(/, '')
        .replace(/\)\)$/, '')
        .replace(/^\[\[/, '')
        .replace(/\]\]$/, '')
        .replace(/^\[\(/, '')
        .replace(/\)\]$/, '')
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .replace(/^\(/, '')
        .replace(/\)$/, '')
        .replace(/^\{\{/, '')
        .replace(/\}\}$/, '')
        .trim()
        .replace(/^"(.*)"$/, '$1');
}

function collectNodeDefinitions(line: string): Array<{ id: string; label: string }> {
    const matches = line.matchAll(/\b([A-Za-z][A-Za-z0-9_-]{2,})\s*(\(\([^)]+\)\)|\[\([^)]+\)\]|\[\[[^\]]+\]\]|\[[^\]]+\]|\([^)]+\)|\{\{[^}]+\}\})/g);
    return Array.from(matches, ([, id, rawLabel]) => ({
        id,
        label: stripNodeWrapper(rawLabel),
    }));
}

function collectPotentialFlowchartIds(line: string): string[] {
    const normalizedLine = line
        .replace(/\|[^|\n]+\|/g, ' ')
        .replace(/\b([A-Za-z][A-Za-z0-9_-]{2,})\s*(\(\([^)]+\)\)|\[\([^)]+\)\]|\[\[[^\]]+\]\]|\[[^\]]+\]|\([^)]+\)|\{\{[^}]+\}\})/g, '$1 ')
        .replace(/"[^"\n]+"/g, ' ');
    const matches = normalizedLine.matchAll(/\b([A-Za-z][A-Za-z0-9_-]{2,})\b/g);
    return Array.from(matches, ([, id]) => id).filter((id) => !FLOWCHART_KEYWORDS.has(id));
}

function commonPrefixLength(a: string, b: string): number {
    const max = Math.min(a.length, b.length);
    let i = 0;
    while (i < max && a[i] === b[i]) i += 1;
    return i;
}

function levenshteinDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    const prev = new Array<number>(b.length + 1);
    const next = new Array<number>(b.length + 1);

    for (let j = 0; j <= b.length; j += 1) prev[j] = j;

    for (let i = 0; i < a.length; i += 1) {
        next[0] = i + 1;
        for (let j = 0; j < b.length; j += 1) {
            const cost = a[i] === b[j] ? 0 : 1;
            next[j + 1] = Math.min(
                next[j] + 1,
                prev[j + 1] + 1,
                prev[j] + cost,
            );
        }
        for (let j = 0; j <= b.length; j += 1) prev[j] = next[j];
    }

    return prev[b.length];
}

function isSafeAliasCandidate(sourceId: string, targetId: string): boolean {
    const source = sourceId.toLowerCase();
    const target = targetId.toLowerCase();
    if (source === target) return false;
    if (Math.abs(source.length - target.length) > 2) return false;

    const prefix = commonPrefixLength(source, target);
    const distance = levenshteinDistance(source, target);
    if (distance <= 1) return true;
    if (distance <= 2 && prefix >= 3) return true;
    if ((source.includes(target) || target.includes(source)) && prefix >= 2) return true;
    return false;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeFlowchartNodeIds(source: string, issues: string[]): string {
    const lines = source.split('\n');
    const definedIds = new Set<string>();
    const labelToId = new Map<string, string>();
    const aliasMap = new Map<string, string>();

    for (const line of lines) {
        for (const { id, label } of collectNodeDefinitions(line)) {
            definedIds.add(id);
            if (!label) continue;
            const labelKey = label.toLowerCase().replace(/\s+/g, ' ').trim();
            const existingId = labelToId.get(labelKey);
            if (existingId && isSafeAliasCandidate(id, existingId)) {
                aliasMap.set(id, existingId);
                issues.push(`merged node id "${id}" into "${existingId}"`);
                continue;
            }
            labelToId.set(labelKey, existingId || id);
        }
    }

    for (const line of lines) {
        const ids = collectPotentialFlowchartIds(line);
        for (const id of ids) {
            if (definedIds.has(id) || aliasMap.has(id)) continue;
            const candidates = Array.from(definedIds).filter((candidate) => isSafeAliasCandidate(id, candidate));
            if (candidates.length === 1) {
                aliasMap.set(id, candidates[0]);
                issues.push(`rewired node id "${id}" to "${candidates[0]}"`);
            }
        }
    }

    if (aliasMap.size === 0) return source;

    return lines
        .map((line) => {
            let nextLine = line;
            for (const [fromId, toId] of Array.from(aliasMap.entries()).sort((a, b) => b[0].length - a[0].length)) {
                nextLine = nextLine.replace(new RegExp(`\\b${escapeRegExp(fromId)}\\b`, 'g'), toId);
            }
            return nextLine;
        })
        .join('\n');
}

export function looksLikeMermaidSource(code: string): boolean {
    const trimmed = normalizeNewlines(code ?? '').trim();
    if (!trimmed) return false;
    if (/^mermaid[\s\r\n]/i.test(trimmed)) return true;
    return MERMAID_DIAGRAM_RE.test(trimmed);
}

export function normalizeV2MermaidMarkdown(text: string, options?: { isStreaming?: boolean }): string {
    const isStreaming = options?.isStreaming ?? false;
    const normalized = normalizeNewlines(text ?? '');
    if (!normalized.trim()) return normalized;

    const lines = normalized.split('\n');
    const output: string[] = [];
    let insideMermaidFence = false;

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];

        if (!insideMermaidFence) {
            if (MERMAID_FENCE_OPEN_RE.test(line) || MERMAID_FENCE_ANY_OPEN_RE.test(line)) {
                output.push('```mermaid');
                insideMermaidFence = true;
                continue;
            }

            if (!isStreaming && MERMAID_PREFIX_LINE_RE.test(line) && isDiagramTypeLine(lines[i + 1] ?? '')) {
                output.push('```mermaid');
                insideMermaidFence = true;
                continue;
            }

            output.push(line);
            continue;
        }

        if (FENCE_ONLY_RE.test(line)) {
            output.push('```');
            insideMermaidFence = false;
            continue;
        }

        if (!isStreaming && MARKDOWN_BOUNDARY_RE.test(line) && !isDiagramTypeLine(line)) {
            output.push('```');
            insideMermaidFence = false;
            i -= 1;
            continue;
        }

        output.push(line);
    }

    if (insideMermaidFence && !isStreaming) {
        output.push('```');
    }

    return output.join('\n');
}

export function normalizeMermaidChartSource(input: string): MermaidChartNormalizationResult {
    const issues: string[] = [];
    let chart = normalizeNewlines(input ?? '').trim();
    if (!chart) return { chart: '', diagramType: 'unknown', issues };

    const withoutLeadingFence = chart.replace(/^`{1,4}\s*(?:mermaid\b[^\n]*)?\s*\n?/i, '');
    if (withoutLeadingFence !== chart) {
        issues.push('removed malformed opening fence');
        chart = withoutLeadingFence.trim();
    }

    const withoutClosingFence = chart.replace(/\n?\s*`{1,4}\s*$/g, '');
    if (withoutClosingFence !== chart) {
        issues.push('removed malformed closing fence');
        chart = withoutClosingFence.trim();
    }

    const withoutPrefix = chart.replace(/^mermaid[\s\r\n]+/i, '');
    if (withoutPrefix !== chart) {
        issues.push('removed stray mermaid prefix');
        chart = withoutPrefix.trim();
    }

    const withoutOrphanFenceLines = chart.replace(/^\s*`+\s*$/gm, '').trim();
    if (withoutOrphanFenceLines !== chart) {
        issues.push('removed orphan backtick lines');
        chart = withoutOrphanFenceLines;
    }

    const withoutTrailingBackticks = chart.replace(/`+\s*$/g, '').trim();
    if (withoutTrailingBackticks !== chart) {
        issues.push('removed trailing backticks');
        chart = withoutTrailingBackticks;
    }

    const diagramType = chart.trim().split(/[\s\n]/)[0] || 'unknown';
    if (/^(graph|flowchart)$/i.test(diagramType)) {
        const normalizedArrows = chart.replace(FLOWCHART_ARROW_RE, '$1 --> ');
        if (normalizedArrows !== chart) {
            issues.push('normalized flowchart arrows');
            chart = normalizedArrows;
        }

        const normalizedIds = normalizeFlowchartNodeIds(chart, issues);
        if (normalizedIds !== chart) {
            chart = normalizedIds;
        }
    }

    return {
        chart: chart.trim(),
        diagramType,
        issues,
    };
}
