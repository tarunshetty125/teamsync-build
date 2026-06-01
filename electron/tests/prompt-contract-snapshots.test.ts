import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    buildIntentPrompt,
    serializePromptObject,
    type PromptObject,
    type SessionActionMode,
    type UnifiedActionIntent,
} from '../ActionContextBuilder';
import { buildRepairInstruction } from '../ActionOutputValidator';
import { compileTinyPrompt } from '../intelligence/TinyPromptCompiler';
import {
    DEFAULT_PERSONALIZATION_PREFERENCES,
    type PreferredCodingLanguage,
} from '../../src/lib/personalization/preferences';
import type { ActionContract } from '../../src/lib/overlay/actionContextTypes';

function createPromptObject(args: {
    mode: SessionActionMode;
    intent: UnifiedActionIntent;
    question: string;
    actionContract?: ActionContract;
    preferredCodingLanguage?: PreferredCodingLanguage;
}): PromptObject {
    return {
        mode: args.mode,
        intent: args.intent,
        actionContract: args.actionContract,
        question: args.question,
        transcript: {
            title: 'TRANSCRIPT',
            content: `[INTERVIEWER]: ${args.question}`,
            strategy: 'rolling_window',
            approxTokens: Math.ceil(args.question.length / 4),
        },
        profile: null,
        supplemental: null,
        rag: null,
        instructions: buildIntentPrompt(
            args.intent,
            args.mode,
            undefined,
            args.question,
            false,
            args.actionContract,
            args.preferredCodingLanguage
                ? {
                    ...DEFAULT_PERSONALIZATION_PREFERENCES,
                    preferredCodingLanguage: args.preferredCodingLanguage,
                }
                : undefined,
        ),
    };
}

function outputContract(prompt: PromptObject): string {
    const contract = prompt.instructions.find((instruction) => instruction.key === 'output_contract');
    assert.ok(contract, 'output contract should exist');
    return contract.content;
}

async function compileOllamaTinyPrompt(prompt: PromptObject): Promise<string> {
    const result = await compileTinyPrompt({
        prompt,
        provider: 'ollama',
        currentModel: 'llama3.1',
        activeTemplateType: 'technical-interview',
    });

    assert.equal(result.applied, true);
    return serializePromptObject(result.prompt).systemPrompt;
}

function codingContractFor(question: string, preferredCodingLanguage?: PreferredCodingLanguage): string {
    return outputContract(createPromptObject({
        mode: 'coding',
        intent: 'manual_chat',
        question,
        preferredCodingLanguage,
    }));
}

