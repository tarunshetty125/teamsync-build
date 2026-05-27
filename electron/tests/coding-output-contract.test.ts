import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { buildIntentPrompt } from '../ActionContextBuilder';
import * as outputValidator from '../ActionOutputValidator';

test('coding clarify prompt keeps full fenced code contract', () => {
    const instructions = buildIntentPrompt(
        'clarify',
        'coding',
        undefined,
        'reverse linked list',
        false,
    );

    const contract = instructions.find((instruction) => instruction.key === 'output_contract');
    assert.ok(contract, 'output contract should exist');
    assert.match(contract!.content, /FULL working code in a fenced markdown block/i);
    assert.match(contract!.content, /Focus the explanation on time\/space complexity/i);
});

test('coding code_hint prompt still requires executable fenced code', () => {
    const instructions = buildIntentPrompt(
        'code_hint',
        'coding',
        undefined,
        'binary tree traversal in java',
        false,
    );

    const contract = instructions.find((instruction) => instruction.key === 'output_contract');
    assert.ok(contract, 'output contract should exist');
    assert.match(contract!.content, /FULL working code in a fenced markdown block/i);
    assert.match(contract!.content, /single most important hint or invariant/i);
});

test('coding clarify output without fenced code is rejected for repair', () => {
    const result = outputValidator.validateActionOutput(
        'clarify',
        'coding',
        '**Problem:** Reverse a linked list.\n**Complexity:** O\\(n\\) time and O\\(1\\) space.',
        'reverse linked list',
    );

    assert.equal(result.valid, false);
    assert.deepEqual(result.issues, ['coding_missing_code_block']);
});
