// electron/llm/codingContract.ts
// Coding response contract — defines the 6-section markdown format
// for coding/DSA interview answers and the verification spec schema.

/* ── Coding Sections ──────────────────────────────────────── */

export const CODING_SECTIONS = [
  'Approach',
  'Technique / Data Structure / Algorithm Used',
  'Code',
  'Dry Run',
  'Complexity',
  'Interviewer Follow-up Points',
] as const;

export const CODING_SECTION_HEADINGS = CODING_SECTIONS.map(s => `## ${s}`);

/* ── The Contract (injected into system prompts) ──────────── */

export const CODING_CONTRACT = `CODING / DSA RESPONSE CONTRACT — output these EXACT markdown headings, in THIS order, with nothing before the first heading:

## Approach
- Short, interview-speakable explanation of the idea. Optimized approach clearly; brute force only if useful.

## Technique / Data Structure / Algorithm Used
- Name the core DSA concept/data structure/algorithm (e.g. two pointers, sliding window, hash map, stack, queue, binary search, DP, BFS/DFS, heap, trie, union-find, recursion, backtracking).

## Code
- Clean, correct, interview-ready code in ONE fenced block with a language tag (\`\`\`python). Meaningful names, minimal comments. Do NOT start the answer with code — the \`## Approach\` heading comes first.

## Dry Run
- Walk through ONE sample input step by step and show how the code reaches the output.

## Complexity
- Time Complexity: O(...), because ...
- Space Complexity: O(...), because ...

## Interviewer Follow-up Points
- Syntax/built-ins, edge cases, assumptions, duplicates, boundaries, tradeoffs, or optimizations the interviewer might probe.

Every heading is mandatory and must appear verbatim (with the \`## \` prefix). Even a small/local model must emit every heading. A missing/renamed heading, or starting with code, is a format failure.`;

/* ── Verification Spec Instruction ────────────────────────── */

export const CODING_VERIFICATION_INSTRUCTION = `After the six sections, output a hidden test block EXACTLY in this form (it is removed before display, so the user never sees it — keep it strictly valid JSON):

<verification_spec>
{"entry":"<the function or method name in your Code, e.g. twoSum>","language":"<python|javascript|java|cpp|...>","cases":[{"input":[<arg1>,<arg2>],"expected":<return value>}]}
</verification_spec>

Rules for the spec:
- "entry" MUST be the exact name of the function/method a caller would invoke in your Code (for a "class Solution" method, use the method name).
- "input" is the ARGUMENT LIST passed to that function, in order (wrap a single argument in a one-element array).
- Include EVERY example from the problem statement, PLUS 1-3 edge cases (empty input, duplicates, boundaries) you are confident about.
- Use only concrete JSON values (numbers, strings, booleans, arrays, objects, null). No code, no expressions, no comments.
- LINKED LISTS / BINARY TREES: if any argument or the return value is a linked list (ListNode) or binary tree (TreeNode), add "argTypes" and/or "retType" so the runner can build/compare them. Use "list" for a linked list, "tree" for a binary tree, "value" (or omit) otherwise. Encode a linked list as a plain array [1,2,3]; encode a binary tree in LeetCode LEVEL-ORDER with null for missing nodes, e.g. [3,9,20,null,null,15,7]. Example: \`{"entry":"reverseList","language":"python","argTypes":["list"],"retType":"list","cases":[{"input":[[1,2,3]],"expected":[3,2,1]}]}\`.
- SQL: if your Code is a SQL query, set "language":"sql" and OMIT "entry"/"cases". Instead provide "schema" (array of CREATE TABLE statements), "seeds" (array of INSERT statements), and "expected" (the result-set rows as {column: value} objects using your SELECT's output column names/aliases). Add "ordered":true ONLY if the problem requires a specific row order; otherwise omit it (rows compare order-insensitively). Write standard SQL that runs on SQLite. Only a single read-only SELECT is verified. Example: \`{"language":"sql","schema":["CREATE TABLE T(id INT, v INT)"],"seeds":["INSERT INTO T VALUES (1,10),(2,20)"],"expected":[{"id":2,"v":20}]}\`. If you cannot give reliable schema/seed/expected, emit \`{"language":"sql","schema":[],"seeds":[],"expected":[]}\` to skip verification rather than guess.
- If you genuinely cannot produce reliable expected outputs, output \`<verification_spec>{"entry":"<name>","language":"<lang>","cases":[]}</verification_spec>\` rather than guessing wrong values.`;

/* ── Streaming Spec Stripper ──────────────────────────────── */

/**
 * Strips `<verification_spec>` blocks from streaming LLM output
 * so the user never sees the verification JSON.
 */
export class StreamingSpecStripper {
  private suppressing = false;
  private tail = '';

  private static readonly OPEN = '<verification_spec';
  private static readonly HOLD = StreamingSpecStripper.OPEN.length;

  /** Push a chunk; returns the safe-to-display portion. */
  push(chunk: string): string {
    if (this.suppressing) return '';
    let buf = this.tail + chunk;

    const idx = buf.indexOf(StreamingSpecStripper.OPEN);
    if (idx >= 0) {
      this.suppressing = true;
      this.tail = '';
      return buf.slice(0, idx);
    }

    const keep = Math.max(0, buf.length - StreamingSpecStripper.HOLD);
    const emit = buf.slice(0, keep);
    this.tail = buf.slice(keep);
    return emit;
  }

  /** Flush any safely-non-tag tail at stream end. */
  finish(): string {
    if (this.suppressing) return '';
    const out = this.tail;
    this.tail = '';
    return out;
  }
}
