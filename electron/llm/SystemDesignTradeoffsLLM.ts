import { LLMHelper } from "../LLMHelper";
import { SYSTEM_DESIGN_TRADEOFFS_PROMPT } from "./prompts";

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
}
