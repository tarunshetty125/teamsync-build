import {
    createLinearFallbackDiagram,
    type ArchitectureDiagram,
    type ArchitectureEdgeModel,
    type ArchitectureNodeModel,
    type ArchitectureNodeKind,
    validateArchitecturePayload,
} from './architectureSchema';

export type ArchitectureParseState = 'ready' | 'loading' | 'invalid' | 'missing';

export interface ParsedArchitectureResponse {
    markdown: string;
    state: ArchitectureParseState;
    diagram: ArchitectureDiagram | null;
    mermaidChart: string | null;
    fallbackDiagram: ArchitectureDiagram | null;
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

type InferredComponent = ArchitectureNodeModel & {
    rank: number;
    patterns: RegExp[];
};

const INFERRED_COMPONENTS: InferredComponent[] = [
    {
        id: 'client',
        label: 'Client',
        kind: 'client',
        rank: 0,
        patterns: [/\b(?:client|clients|client app|user app|mobile app|web app|browser|end users?)\b/i],
    },
    {
        id: 'load-balancer',
        label: 'Load Balancer',
        kind: 'gateway',
        rank: 10,
        patterns: [/\b(?:load balancer|load-balancer|lb)\b/i],
    },
    {
        id: 'api-gateway',
        label: 'API Gateway',
        kind: 'gateway',
        rank: 20,
        patterns: [/\b(?:api gateway|gateway|edge gateway|ingress)\b/i],
    },
    {
        id: 'app-servers',
        label: 'Application Servers',
        kind: 'service',
        rank: 30,
        patterns: [/\b(?:(?:application|app)\s+servers?|backend servers?|api servers?|core service|service layer|microservices?)\b/i],
    },
    {
        id: 'user-service',
        label: 'User Service',
        kind: 'service',
        rank: 31,
        patterns: [/\b(?:user management|user service|auth service|identity service|profile service)\b/i],
    },
    {
        id: 'catalog-service',
        label: 'Catalog Service',
        kind: 'service',
        rank: 32,
        patterns: [/\b(?:product catalog|catalog service|inventory service|listing service)\b/i],
    },
    {
        id: 'payment-service',
        label: 'Payment Service',
        kind: 'service',
        rank: 33,
        patterns: [/\b(?:payment processing|payment service|payments service|billing service|checkout service)\b/i],
    },
    {
        id: 'messaging-service',
        label: 'Messaging Service',
        kind: 'service',
        rank: 34,
        patterns: [/\b(?:messaging service|message service|chat service|delivery service)\b/i],
    },
    {
        id: 'cache',
        label: 'Cache Layer',
        kind: 'cache',
        rank: 40,
        patterns: [/\b(?:cache layer|cache|redis|memcache|memcached)\b/i],
    },
    {
        id: 'database',
        label: 'Database',
        kind: 'database',
        rank: 50,
        patterns: [/\b(?:database|databases|db|postgres|postgresql|mysql|mongodb|mongo|dynamo|cassandra)\b/i],
    },
    {
        id: 'message-queue',
        label: 'Message Queue',
        kind: 'queue',
        rank: 60,
        patterns: [/\b(?:message queue|message que|queue|kafka|pubsub|pub\/sub|sqs|rabbitmq|asynchronous tasks?)\b/i],
    },
    {
        id: 'storage',
        label: 'Object Storage',
        kind: 'storage',
        rank: 70,
        patterns: [/\b(?:object storage|file storage|blob storage|s3|cdn|uploads?|media storage)\b/i],
    },
    {
        id: 'external-api',
        label: 'External API',
        kind: 'external',
        rank: 80,
        patterns: [/\b(?:external api|third party|third-party|payment provider|maps api|email service|sms service)\b/i],
    },
];

function normalizeArchitectureText(text: string): string {
    return text
        .replace(/\baplication\b/gi, 'application')
        .replace(/\baplications\b/gi, 'applications')
        .replace(/\bque\b/gi, 'queue')
        .replace(/\bapigateway\b/gi, 'api gateway');
}

function hasArchitectureContext(text: string, matchedCount: number): boolean {
    if (matchedCount < 2) return false;
    return /\b(?:architecture diagram|proposed architecture|system design|high-level design|low-level design|hld|lld|scalable|load balancer|api gateway|cache layer|message queue)\b/i.test(text)
        || matchedCount >= 3;
}

function connect(edges: ArchitectureEdgeModel[], source: string | undefined, target: string | undefined, label?: string) {
    if (!source || !target || source === target) return;
    if (edges.some((edge) => edge.source === source && edge.target === target)) return;
    edges.push(label ? { source, target, label } : { source, target });
}

function inferEdges(nodes: ArchitectureNodeModel[]): ArchitectureEdgeModel[] {
    const ids = new Set(nodes.map((node) => node.id));
    const has = (id: string) => ids.has(id);
    const edges: ArchitectureEdgeModel[] = [];
    const serviceIds = nodes.filter((node) => node.kind === 'service').map((node) => node.id);
    const primaryServiceId = has('app-servers') ? 'app-servers' : serviceIds[0];

    connect(edges, has('client') ? 'client' : undefined, has('load-balancer') ? 'load-balancer' : has('api-gateway') ? 'api-gateway' : primaryServiceId, 'requests');
    connect(edges, has('load-balancer') ? 'load-balancer' : undefined, has('api-gateway') ? 'api-gateway' : primaryServiceId, 'routes');

    if (has('api-gateway') && serviceIds.length > 0) {
        serviceIds.forEach((serviceId) => connect(edges, 'api-gateway', serviceId, 'routes'));
    } else {
        connect(edges, has('api-gateway') ? 'api-gateway' : undefined, primaryServiceId, 'routes');
    }

    if (primaryServiceId) {
        connect(edges, primaryServiceId, has('cache') ? 'cache' : undefined, 'reads');
        connect(edges, primaryServiceId, has('database') ? 'database' : undefined, 'persists');
        connect(edges, primaryServiceId, has('message-queue') ? 'message-queue' : undefined, 'publishes');
        connect(edges, primaryServiceId, has('storage') ? 'storage' : undefined, 'stores');
        connect(edges, primaryServiceId, has('external-api') ? 'external-api' : undefined, 'calls');
    }

    if (edges.length > 0) return edges;

    return nodes.slice(0, -1).map((node, index) => ({
        source: node.id,
        target: nodes[index + 1]?.id ?? node.id,
    })).filter((edge) => edge.source !== edge.target);
}

function inferArchitectureDiagramFromText(text: string): ArchitectureDiagram | null {
    const normalized = normalizeArchitectureText(text);
    const matched = INFERRED_COMPONENTS
        .filter((component) => component.patterns.some((pattern) => pattern.test(normalized)))
        .sort((a, b) => a.rank - b.rank);

    if (!hasArchitectureContext(normalized, matched.length)) return null;

    const nodes = matched.map(({ id, label, kind }) => ({ id, label, kind }));
    if (nodes.length < 2) return null;

    return {
        type: 'architecture',
        direction: 'TB',
        nodes,
        edges: inferEdges(nodes),
    };
}

function fallbackFromText(text: string, mermaidChart: string | null): ArchitectureDiagram | null {
    void mermaidChart;

    const inferredDiagram = inferArchitectureDiagramFromText(text);
    if (inferredDiagram) return inferredDiagram;

    const candidates = Array.from(text.matchAll(/\b(Client|Web App|Mobile App|API Gateway|Gateway|Load Balancer|Service|Redis|Cache|Kafka|Queue|Database|Postgres|MongoDB|Object Storage|Storage|CDN|External API)\b/gi))
        .map((match) => match[0]);

    const uniqueCandidates = Array.from(new Set(candidates));
    if (uniqueCandidates.length < 2) return null;
    return createLinearFallbackDiagram(uniqueCandidates);
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
            const inferredDiagram = state === 'loading' ? null : inferArchitectureDiagramFromText(markdown);
            return {
                markdown,
                state: inferredDiagram ? 'ready' : state,
                diagram: inferredDiagram,
                mermaidChart,
                fallbackDiagram: fallbackFromText(markdown, mermaidChart),
                issues: inferredDiagram ? [parsed.error, 'architecture_inferred_from_prose'] : [parsed.error],
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
        const markdownBefore = text.slice(0, labelMatch.index).replace(/\n{3,}/g, '\n\n').trim();
        if (!balanced) {
            return {
                markdown: options.isStreaming ? markdownBefore : text.replace(/architecture_json\s*:?\s*$/i, '').trim(),
                state: options.isStreaming ? 'loading' : 'missing',
                diagram: null,
                mermaidChart,
                fallbackDiagram: mermaidChart ? fallbackFromText(text, mermaidChart) : null,
                issues: ['architecture_json_missing_body'],
            };
        }

        if (!balanced.complete && options.isStreaming) {
            return {
                markdown: markdownBefore,
                state: 'loading',
                diagram: null,
                mermaidChart,
                fallbackDiagram: fallbackFromText(markdownBefore, mermaidChart),
                issues: ['architecture_json_streaming'],
            };
        }

        const markdownAfter = text.slice(balanced.end).replace(/\n{3,}/g, '\n\n').trim();
        const preservedMarkdown = [markdownBefore, markdownAfter].filter(Boolean).join('\n\n').trim();
        const parsed = safeJsonParse(balanced.raw);
        if (!parsed.ok) {
            const inferredDiagram = inferArchitectureDiagramFromText(preservedMarkdown || text);
            return {
                markdown: preservedMarkdown || text,
                state: inferredDiagram ? 'ready' : 'invalid',
                diagram: inferredDiagram,
                mermaidChart,
                fallbackDiagram: fallbackFromText(preservedMarkdown || text, mermaidChart),
                issues: inferredDiagram ? [parsed.error, 'architecture_inferred_from_prose'] : [parsed.error],
            };
        }

        const validation = validateArchitecturePayload(parsed.value);
        return {
            markdown: preservedMarkdown,
            state: validation.valid ? 'ready' : 'invalid',
            diagram: validation.diagram,
            mermaidChart,
            fallbackDiagram: fallbackFromText(preservedMarkdown, mermaidChart),
            issues: validation.issues,
        };
    }

    const markdown = stripMermaidBlocks(text);
    const inferredDiagram = inferArchitectureDiagramFromText(markdown);

    return {
        markdown,
        state: inferredDiagram ? 'ready' : 'missing',
        diagram: inferredDiagram,
        mermaidChart,
        fallbackDiagram: fallbackFromText(text, mermaidChart),
        issues: inferredDiagram ? ['architecture_inferred_from_prose'] : issues,
    };
}

export function looksLikeSystemDesignResponse(text: string): boolean {
    return /architecture_json/i.test(text)
        || Boolean(inferArchitectureDiagramFromText(text))
        || /\b(Architecture Diagram|Component Breakdown|Scaling Strategy|Database Design|High-Level Design|Low-Level Design|system design)\b/i.test(text);
}
