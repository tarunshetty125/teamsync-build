// electron/llm/CodeSanityCheck.ts
// Quick sanity checks on LLM-generated code for common bugs.

const MAX_EXCERPT_LENGTH = 200;

function truncate(line: string): string {
  if (line.length <= MAX_EXCERPT_LENGTH) return line;
  return line.slice(0, MAX_EXCERPT_LENGTH - 1) + '…';
}

export interface CodeIssue {
  code: string;
  label: string;
  excerpt: string;
}

export interface SanityCheckResult {
  ok: boolean;
  issues: CodeIssue[];
}

function extractFencedCodeBlocks(text: string): Array<{ lang: string; content: string }> {
  const blocks: Array<{ lang: string; content: string }> = [];
  const re = /```([A-Za-z0-9_+-]*)\s*\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    blocks.push({ lang: m[1] || '', content: m[2] });
  }
  return blocks;
}

/**
 * Checks a coding answer for common bugs in the generated code.
 * Returns `{ ok: true }` if no issues found, or `{ ok: false, issues: [...] }`.
 */
export function checkAnswerForCodeBugs(answer: string): SanityCheckResult {
  if (!answer || typeof answer !== 'string') return { ok: true, issues: [] };

  const issues: CodeIssue[] = [];
  const fencedBlocks = extractFencedCodeBlocks(answer);

  // Bug: tuple assignment where subtraction was intended
  // e.g. `complement = target, num;` instead of `complement = target - num;`
  const tupleBugRe = /^\s*(?:const|let|var)?\s*(?:complement|diff|difference|remainder|needed|missing|gap|delta)\s*(?:=|:=)\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*;?\s*$/m;
  for (const block of fencedBlocks) {
    const match = block.content.match(tupleBugRe);
    if (match) {
      issues.push({
        code: 'subtraction_as_tuple',
        label: 'code block assigns a tuple where a subtraction is expected',
        excerpt: truncate(match[0]),
      });
    }
  }

  // Bug: assignment in conditional instead of equality
  // e.g. `if (x = 5)` instead of `if (x == 5)`
  const assignInIfRe = /^\s*if\s*(?:\(\s*)?[A-Za-z_$][\w$.[\]]*\s*=\s*[^=!<>]/m;
  for (const block of fencedBlocks) {
    const match = block.content.match(assignInIfRe);
    if (match) {
      const line = match[0];
      if (!/===|!==|==/.test(line)) {
        issues.push({
          code: 'assignment_in_conditional',
          label: 'conditional uses assignment (`=`) instead of equality (`==`/`===`)',
          excerpt: truncate(line),
        });
      }
    }
  }

  // Bug: dry-run narration writes "X, Y = Z" where "X - Y = Z" was intended
  const narrationBugRe = /`?\s*[\w\d-]+\s*,\s*[\w\d-]+\s*=\s*[\w\d-]+\s*`?/;
  const proseLines = answer.split(/\n+/);
  for (const line of proseLines) {
    if (!/calculat|comput|find|gives|see\s/i.test(line)) continue;
    if (narrationBugRe.test(line)) {
      if (/\s-\s/.test(line)) continue; // actual subtraction present
      issues.push({
        code: 'narration_subtraction_as_tuple',
        label: 'dry-run narration writes "X, Y = Z" where "X - Y = Z" was intended',
        excerpt: truncate(line.trim()),
      });
      break;
    }
  }

  return { ok: issues.length === 0, issues };
}
