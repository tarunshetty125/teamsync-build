import {
    createLinearFallbackDiagram,
    type ArchitectureDiagram,
    type ArchitectureNodeKind,
    validateArchitecturePayload,
} from './architectureSchema';

export type ArchitectureParseState = 'ready' | 'loading' | 'invalid' | 'missing';

export interface ParsedArchitectureResponse {
    markdown: string;
    state: ArchitectureParseState;
    diagram: ArchitectureDiagram | null;
    mermaidChart: string | null;
    fallbackDiagram: ArchitectureDiagram;
    issues: string[];
}

function safeJsonParse(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
    try {
        return { ok: true, value: JSON.parse(raw) };
    } catch (error: any) {
        return { ok: false, error: error?.message || 'invalid_json' };
    }
}

function looksLikeIncompleteJson(raw: string): boolean {
    const trimmed = raw.trim();
    if (!trimmed) return true;
    let balance = 0;
    let inString = false;
    let escaped = false;

    for (const char of trimmed) {
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (char === '{' || char === '[') balance += 1;
        if (char === '}' || char === ']') balance -= 1;
    }

    return inString || balance > 0 || /[,:\[]\s*$/.test(trimmed);
}

function extractFirstMermaidChart(text: string): string | null {
    const fenced = text.match(/```[ \t]*mermaid[^\n]*\n([\s\S]*?)(?:\n```|$)/i);
    if (fenced?.[1]?.trim()) return fenced[1].trim();

    const bare = text.match(/(?:^|\n)\s*((?:graph|flowchart)\s+(?:TD|TB|LR|RL|BT)[\s\S]*)/i);
    return bare?.[1]?.trim() ?? null;
}

function stripMermaidBlocks(text: string): string {
    return text
        .replace(/```[ \t]*mermaid[^\n]*\n[\s\S]*?(?:\n```|$)/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function inferKind(label: string, shape: string): ArchitectureNodeKind {
    const normalized = label.toLowerCase();
    if (shape.includes('((') || /\b(db|database|postgres|mysql|mongo|dynamo)\b/.test(normalized)) return 'database';
    if (/\b(redis|cache)\b/.test(normalized)) return 'cache';
    if (/\b(kafka|queue|pubsub|sqs|rabbit)\b/.test(normalized)) return 'queue';
    if (/\b(s3|storage|cdn|blob)\b/.test(normalized)) return 'storage';
    if (/\b(client|web|mobile|user|app)\b/.test(normalized)) return 'client';
    if (/\b(gateway|load balancer|edge|ingress)\b/.test(normalized)) return 'gateway';
    if (/\b(external|third party|payment|maps|email|sms)\b/.test(normalized)) return 'external';
    return 'service';
}

function parseMermaidNode(token: string): { id: string; label: string; kind: ArchitectureNodeKind } | null {
    const trimmed = token.trim().replace(/[;,]+$/g, '');
    if (!trimmed) return null;

    const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)(.*)$/);
    if (!match) return null;

    const id = match[1];
    const shape = match[2] || '';
    const labelMatch =
        shape.match(/\[\s*([^\]]+?)\s*\]/)
        || shape.match(/\(\(\s*([^)]+?)\s*\)\)/)
        || shape.match(/\(\s*([^)]+?)\s*\)/)
        || shape.match(/\{\s*([^}]+?)\s*\}/);

    const label = (labelMatch?.[1] || id)
        .replace(/^["']|["']$/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return {
        id,
        label,
        kind: inferKind(label, shape),
    };
}

export function mermaidToArchitectureDiagram(chart: string | null): ArchitectureDiagram | null {
    if (!chart) return null;

    const nodes = new Map<string, { id: string; label: string; kind: ArchitectureNodeKind }>();
    const edges: Array<{ source: string; target: string; label?: string }> = [];
    const directionMatch = chart.match(/(?:graph|flowchart)\s+(TD|TB|LR|RL|BT)/i);
    const direction = (directionMatch?.[1]?.toUpperCase() === 'TD' ? 'TB' : directionMatch?.[1]?.toUpperCase()) as ArchitectureDiagram['direction'] | undefined;

    chart.split('\n').forEach((line) => {
        const clean = line.replace(/%%.*$/g, '').trim();
        if (!clean || /^(graph|flowchart)\b/i.test(clean) || /^subgraph\b/i.test(clean) || /^end\b/i.test(clean)) return;

        const edgeMatch = clean.match(/^(.+?)\s*-{1,2}(?:\|([^|]+)\|)?(?:>|-->)\s*(.+)$/);
        if (!edgeMatch) {
            const node = parseMermaidNode(clean);
            if (node) nodes.set(node.id, node);
            return;
        }

        const sourceNode = parseMermaidNode(edgeMatch[1]);
        const targetNode = parseMermaidNode(edgeMatch[3]);
        if (!sourceNode || !targetNode) return;

        nodes.set(sourceNode.id, sourceNode);
        nodes.set(targetNode.id, targetNode);
        const label = edgeMatch[2]?.replace(/\s+/g, ' ').trim();
        edges.push(label ? { source: sourceNode.id, target: targetNode.id, label } : { source: sourceNode.id, target: targetNode.id });
    });

    if (nodes.size === 0) return null;

    const allNodes = Array.from(nodes.values());

    return {
        type: 'architecture',
        direction: direction ?? 'TB',
        nodes: allNodes,
        edges: edges.length > 0
            ? edges
            : allNodes.slice(0, -1).map((node, index) => ({
                source: node.id,
                target: allNodes[index + 1]?.id ?? node.id,
            })).filter((edge) => edge.source !== edge.target),
    };
}

