import { LLMHelper } from "../LLMHelper";
import { SYSTEM_DESIGN_TRADEOFFS_PROMPT } from "./prompts";

const STRICT_ARCHITECTURE_JSON_REPAIR_PROMPT = `
You repair system design answers.
Return only the corrected final answer.
Use concise markdown.
Every answer must include exactly one fenced \`\`\`architecture_json block.
The block must contain valid JSON only.
MINIMUM 12 nodes. Simple systems need 12+ nodes, medium production systems need 20+ nodes, FAANG-scale systems need 35-60+ nodes.
Never generate generic Frontend → Backend → Database diagrams.
Each node requires id, label, kind and should include technology, purpose, layer, latency, failureMode.
Each edge requires source, target and should include label, protocol, latency.
Include client, edge/gateway, core services, async, data, cache, storage, observability, and security layers.
Allowed node kinds: client, gateway, service, database, cache, queue, storage, external.
Do not use Mermaid.
Required JSON shape:
\`\`\`architecture_json
{"diagram":{"type":"architecture","direction":"TB","nodes":[{"id":"mobile","label":"Mobile Client","kind":"client","technology":"React Native","purpose":"User interface","layer":"client"},{"id":"web","label":"Web Client","kind":"client","technology":"React SPA","purpose":"Browser interface","layer":"client"},{"id":"cdn","label":"CDN","kind":"storage","technology":"CloudFront","purpose":"Static/media edge cache","layer":"edge"},{"id":"waf","label":"WAF","kind":"gateway","technology":"AWS WAF","purpose":"Abuse filtering","layer":"security"},{"id":"lb","label":"Load Balancer","kind":"gateway","technology":"AWS ALB","purpose":"TLS and health checks","layer":"edge"},{"id":"gateway","label":"API Gateway","kind":"gateway","technology":"Kong + Envoy","purpose":"Auth, routing, rate limits","layer":"gateway"},{"id":"auth","label":"Auth Service","kind":"service","technology":"Go + OAuth2","purpose":"Identity validation","layer":"security"},{"id":"core","label":"Core Service","kind":"service","technology":"Java + gRPC","purpose":"Business orchestration","layer":"core_services"},{"id":"worker","label":"Async Workers","kind":"service","technology":"Python Celery","purpose":"Background jobs","layer":"async"},{"id":"redis","label":"Hot Cache","kind":"cache","technology":"Redis Cluster","purpose":"Sessions and hot reads","layer":"cache"},{"id":"kafka","label":"Event Bus","kind":"queue","technology":"Apache Kafka","purpose":"Async fanout","layer":"async"},{"id":"primary-db","label":"Primary Database","kind":"database","technology":"PostgreSQL","purpose":"Transactional source of truth","layer":"data"}],"edges":[{"source":"mobile","target":"waf","label":"API calls","protocol":"HTTPS"},{"source":"web","target":"cdn","label":"assets","protocol":"HTTPS"},{"source":"web","target":"waf","label":"API calls","protocol":"HTTPS"},{"source":"waf","target":"lb","label":"clean traffic","protocol":"HTTPS"},{"source":"lb","target":"gateway","label":"routes","protocol":"HTTP/2"},{"source":"gateway","target":"auth","label":"verify token","protocol":"gRPC"},{"source":"gateway","target":"core","label":"business calls","protocol":"gRPC"},{"source":"core","target":"redis","label":"cache","protocol":"Redis"},{"source":"core","target":"primary-db","label":"persist","protocol":"SQL"},{"source":"core","target":"kafka","label":"events","protocol":"Kafka"},{"source":"kafka","target":"worker","label":"jobs","protocol":"Kafka consumer"}]}}
\`\`\`
`.trim();

export class SystemDesignTradeoffsLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    async *generateStream(context: string): AsyncGenerator<string> {
        if (!context.trim()) return;
        try {
            yield* this.llmHelper.streamChat(context, undefined, undefined, SYSTEM_DESIGN_TRADEOFFS_PROMPT);
        } catch (error) {
            console.error("[SystemDesignTradeoffsLLM] Stream failed:", error);
            yield "The main trade-off is complexity versus scale. I'd keep the design simple early, then add caching, async processing, and stronger fault tolerance once traffic justifies the extra operational cost.";
        }
    }

    async repairWithStrictArchitectureJson(context: string, invalidDraft: string, repairInstruction: string): Promise<string> {
        const compactContext = compactText(context, 2200);
        const compactDraft = compactText(invalidDraft, 2600);
        const message = [
            repairInstruction,
            '',
            'Context:',
            compactContext,
            '',
            'Invalid draft excerpt:',
            compactDraft,
        ].join('\n');
        return this.llmHelper.chat(message, undefined, undefined, STRICT_ARCHITECTURE_JSON_REPAIR_PROMPT);
    }
}

function compactText(text: string, maxChars: number): string {
    const trimmed = text.trim();
    if (trimmed.length <= maxChars) return trimmed;
    const head = trimmed.slice(0, Math.floor(maxChars * 0.58));
    const tail = trimmed.slice(-Math.floor(maxChars * 0.32));
    return `${head}\n\n[...truncated...]\n\n${tail}`;
}