test('Sprint 16 Phase C preserves tiny coding prompt contract obligations', async () => {
    const prompt = createPromptObject({
        mode: 'coding',
        intent: 'manual_chat',
        question: 'solve two sum',
    });

    const tinySystemPrompt = await compileOllamaTinyPrompt(prompt);

    assert.match(tinySystemPrompt, /OUTPUT/);
    assert.match(tinySystemPrompt, /Approach/);
    assert.match(tinySystemPrompt, /Complexity/);
    assert.match(tinySystemPrompt, /Pitfalls/);
    assert.match(tinySystemPrompt, /CONTRACT/);
    assert.match(tinySystemPrompt, /FULL working code in one fenced markdown block/i);
    assert.match(tinySystemPrompt, /Required solution language for this prompt: JavaScript/i);
    assert.match(tinySystemPrompt, /Use exactly this fence shape: opening line ```javascript/i);
    assert.match(tinySystemPrompt, /time and space complexity/i);
    assert.match(tinySystemPrompt, /Full code is explicitly required by the active output contract/i);
    assert.doesNotMatch(tinySystemPrompt, /Avoid full code unless explicitly needed/i);
});

test('Sprint 16 Phase C preserves tiny system-design prompt contract obligations', async () => {
    const prompt = createPromptObject({
        mode: 'system_design',
        intent: 'manual_chat',
        question: 'Design WhatsApp',
    });

    const tinySystemPrompt = await compileOllamaTinyPrompt(prompt);

    assert.match(tinySystemPrompt, /OUTPUT/);
    assert.match(tinySystemPrompt, /Approach/);
    assert.match(tinySystemPrompt, /Complexity/);
    assert.match(tinySystemPrompt, /Pitfalls/);
    assert.match(tinySystemPrompt, /CONTRACT/);
    assert.match(tinySystemPrompt, /architecture_json is mandatory/i);
    assert.match(tinySystemPrompt, /exactly one fenced ```architecture_json``` block/i);
    assert.match(tinySystemPrompt, /simple systems require 12\+ nodes/i);
    assert.match(tinySystemPrompt, /Nodes require id, label, kind/i);
    assert.match(tinySystemPrompt, /Edges require source and target/i);
    assert.match(tinySystemPrompt, /Do not output Mermaid/i);
});

test('Sprint 16 Phase D repair prompt uses JavaScript default language guidance', () => {
    const repair = buildRepairInstruction(
        'manual_chat',
        ['coding_missing_code_block'],
        'optimal_solution',
        'solve two sum',
    );

    assert.match(repair, /Required solution language for repair: JavaScript/i);
    assert.match(repair, /opening fence ```javascript on its own line/i);
    assert.match(repair, /complete runnable solution/i);
    assert.doesNotMatch(repair, /opening fence .*```python/i);
});

test('Sprint 16 Phase B snapshots system-design repair prompt contract', () => {
    const repair = buildRepairInstruction(
        'manual_chat',
        ['system_design_missing_fenced_architecture_json'],
        'optimal_solution',
    );

    assert.match(repair, /architecture_json/);
    assert.match(repair, /MINIMUM 12 nodes required/i);
    assert.match(repair, /Do not use Mermaid/i);
    assert.doesNotMatch(repair, /```mermaid/i);
});

test('Sprint 16 Phase B snapshots current coding clarify full-solution contract', () => {
    const contract = outputContract(createPromptObject({
        mode: 'coding',
        intent: 'clarify',
        question: 'reverse linked list',
    }));

    assert.match(contract, /FULL working code in one fenced markdown block/i);
    assert.match(contract, /Focus the explanation on time\/space complexity/i);
    assert.match(contract, /Keep the full code block present/i);
    assert.doesNotMatch(contract, /Return exactly one clarifying question/i);
});

test('Sprint 16 Phase B snapshots current system-design tradeoff bullet contract', () => {
    const contract = outputContract(createPromptObject({
        mode: 'system_design',
        intent: 'system_design_tradeoffs',
        question: 'Design WhatsApp tradeoffs',
    }));

    assert.match(contract, /Return 3 to 5 concise bullets/i);
    assert.match(contract, /Each bullet must identify a concrete tradeoff/i);
    assert.match(contract, /Bias toward architecture, scale, reliability, and operational cost/i);
    assert.doesNotMatch(contract, /architecture_json/);
});

test('Sprint 16 Phase B snapshots coding language resolution defaults and precedence', () => {
    const defaultJavaScript = codingContractFor('solve two sum');
    assert.match(defaultJavaScript, /Required solution language for this prompt: JavaScript/i);
    assert.match(defaultJavaScript, /opening line ```javascript/i);
    assert.doesNotMatch(defaultJavaScript, /opening line ```python/i);

    const explicitJava = codingContractFor('solve two sum in Java');
    assert.match(explicitJava, /Required solution language for this prompt: Java\b/i);
    assert.match(explicitJava, /opening line ```java/i);
    assert.doesNotMatch(explicitJava, /opening line ```javascript/i);

    const explicitPython = codingContractFor('solve two sum in Python');
    assert.match(explicitPython, /Required solution language for this prompt: Python/i);
    assert.match(explicitPython, /opening line ```python/i);
    assert.doesNotMatch(explicitPython, /opening line ```javascript/i);

    const preferredTypeScript = codingContractFor('solve two sum', 'typescript');
    assert.match(preferredTypeScript, /Required solution language for this prompt: TypeScript/i);
    assert.match(preferredTypeScript, /from the user preferred coding language setting/i);
    assert.match(preferredTypeScript, /opening line ```typescript/i);
    assert.doesNotMatch(preferredTypeScript, /opening line ```javascript/i);

    const explicitGoOverPreference = codingContractFor('solve two sum in Go', 'python');
    assert.match(explicitGoOverPreference, /Required solution language for this prompt: Go/i);
    assert.match(explicitGoOverPreference, /opening line ```go/i);
    assert.doesNotMatch(explicitGoOverPreference, /opening line ```python/i);
});