function findBalancedJson(text: string, startIndex: number): { raw: string; end: number; complete: boolean } | null {
    const firstBrace = text.indexOf('{', startIndex);
    if (firstBrace < 0) return null;

    let balance = 0;
    let inString = false;
    let escaped = false;

    for (let i = firstBrace; i < text.length; i += 1) {
        const char = text[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (char === '{') balance += 1;
        if (char === '}') balance -= 1;
        if (balance === 0) {
            return { raw: text.slice(firstBrace, i + 1), end: i + 1, complete: true };
        }
    }

    return { raw: text.slice(firstBrace), end: text.length, complete: false };
}

function fallbackFromText(text: string, mermaidChart: string | null): ArchitectureDiagram {
    const mermaidDiagram = mermaidToArchitectureDiagram(mermaidChart);
    if (mermaidDiagram) return mermaidDiagram;

    const candidates = Array.from(text.matchAll(/\b(Client|Web App|Mobile App|API Gateway|Gateway|Load Balancer|Service|Redis|Cache|Kafka|Queue|Database|Postgres|MongoDB|Object Storage|Storage|CDN|External API)\b/gi))
        .map((match) => match[0]);

    return createLinearFallbackDiagram(Array.from(new Set(candidates)));
}

export function parseArchitectureResponse(text: string, options: { isStreaming: boolean }): ParsedArchitectureResponse {
    const mermaidChart = extractFirstMermaidChart(text);
    const issues: string[] = [];

    const fenceRe = /```[ \t]*(architecture_json|json)[^\n]*\n([\s\S]*?)(\n```|$)/gi;
    let match: RegExpExecArray | null;

    while ((match = fenceRe.exec(text)) !== null) {
        const lang = match[1].toLowerCase();
        const raw = match[2].trim();
        const closed = match[3] === '\n```';
        if (lang === 'json' && !/"diagram"\s*:/.test(raw)) continue;

        const markdown = `${text.slice(0, match.index)}${text.slice(fenceRe.lastIndex)}`.replace(/\n{3,}/g, '\n\n').trim();
        const parsed = safeJsonParse(raw);
        if (!parsed.ok) {
            const state = options.isStreaming && (!closed || looksLikeIncompleteJson(raw)) ? 'loading' : 'invalid';
            return {
                markdown,
                state,
                diagram: null,
                mermaidChart,
                fallbackDiagram: fallbackFromText(markdown, mermaidChart),
                issues: [parsed.error],
            };
        }

        const validation = validateArchitecturePayload(parsed.value);
        return {
            markdown,
            state: validation.valid ? 'ready' : 'invalid',
            diagram: validation.diagram,
            mermaidChart,
            fallbackDiagram: fallbackFromText(markdown, mermaidChart),
            issues: validation.issues,
        };
    }

    const labelMatch = /architecture_json\s*:?\s*/i.exec(text);
    if (labelMatch) {
        const balanced = findBalancedJson(text, labelMatch.index + labelMatch[0].length);
        const markdown = text.slice(0, labelMatch.index).replace(/\n{3,}/g, '\n\n').trim();
        if (!balanced) {
            return {
                markdown,
                state: options.isStreaming ? 'loading' : 'invalid',
                diagram: null,
                mermaidChart,
                fallbackDiagram: fallbackFromText(markdown, mermaidChart),
                issues: ['architecture_json_missing_body'],
            };
        }

        if (!balanced.complete && options.isStreaming) {
            return {
                markdown,
                state: 'loading',
                diagram: null,
                mermaidChart,
                fallbackDiagram: fallbackFromText(markdown, mermaidChart),
                issues: ['architecture_json_streaming'],
            };
        }

        const parsed = safeJsonParse(balanced.raw);
        if (!parsed.ok) {
            return {
                markdown,
                state: 'invalid',
                diagram: null,
                mermaidChart,
                fallbackDiagram: fallbackFromText(markdown, mermaidChart),
                issues: [parsed.error],
            };
        }

        const validation = validateArchitecturePayload(parsed.value);
        return {
            markdown: `${markdown}\n\n${text.slice(balanced.end)}`.replace(/\n{3,}/g, '\n\n').trim(),
            state: validation.valid ? 'ready' : 'invalid',
            diagram: validation.diagram,
            mermaidChart,
            fallbackDiagram: fallbackFromText(markdown, mermaidChart),
            issues: validation.issues,
        };
    }

    return {
        markdown: stripMermaidBlocks(text),
        state: 'missing',
        diagram: null,
        mermaidChart,
        fallbackDiagram: fallbackFromText(text, mermaidChart),
        issues,
    };
}

export function looksLikeSystemDesignResponse(text: string): boolean {
    return /architecture_json/i.test(text)
        || (/```[ \t]*mermaid/i.test(text) && /\b(Architecture Diagram|Component Breakdown|Scaling Strategy|Database Design|High-Level Design|system design)\b/i.test(text));
}
