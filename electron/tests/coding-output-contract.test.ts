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

test('manual coding prompt defaults to Python when no language is requested', () => {
    const instructions = buildIntentPrompt(
        'manual_chat',
        'coding',
        undefined,
        'implement dijkstra algorithm',
        false,
    );

    const contract = instructions.find((instruction) => instruction.key === 'output_contract');
    assert.ok(contract, 'output contract should exist');
    assert.match(contract!.content, /default to Python/i);
    assert.match(contract!.content, /Do not infer the programming language from older transcript/i);
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

test('coding output rejects malformed C# with unbalanced delimiters for repair', () => {
    const result = outputValidator.validateActionOutput(
        'manual_chat',
        'coding',
        [
            'Solution:*',
            '``csharp using System;',
            'class Program { static void Main() {',
            'int limit = Convert.ToInt32(Console.ReadLine();',
            'var boundary = (int)Math.Floor(Math.Sqrt(limit);',
            '} }',
            '``',
        ].join('\n'),
        'print prime numbers in csharp',
    );

    assert.equal(result.valid, false);
    assert.equal(result.autoCorrected, true);
    assert.deepEqual(result.issues, ['coding_unbalanced_delimiters']);
    assert.match(result.correctedContent, /```csharp\s+using System;/);
});

test('general output with malformed code fence rejects unbalanced code for repair', () => {
    const result = outputValidator.validateActionOutput(
        'what_to_answer',
        'general',
        'Solution: ``javascript function test() { if (true) { console.log("x"); }\n``',
        'some coding title missed detection',
    );

    assert.equal(result.valid, false);
    assert.deepEqual(result.issues, ['coding_unbalanced_delimiters']);
});

test('coding output rejects typo-filled C# that would not compile', () => {
    const result = outputValidator.validateActionOutput(
        'manual_chat',
        'coding',
        [
            '**Solution:**',
            '``csharp',
            'using System;',
            'using System.Colections.Generic;',
            'public clas Dijkstra',
            '{',
            '  private static void PrintDistance(int[] distance)',
            '  {',
            '    for (int i = 0; i < distance.Length; i+)',
            '    {',
            '      Console.WriteLine(i + "\\t" + distance[i]);',
            '    }',
            '  }',
            '}',
            '``',
        ].join('\n'),
        'dijkstra in c sharp',
    );

    assert.equal(result.valid, false);
    assert.equal(result.autoCorrected, true);
    assert.deepEqual(result.issues, ['coding_likely_compile_error']);
    assert.match(result.correctedContent, /```csharp\s+using System;/);
});

test('coding output rejects inconsistent C# rectangular array initializer', () => {
    const result = outputValidator.validateActionOutput(
        'manual_chat',
        'coding',
        [
            '```csharp',
            'class Program {',
            '  static void Main() {',
            '    int[,] graph = { { 0, 4, 0 }, { 4, 0, 8, 0 }, { 0, 8, 0 } };',
            '  }',
            '}',
            '```',
        ].join('\n'),
        'dijkstra in c sharp',
    );

    assert.equal(result.valid, false);
    assert.deepEqual(result.issues, ['coding_likely_compile_error']);
});

test('manual Dijkstra output without requested language rejects leaked broken C#', () => {
    const result = outputValidator.validateActionOutput(
        'manual_chat',
        'general',
        [
            '**Problem:**',
            "The problem requires implementing Dijkstra's algorithm.",
            '**Approach:**',
            '* Use a priority queue.',
            '**Complexity:*',
            '* Time complexity: O(V + E) log V).',
            '**Solution:**',
            '``csharp',
            'using System;',
            'using System.Collections.Generic;',
            'public class Dijkstra',
            '{',
            '   public static void ShortestPath(int[,] graph, int source)',
            '   {',
            '      int rows = graph.GetLength(0);',
            '      int[] distance = new int[rows];',
            '      bool[] visited = new bool[rows];',
            '      for (int i = 0; i < rows; i+)',
            '      {',
            '         distance[i] = int.MaxValue;',
            '      }',
            '   }',
            '   private static int MinDistance(int[] distance, bol[] visited)',
            '   {',
            '      return -1;',
            '   }',
            '}',
            '`` ',
        ].join('\n'),
        'implement dijkstra algorithm',
    );

    assert.equal(result.valid, false);
    assert.equal(result.autoCorrected, true);
    assert.deepEqual(result.issues, ['coding_likely_compile_error']);
    assert.match(result.correctedContent, /```csharp\s+using System;/);
});

test('manual Dijkstra output rejects collapsed invalid Python solution', () => {
    const result = outputValidator.validateActionOutput(
        'manual_chat',
        'coding',
        [
            'Solution: ``python import sys import heapq',
            '',
            'def dijkstra(graph, source): distances = {node: sys.maxsize for node in graph} distances[source] = 0 priority_queue = [(0, source)] while priority_queue: current_distance, current_node = heapq.heapop(priority_queue)',
            '',
            'if current_distance > distances[current_node]: continue',
            '',
            'for neighbor, weight in graph[current_node].items(): distance = current_distance + weight',
            '',
            'if distance < distances[neighbor]: distances[neighbor] = distance heapq.heappush(priority_queue, (distance, neighbor)) return distances',
            '',
            'Example usage:',
            "graph = { 'A': {'B': 1, 'C': 4}, 'B': {'A': 1, 'C': 2, 'D': 5} }",
            '',
            "source_node = 'A' distances = dijkstra(graph, source_node) print(distances)",
            '``',
        ].join('\n'),
        'implement dijkstra algorithm',
    );

    assert.equal(result.valid, false);
    assert.equal(result.autoCorrected, true);
    assert.deepEqual(result.issues, ['coding_likely_compile_error']);
    assert.match(result.correctedContent, /```python\s+import sys import heapq/);
});