test('Sprint 16 Phase D repair prompt language guidance follows contract resolution precedence', () => {
    const explicitJava = buildRepairInstruction(
        'manual_chat',
        ['coding_missing_code_block'],
        'optimal_solution',
        'solve two sum in Java',
    );
    assert.match(explicitJava, /Required solution language for repair: Java\b/i);
    assert.match(explicitJava, /opening fence ```java on its own line/i);
    assert.doesNotMatch(explicitJava, /opening fence ```javascript/i);

    const explicitPython = buildRepairInstruction(
        'manual_chat',
        ['coding_missing_code_block'],
        'optimal_solution',
        'solve two sum in Python',
    );
    assert.match(explicitPython, /Required solution language for repair: Python/i);
    assert.match(explicitPython, /opening fence ```python on its own line/i);
    assert.doesNotMatch(explicitPython, /opening fence ```javascript/i);

    const preferredTypeScript = buildRepairInstruction(
        'manual_chat',
        ['coding_missing_code_block'],
        'optimal_solution',
        'solve two sum',
        'TypeScript',
    );
    assert.match(preferredTypeScript, /Required solution language for repair: TypeScript/i);
    assert.match(preferredTypeScript, /user preferred coding language setting/i);
    assert.match(preferredTypeScript, /opening fence ```typescript on its own line/i);
    assert.doesNotMatch(preferredTypeScript, /opening fence ```javascript/i);

    const explicitGoOverPreference = buildRepairInstruction(
        'manual_chat',
        ['coding_missing_code_block'],
        'optimal_solution',
        'solve two sum in Go',
        'Python',
    );
    assert.match(explicitGoOverPreference, /Required solution language for repair: Go/i);
    assert.match(explicitGoOverPreference, /opening fence ```go on its own line/i);
    assert.doesNotMatch(explicitGoOverPreference, /opening fence ```python/i);
});

test('Sprint 16 Phase D repair prompt language guidance is deterministic', () => {
    const first = buildRepairInstruction(
        'manual_chat',
        ['coding_missing_code_block'],
        'optimal_solution',
        'solve two sum',
        'TypeScript',
    );
    const second = buildRepairInstruction(
        'manual_chat',
        ['coding_missing_code_block'],
        'optimal_solution',
        'solve two sum',
        'TypeScript',
    );

    assert.equal(first, second);
});

test('Sprint 16 Phase C tiny prompt compression is deterministic', async () => {
    const prompt = createPromptObject({
        mode: 'coding',
        intent: 'manual_chat',
        question: 'solve two sum in TypeScript',
    });

    const first = await compileOllamaTinyPrompt(prompt);
    const second = await compileOllamaTinyPrompt(prompt);

    assert.equal(first, second);
    assert.match(first, /Required solution language for this prompt: TypeScript/i);
    assert.match(first, /opening line ```typescript/i);
});

test('Sprint 16 Phase C preserves restrictive ActionContract authority in tiny prompts', async () => {
    const prompt = createPromptObject({
        mode: 'coding',
        intent: 'code_hint',
        question: 'two sum',
        actionContract: 'hint_only',
    });

    const tinySystemPrompt = await compileOllamaTinyPrompt(prompt);

    assert.match(tinySystemPrompt, /CONTRACT/);
    assert.match(tinySystemPrompt, /return hints only/i);
    assert.match(tinySystemPrompt, /no full solution/i);
    assert.match(tinySystemPrompt, /no Solution section/i);
    assert.match(tinySystemPrompt, /no fenced code/i);
    assert.doesNotMatch(tinySystemPrompt, /FULL working code in one fenced markdown block/i);
});
