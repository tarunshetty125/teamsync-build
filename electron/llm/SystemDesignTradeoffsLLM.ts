import { LLMHelper } from "../LLMHelper";
import { SYSTEM_DESIGN_TRADEOFFS_PROMPT } from "./prompts";

const STRICT_ARCHITECTURE_JSON_REPAIR_PROMPT = `
You repair system design answers.
Return only the corrected final answer.
Use concise markdown.
Every answer must include exactly one fenced \`\`\`architecture_json block.
The block must contain valid JSON only.
Allowed node kinds: client, gateway, service, database, cache, queue, storage, external.
Allowed edge fields: source, target, label.
Do not use Mermaid.
Required JSON shape:
\`\`\`architecture_json
{"diagram":{"type":"architecture","direction":"TB","nodes":[{"id":"client","label":"Client App","kind":"client"},{"id":"gateway","label":"API Gateway","kind":"gateway"},{"id":"service","label":"Core Service","kind":"service"},{"id":"db","label":"Primary Database","kind":"database"}],"edges":[{"source":"client","target":"gateway","label":"requests"},{"source":"gateway","target":"service","label":"routes"},{"source":"service","target":"db","label":"reads/writes"}]}}
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
