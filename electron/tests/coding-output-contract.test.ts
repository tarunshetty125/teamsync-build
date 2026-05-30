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
    assert.match(contract!.content, /FULL working code in one fenced markdown block/i);
    assert.match(contract!.content, /Focus the explanation on time\/space complexity/i);
    assert.match(contract!.content, /Never use two backticks/i);
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
    assert.match(contract!.content, /FULL working code in one fenced markdown block/i);
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

test('coding manual output repairs two-backtick C fence before rendering', () => {
    const result = outputValidator.validateActionOutput(
        'manual_chat',
        'coding',
        [
            'Problem: Implement merge sort in C.',
            '*Approach:',
            '- Divide and merge sorted halves.',
            '*Complexity:',
            'O(n log n) time, O(n) space.',
            'Solution:* ``c #include <stdio.h>',
            'int main(void) { return 0; }',
            '``',
        ].join('\n'),
        'implement merge sort algorithm in c',
    );

    assert.equal(result.valid, true);
    assert.equal(result.autoCorrected, true);
    assert.match(result.correctedContent, /\*\*Solution:\*\*\n```c\n#include <stdio.h>/);
    assert.match(result.correctedContent, /\n```\s*$/);
});

test('coding transcript output repairs code on same opening fence line', () => {
    const result = outputValidator.validateActionOutput(
        'what_to_answer',
        'coding',
        [
            '**Problem:** Add two numbers.',
            '**Solution:**',
            '```c int add(int a, int b) { return a + b; }',
            '```',
        ].join('\n'),
        'write a C function to add two numbers',
    );

    assert.equal(result.valid, true);
    assert.equal(result.autoCorrected, true);
    assert.match(result.correctedContent, /```c\nint add/);
});

test('coding output repairs inline two-backtick language fence after prose', () => {
    const result = outputValidator.validateActionOutput(
        'manual_chat',
        'coding',
        'Here is the solution: ``python def merge_sort(arr):\n    return arr\n``',
        'write me merge sort in python',
    );

    assert.equal(result.valid, true);
    assert.equal(result.autoCorrected, true);
    assert.match(result.correctedContent, /solution:\s*```python\ndef merge_sort/);
    assert.match(result.correctedContent, /\n```\s*$/);
});

test('coding screen scan output also repairs malformed two-backtick fences', () => {
    const result = outputValidator.validateActionOutput(
        'screen_scan',
        'coding',
        'Solution: ``java public class Main { public static void main(String[] args) {} }\n``',
        'visible coding problem',
    );

    assert.equal(result.valid, true);
    assert.equal(result.autoCorrected, true);
    assert.match(result.correctedContent, /```java\npublic class Main/);
});

test('coding output repairs common language aliases in malformed fences', () => {
    for (const [lang, snippet] of [
        ['js', 'function twoSum() { return []; }'],
        ['node.js', 'console.log("ok");'],
        ['c++', '#include <bits/stdc++.h>'],
        ['c#', 'public class Solution {}'],
        ['kotlin', 'fun main() {}'],
        ['rust', 'fn main() {}'],
    ] as Array<[string, string]>) {
        const result = outputValidator.validateActionOutput(
            'manual_chat',
            'coding',
            `Solution: \`\`${lang} ${snippet}\n\`\``,
            `solve in ${lang}`,
        );

        assert.equal(result.valid, true, lang);
        assert.equal(result.autoCorrected, true, lang);
        assert.match(result.correctedContent, new RegExp(`\`\`\`${lang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`), lang);
    }
});

test('general action output still repairs malformed code fences as a safety net', () => {
    const result = outputValidator.validateActionOutput(
        'what_to_answer',
        'general',
        'I would solve it with backtracking. Solution: ``c int main(void) { return 0; }\n``',
        'n queen',
    );

    assert.equal(result.valid, true);
    assert.equal(result.autoCorrected, true);
    assert.match(result.correctedContent, /```c\nint main/);
});
