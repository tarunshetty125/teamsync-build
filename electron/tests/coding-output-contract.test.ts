import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    buildIntentPrompt,
    getQuestionResponseProfile,
    resolveActionContractForResponseProfile,
} from '../ActionContextBuilder';
import * as outputValidator from '../ActionOutputValidator';
import { buildScreenScanQuestion } from '../llm/prompts';
import {
    DEFAULT_PERSONALIZATION_PREFERENCES,
    type PreferredCodingLanguage,
} from '../../src/lib/personalization/preferences';

function codingContractFor(question: string, preferredCodingLanguage?: PreferredCodingLanguage): string {
    const instructions = buildIntentPrompt(
        'manual_chat',
        'coding',
        undefined,
        question,
        false,
        undefined,
        preferredCodingLanguage
            ? { ...DEFAULT_PERSONALIZATION_PREFERENCES, preferredCodingLanguage }
            : undefined,
    );

    const contract = instructions.find((instruction) => instruction.key === 'output_contract');
    assert.ok(contract, 'output contract should exist');
    return contract!.content;
}

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

test('coding code_hint prompt resolves to hint-only contract', () => {
    const instructions = buildIntentPrompt(
        'code_hint',
        'coding',
        undefined,
        'binary tree traversal in java',
        false,
    );

    const contract = instructions.find((instruction) => instruction.key === 'output_contract');
    assert.ok(contract, 'output contract should exist');
    assert.match(contract!.content, /Return hints only/i);
    assert.match(contract!.content, /Do NOT provide a full solution/i);
    assert.doesNotMatch(contract!.content, /FULL working code in one fenced markdown block/i);
});

test('manual coding prompt defaults to JavaScript when no language is requested', () => {
    const contract = codingContractFor('solve two sum');

    assert.match(contract, /Required solution language for this prompt: JavaScript/i);
    assert.match(contract, /opening line ```javascript/i);
    assert.doesNotMatch(contract, /default to Python/i);
    assert.match(contract, /Do not infer the programming language from older transcript/i);
});

test('manual coding prompt uses explicit Java request over JavaScript default', () => {
    const contract = codingContractFor('solve two sum in Java');

    assert.match(contract, /Required solution language for this prompt: Java\b/i);
    assert.match(contract, /opening line ```java/i);
    assert.doesNotMatch(contract, /opening line ```javascript/i);
});

test('manual coding prompt uses explicit Python request over JavaScript default', () => {
    const contract = codingContractFor('solve two sum in Python');

    assert.match(contract, /Required solution language for this prompt: Python/i);
    assert.match(contract, /opening line ```python/i);
    assert.doesNotMatch(contract, /opening line ```javascript/i);
});

test('manual coding prompt uses preferred language when no language is requested', () => {
    const contract = codingContractFor('solve two sum', 'typescript');

    assert.match(contract, /Required solution language for this prompt: TypeScript/i);
    assert.match(contract, /from the user preferred coding language setting/i);
    assert.match(contract, /opening line ```typescript/i);
    assert.doesNotMatch(contract, /opening line ```javascript/i);
});

test('manual coding prompt keeps explicit language above preferred language', () => {
    const contract = codingContractFor('solve two sum in Go', 'python');

    assert.match(contract, /Required solution language for this prompt: Go/i);
    assert.match(contract, /opening line ```go/i);
    assert.doesNotMatch(contract, /opening line ```python/i);
});

test('manual coding input resolves to optimal solution contract', () => {
    const profile = getQuestionResponseProfile('solve two sum', 'general', 'manual_chat');
    const contract = resolveActionContractForResponseProfile({
        intent: 'manual_chat',
        responseProfile: profile,
    });

    assert.equal(profile, 'coding');
    assert.equal(contract, 'optimal_solution');
});

test('manual coding validation receives optimal solution contract', () => {
    const profile = getQuestionResponseProfile('solve two sum', 'general', 'manual_chat');
    const contract = resolveActionContractForResponseProfile({
        intent: 'manual_chat',
        responseProfile: profile,
    });
    const content = [
        '**Problem:**',
        'Return indices of two numbers that add up to the target.',
        '**Approach:**',
        '- Use a hash map from value to index.',
        '- For each number, check whether its complement was seen.',
        '**Complexity:**',
        'Time: O(n), because each number is visited once.',
        'Space: O(n), for the hash map.',
        '**Solution:**',
        '```javascript',
        'function twoSum(nums, target) {',
        '  const seen = new Map();',
        '  for (let i = 0; i < nums.length; i++) {',
        '    const need = target - nums[i];',
        '    if (seen.has(need)) return [seen.get(need), i];',
        '    seen.set(nums[i], i);',
        '  }',
        '  return [];',
        '}',
        '```',
    ].join('\n');

    const result = outputValidator.validateActionOutput(
        'manual_chat',
        'general',
        content,
        'solve two sum',
        contract,
    );

    assert.equal(contract, 'optimal_solution');
    assert.equal(result.valid, true);
});

