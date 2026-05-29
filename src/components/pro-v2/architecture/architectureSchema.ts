export const ARCHITECTURE_NODE_KINDS = [
    'client',
    'gateway',
    'service',
    'database',
    'cache',
    'queue',
    'storage',
    'external',
] as const;

export type ArchitectureNodeKind = (typeof ARCHITECTURE_NODE_KINDS)[number];
export type ArchitectureDirection = 'TB' | 'BT' | 'LR' | 'RL';

export interface ArchitectureNodeModel {
    id: string;
    label: string;
    kind: ArchitectureNodeKind;
    technology?: string;
    purpose?: string;
    layer?: string;
    latency?: string;
    failureMode?: string;
}

export interface ArchitectureEdgeModel {
    source: string;
    target: string;
    label?: string;
    protocol?: string;
    latency?: string;
}

export interface ArchitectureDiagram {
    type: 'architecture';
    direction: ArchitectureDirection;
    nodes: ArchitectureNodeModel[];
    edges: ArchitectureEdgeModel[];
}

export interface ArchitectureValidationResult {
    valid: boolean;
    diagram: ArchitectureDiagram | null;
    issues: string[];
}

const KIND_SET = new Set<string>(ARCHITECTURE_NODE_KINDS);
const DIRECTION_SET = new Set<string>(['TB', 'BT', 'LR', 'RL']);

function cleanText(value: unknown, fallback = ''): string {
    if (typeof value !== 'string') return fallback;
    return value.replace(/\s+/g, ' ').trim();
}

function cleanId(value: unknown, fallback: string): string {
    const raw = cleanText(value, fallback)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return raw || fallback;
}

function coerceKind(value: unknown, label: string): ArchitectureNodeKind {
    const normalized = cleanText(value).toLowerCase();
    if (KIND_SET.has(normalized)) return normalized as ArchitectureNodeKind;

    const l = label.toLowerCase();
    if (/\b(client|mobile|web|browser|user|app)\b/.test(l)) return 'client';
    if (/\b(gateway|load balancer|lb|edge|ingress|api)\b/.test(l)) return 'gateway';
    if (/\b(redis|cache|memcache)\b/.test(l)) return 'cache';
    if (/\b(kafka|queue|pubsub|pub\/sub|sqs|rabbit)\b/.test(l)) return 'queue';
    if (/\b(db|database|postgres|mysql|mongo|dynamo|cassandra)\b/.test(l)) return 'database';
    if (/\b(s3|blob|object storage|cdn|storage)\b/.test(l)) return 'storage';
    if (/\b(third party|external|partner|payment|maps|email|sms)\b/.test(l)) return 'external';
    return 'service';
}

function unwrapPayload(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (record.diagram) return record.diagram;
    if (record.architecture_json && typeof record.architecture_json === 'object') {
        return (record.architecture_json as Record<string, unknown>).diagram ?? record.architecture_json;
    }
    return value;
}

export function validateArchitecturePayload(value: unknown): ArchitectureValidationResult {
    const issues: string[] = [];
    const diagramValue = unwrapPayload(value);

    if (!diagramValue || typeof diagramValue !== 'object') {
        return { valid: false, diagram: null, issues: ['architecture_json_not_object'] };
    }

    const input = diagramValue as Record<string, unknown>;
    const rawNodes = Array.isArray(input.nodes) ? input.nodes : [];
    const rawEdges = Array.isArray(input.edges) ? input.edges : [];

    if (rawNodes.length === 0) issues.push('architecture_nodes_missing');
    if (rawNodes.length > 60) issues.push('architecture_nodes_truncated');

    const nodes: ArchitectureNodeModel[] = [];
    const seen = new Set<string>();

    rawNodes.slice(0, 60).forEach((rawNode, index) => {
        if (!rawNode || typeof rawNode !== 'object') {
            issues.push(`node_${index}_invalid`);
            return;
        }

        const node = rawNode as Record<string, unknown>;
        const label = cleanText(node.label, `Service ${index + 1}`).slice(0, 64);
        let id = cleanId(node.id, cleanId(label, `node-${index + 1}`));
        if (seen.has(id)) id = `${id}-${index + 1}`;
        seen.add(id);

        const nodeModel: ArchitectureNodeModel = {
            id,
            label,
            kind: coerceKind(node.kind, label),
        };

        const technology = cleanText(node.technology);
        if (technology) nodeModel.technology = technology.slice(0, 80);
        const purpose = cleanText(node.purpose);
        if (purpose) nodeModel.purpose = purpose.slice(0, 120);
        const layer = cleanText(node.layer);
        if (layer) nodeModel.layer = layer.slice(0, 40);
        const latency = cleanText(node.latency);
        if (latency) nodeModel.latency = latency.slice(0, 24);
        const failureMode = cleanText(node.failureMode);
        if (failureMode) nodeModel.failureMode = failureMode.slice(0, 120);

        nodes.push(nodeModel);
    });

    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges: ArchitectureEdgeModel[] = [];

    rawEdges.slice(0, 90).forEach((rawEdge, index) => {
        if (!rawEdge || typeof rawEdge !== 'object') {
            issues.push(`edge_${index}_invalid`);
            return;
        }

        const edge = rawEdge as Record<string, unknown>;
        const source = cleanId(edge.source, '');
        const target = cleanId(edge.target, '');
        if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) {
            issues.push(`edge_${index}_unknown_endpoint`);
            return;
        }
        if (source === target) {
            issues.push(`edge_${index}_self_loop`);
            return;
        }

        const label = cleanText(edge.label).slice(0, 36);
        const edgeModel: ArchitectureEdgeModel = { source, target };
        if (label) edgeModel.label = label;
        const protocol = cleanText(edge.protocol);
        if (protocol) edgeModel.protocol = protocol.slice(0, 32);
        const latency = cleanText(edge.latency);
        if (latency) edgeModel.latency = latency.slice(0, 24);
        edges.push(edgeModel);
    });

    if (nodes.length >= 2 && edges.length === 0) {
        for (let i = 0; i < nodes.length - 1; i += 1) {
            edges.push({ source: nodes[i].id, target: nodes[i + 1].id });
        }
        issues.push('architecture_edges_inferred');
    }

    const rawDirection = cleanText(input.direction, 'TB').toUpperCase();
    const direction = DIRECTION_SET.has(rawDirection) ? rawDirection as ArchitectureDirection : 'TB';

    const valid = nodes.length > 0;
    return {
        valid,
        diagram: valid
            ? {
                type: 'architecture',
                direction,
                nodes,
                edges,
            }
            : null,
        issues,
    };
}

export function createLinearFallbackDiagram(labels: string[]): ArchitectureDiagram {
    const cleanLabels = labels.map((label) => cleanText(label)).filter(Boolean);
    const finalLabels = cleanLabels.length > 0
        ? cleanLabels.slice(0, 8)
        : ['Client', 'API Gateway', 'Core Service', 'Data Store'];

    const nodes = finalLabels.map((label, index) => ({
        id: cleanId(label, `node-${index + 1}`),
        label,
        kind: coerceKind(undefined, label),
    }));

    return {
        type: 'architecture',
        direction: 'TB',
        nodes,
        edges: nodes.slice(0, -1).map((node, index) => ({
            source: node.id,
            target: nodes[index + 1].id,
        })),
    };
}