test('manual coding fallback uses coding-specific contract fallback', () => {
    const fallback = outputValidator.buildSafeActionFallback(
        'manual_chat',
        'general',
        'solve two sum',
        'optimal_solution',
    );

    assert.match(fallback, /contract-compliant coding solution/i);
    assert.match(fallback, /Problem, Approach, Complexity, and Solution/i);
    assert.doesNotMatch(fallback, /couldn't generate a reliable response/i);
});

test('normal manual chat remains without an action contract', () => {
    const profile = getQuestionResponseProfile('what is the capital of France', 'general', 'manual_chat');
    const contract = resolveActionContractForResponseProfile({
        intent: 'manual_chat',
        responseProfile: profile,
    });
    const fallback = outputValidator.buildSafeActionFallback(
        'manual_chat',
        'general',
        'what is the capital of France',
        contract,
    );

    assert.notEqual(profile, 'coding');
    assert.equal(contract, undefined);
    assert.match(fallback, /couldn't generate a reliable response/i);
});

test('manual chat fallback does not leak interview evidence template for greetings', () => {
    const fallback = outputValidator.buildSafeActionFallback(
        'manual_chat',
        'general',
        'hello who are you',
    );

    assert.match(fallback, /TeamSync Intelligence/);
    assert.doesNotMatch(fallback, /strongest available evidence/i);
    assert.doesNotMatch(fallback, /^I would answer/i);
});

test('coding full-solution fallback is explicit instead of pretending to satisfy the contract', () => {
    const fallback = outputValidator.buildSafeActionFallback(
        'what_to_answer',
        'coding',
        'two sum',
        'optimal_solution',
    );

    assert.match(fallback, /could not generate a contract-compliant coding solution/i);
    assert.doesNotMatch(fallback, /^I would answer/i);
});

test('coding hint fallback remains hint-only', () => {
    const fallback = outputValidator.buildSafeActionFallback(
        'code_hint',
        'coding',
        'two sum',
        'hint_only',
    );

    assert.match(fallback, /invariant/i);
    assert.doesNotMatch(fallback, /```/);
    assert.doesNotMatch(fallback, /Solution:/i);
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

test('coding clarify accepts the existing full fenced-code contract', () => {
    const result = outputValidator.validateActionOutput(
        'clarify',
        'coding',
        [
            '**Problem:**',
            'Reverse a singly linked list.',
            '',
            '**Approach:**',
            '- Walk the list once.',
            '- Reverse each pointer as we go.',
            '- Return the previous pointer after traversal.',
            '',
            '**Complexity:**',
            'Time O(n), because each node is visited once. Space O(1), because reversal is in place.',
            '',
            '**Solution:**',
            '```javascript',
            'function reverseList(head) {',
            '  let prev = null;',
            '  let curr = head;',
            '  while (curr) {',
            '    const next = curr.next;',
            '    curr.next = prev;',
            '    prev = curr;',
            '    curr = next;',
            '  }',
            '  return prev;',
            '}',
            '```',
        ].join('\n'),
        'reverse linked list',
    );

    assert.equal(result.valid, true);
});

test('coding clarify repair prompt inherits the full-solution coding contract', () => {
    const repair = outputValidator.buildRepairInstruction(
        'clarify',
        ['coding_missing_code_block'],
        undefined,
        'reverse linked list',
    );

    assert.match(repair, /complete runnable solution/i);
    assert.match(repair, /Required solution language for repair: JavaScript/i);
    assert.match(repair, /opening fence ```javascript on its own line/i);
});

test('coding hint-only output accepts concise hints without code', () => {
    const result = outputValidator.validateActionOutput(
        'code_hint',
        'coding',
        [
            '- Track the last seen index for each value.',
            '- Before inserting the current value, check whether its complement was seen.',
            '- The invariant is that the map only contains earlier positions.',
        ].join('\n'),
        'two sum',
        'hint_only',
    );

    assert.equal(result.valid, true);
    assert.equal(result.correctedContent.includes('```'), false);
});

test('coding hint-only output rejects full code', () => {
    const result = outputValidator.validateActionOutput(
        'code_hint',
        'coding',
        [
            '**Solution:**',
            '```python',
            'def two_sum(nums, target):',
            '    return []',
            '```',
        ].join('\n'),
        'two sum',
        'hint_only',
    );

    assert.equal(result.valid, false);
    assert.ok(result.issues.includes('coding_hint_only_must_not_include_code_block'));
});

test('coding complexity-only output rejects implementation code', () => {
    const result = outputValidator.validateActionOutput(
        'clarify',
        'coding',
        [
            'Time: O(n). Space: O(n).',
            '```python',
            'def solve():',
            '    pass',
            '```',
        ].join('\n'),
        'analyze complexity',
        'complexity_only',
    );

    assert.equal(result.valid, false);
    assert.ok(result.issues.includes('coding_complexity_only_must_not_include_code_block'));
});

test('coding optimal solution accepts normal Python assignment before loop', () => {
    const result = outputValidator.validateActionOutput(
        'manual_chat',
        'coding',
        [
            '**Problem:**',
            'Find two indices whose values add to target.',
            '',
            '**Approach:**',
            '- Scan once.',
            '- Store previously seen values in a map.',
            '- Check each value against its complement.',
            '',
            '**Complexity:**',
            'Time O(n), because each item is processed once. Space O(n), because the map may store every value.',
            '',
            '**Solution:**',
            '```python',
            'def two_sum(nums, target):',
            '    seen = {}',
            '    for i, value in enumerate(nums):',
            '        complement = target - value',
            '        if complement in seen:',
            '            return [seen[complement], i]',
            '        seen[value] = i',
            '    return []',
            '```',
        ].join('\n'),
        'solve two sum',
        'optimal_solution',
    );

    assert.equal(result.valid, true);
    assert.equal(result.issues.includes('coding_likely_compile_error'), false);
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

test('coding screen scan preserves substantial answers even when code syntax heuristic flags code', () => {
    const result = outputValidator.validateActionOutput(
        'screen_scan',
        'coding',
        [
            '**Problem:**',
            'Text Justification (LeetCode 68). Format words so every line has exactly maxWidth characters.',
            '',
            '**Approach:**',
            '- Greedily pack as many words as fit on each line.',
            '- Distribute spaces across gaps for non-final lines.',
            '- Left-justify the final line.',
            '',
            '**Solution:**',
            '```python',
            'class Solution:',
            '    def fullJustify(self, words, maxWidth):',
            '        result = []',
            '        line = []',
            '        line_len = 0',
            '        for word in words:',
            '            if line_len + len(word) + len(line) > maxWidth:',
            '                result.append(" ".join(line)',
            '                line = [word]',
            '                line_len = len(word)',
            '            else:',
            '                line.append(word)',
            '                line_len += len(word)',
            '        result.append(" ".join(line).ljust(maxWidth))',
            '        return result',
            '```',
        ].join('\n'),
        'LeetCode 68 Text Justification',
    );

    assert.equal(result.valid, true);
    assert.match(result.correctedContent, /Text Justification/);
    assert.ok(result.issues.includes('coding_unbalanced_delimiters_ignored_for_screen_scan'));
});

function buildArchitectureAnswer(nodeCount: number = 12): string {
    const kinds = ['client', 'gateway', 'service', 'database', 'cache', 'queue', 'storage', 'external'] as const;
    const nodes = Array.from({ length: nodeCount }, (_, index) => ({
        id: `node_${index + 1}`,
        label: `Component ${index + 1}`,
        kind: kinds[index % kinds.length],
        technology: index === 0 ? 'Web' : 'Service',
        purpose: `Purpose ${index + 1}`,
        layer: 'core_services',
        latency: '<50ms',
        failureMode: 'retry_or_failover',
    }));
    const edges = nodes.slice(1).map((node, index) => ({
        source: nodes[index].id,
        target: node.id,
        label: 'calls',
        protocol: 'https',
        latency: '<20ms',
    }));
    const architectureJson = JSON.stringify({
        diagram: {
            type: 'architecture',
            direction: 'TB',
            nodes,
            edges,
        },
    });

    return [
        '### Problem Description',
        'Design WhatsApp-style messaging with reliable delivery and low-latency fanout.',
        '### 1. High-Level Understanding',
        'Use clients, gateways, message services, queues, caches, databases, and observability components.',
        '### 2. Clarifying Questions',
        '- What scale should we support?',
        '- Is end-to-end encryption required?',
        '### 3. Requirements',
        '- One-to-one messaging.',
        '- Multi-device delivery.',
        '### 4. Architecture Diagram',
        '```architecture_json',
        architectureJson,
        '```',
        '### 5. Component Breakdown',
        'The services coordinate message persistence, delivery, caching, and notifications.',
    ].join('\n');
}

test('system-design tradeoff validates concise bullets without architecture_json', () => {
    const result = outputValidator.validateActionOutput(
        'system_design_tradeoffs',
        'system_design',
        [
            '- Redis improves read latency, but it adds cache invalidation complexity.',
            '- Kafka improves fanout resilience, but it adds operational overhead.',
            '- Multi-region replication improves availability, but it complicates consistency.',
        ].join('\n'),
        'Design WhatsApp tradeoffs',
    );

    assert.equal(result.valid, true);
    assert.deepEqual(result.issues, []);
});

test('system-design tradeoff repair does not escalate to architecture_json', () => {
    const repair = outputValidator.buildRepairInstruction(
        'system_design_tradeoffs',
        ['system_design_missing_fenced_architecture_json'],
        undefined,
        'Design WhatsApp tradeoffs',
    );

    assert.doesNotMatch(repair, /architecture_json/);
    assert.doesNotMatch(repair, /MINIMUM 12 nodes required/i);
});

test('full system-design validation requires architecture_json for repair alignment', () => {
    const result = outputValidator.validateActionOutput(
        'manual_chat',
        'system_design',
        [
            '### Problem Description',
            'Design WhatsApp-style messaging for reliable delivery.',
            '### 1. High-Level Understanding',
            'Use clients, API gateway, message service, Redis cache, Kafka queue, PostgreSQL database, and observability components.',
            '### 2. Requirements',
            'Support low latency, high availability, and durable message storage.',
        ].join('\n'),
        'Design WhatsApp',
    );

    assert.equal(result.valid, false);
    assert.deepEqual(result.issues, ['system_design_missing_fenced_architecture_json']);
});

test('full system-design repair keeps architecture_json requirements', () => {
    const repair = outputValidator.buildRepairInstruction(
        'manual_chat',
        ['system_design_missing_fenced_architecture_json'],
        undefined,
        'Design WhatsApp',
    );

    assert.match(repair, /architecture_json/);
    assert.match(repair, /MINIMUM 12 nodes required/i);
    assert.match(repair, /Do not use Mermaid/i);
});

test('valid architecture_json passes the full system-design validation path', () => {
    const result = outputValidator.validateActionOutput(
        'manual_chat',
        'system_design',
        buildArchitectureAnswer(12),
        'Design WhatsApp',
    );

    assert.equal(result.valid, true);
    assert.deepEqual(result.issues, []);
});

test('architecture_json validation rejects diagrams below the node floor', () => {
    const result = outputValidator.validateActionOutput(
        'manual_chat',
        'system_design',
        buildArchitectureAnswer(3),
        'Design WhatsApp',
    );

    assert.equal(result.valid, false);
    assert.deepEqual(result.issues, ['system_design_architecture_json_too_few_nodes']);
});

test('screen scan OCR question preserves visible JavaScript editor language', () => {
    const question = buildScreenScanQuestion(
        'coding',
        [
            '68. Text Justification - LeetCode',
            'JavaScript',
            'var fullJustify = function(words, maxWidth) {',
            '  // starter code',
            '};',
        ].join('\n'),
    );

    assert.match(question, /Visible editor language: JavaScript/);
    assert.match(question, /Required solution code fence: ```javascript/);
});
