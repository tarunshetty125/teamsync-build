// electron/llm/codeVerification/extractTests.ts
// Extracts test cases from the LLM answer and problem text.
// Parses <verification_spec> blocks and Input/Output examples.

import type { TestCase, VerificationSpec } from './types';

/* ── Language normalization ────────────────────────────────── */

const LANG_ALIASES: Record<string, string> = {
  py: 'python', python: 'python', python3: 'python',
  js: 'javascript', javascript: 'javascript', node: 'javascript',
  ts: 'typescript', typescript: 'typescript',
  java: 'java',
  cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp',
  c: 'c',
  go: 'go', golang: 'go',
  sql: 'sql',
};

export const normalizeLanguage = (tag: string | undefined | null): string | null => {
  if (!tag) return null;
  return LANG_ALIASES[tag.trim().toLowerCase()] ?? null;
};

export const inferLanguageFromText = (text: string): string | null => {
  const t = text.toLowerCase();
  for (const [word, lang] of Object.entries(LANG_ALIASES)) {
    if (new RegExp(`\\b(in|using|with)\\s+${word.replace('+', '\\+')}\\b`, 'i').test(t)) return lang;
  }
  if (/\bpublic\s+class\b|\bsystem\.out\b|\bpublic\s+\w+\s+\w+\s*\(/.test(text)) return 'java';
  if (/#include\b|\bstd::|\bcout\b|\bint\s+main\s*\(/.test(text)) return 'cpp';
  if (/\bdef\s+\w+\s*\(|\bprint\s*\(/.test(text)) return 'python';
  if (/\bfunction\s+\w+\s*\(|\bconst\s+\w+\s*=|\bconsole\.log\b|=>/.test(text)) return 'javascript';
  if (/\bselect\b[\s\S]*\bfrom\b/i.test(text)) return 'sql';
  return null;
};

/* ── Code block extraction ────────────────────────────────── */

export const extractCodeBlock = (answer: string): {
  code: string; language: string | null; declaredTag: string; block: string | null;
} => {
  const match = answer.match(/```([a-zA-Z0-9+#.\-]*)\s*\n([\s\S]+?)```/);
  if (!match) return { code: '', language: null, declaredTag: '', block: null };
  return {
    code: (match[2] || '').trim(),
    language: normalizeLanguage(match[1]),
    declaredTag: (match[1] || '').trim(),
    block: match[0],
  };
};

/* ── Verification spec parsing ────────────────────────────── */

export const extractVerificationSpec = (answer: string): {
  spec: VerificationSpec | null; block: string | null;
} => {
  const m = answer.match(/<verification_spec>\s*([\s\S]*?)\s*<\/verification_spec>/i);
  if (!m) return { spec: null, block: null };
  const raw = m[1].replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed) return { spec: null, block: m[0] };
    const language = normalizeLanguage(parsed.language);

    // SQL spec
    if (language === 'sql') {
      const sqlRaw = parsed.sql && typeof parsed.sql === 'object' ? parsed.sql : parsed;
      const strArr = (a: any) => Array.isArray(a) ? a.filter((s: any) => typeof s === 'string' && s.trim()) : [];
      const schema = strArr(sqlRaw.schema);
      const seeds = strArr(sqlRaw.seeds);
      const expected = Array.isArray(sqlRaw.expected)
        ? sqlRaw.expected.filter((r: any) => r && typeof r === 'object' && !Array.isArray(r))
        : [];
      const ordered = sqlRaw.ordered === true;
      const sql = schema.length > 0 && expected.length > 0 ? { schema, seeds, expected, ordered } : undefined;
      return {
        spec: { entry: typeof parsed.entry === 'string' ? parsed.entry : 'query', language: 'sql', cases: [], sql },
        block: m[0],
      };
    }

    // Standard spec
    if (typeof parsed.entry !== 'string' || !Array.isArray(parsed.cases)) {
      return { spec: null, block: m[0] };
    }
    const cases: TestCase[] = parsed.cases
      .filter((c: any) => c && Array.isArray(c.input) && 'expected' in c)
      .map((c: any) => ({ input: c.input, expected: c.expected, source: 'model' as const }));
    const asHint = (h: any) => (h === 'list' || h === 'tree' ? h : 'value') as 'value' | 'list' | 'tree';
    const argTypes = Array.isArray(parsed.argTypes) ? parsed.argTypes.map(asHint) : undefined;
    const retType = parsed.retType !== undefined ? asHint(parsed.retType) : undefined;
    const declaredLanguageRaw = typeof parsed.language === 'string' ? parsed.language.trim() : '';
    return {
      spec: { entry: parsed.entry.trim(), language: language ?? 'python', declaredLanguageRaw, cases, argTypes, retType },
      block: m[0],
    };
  } catch {
    return { spec: null, block: m[0] };
  }
};

/* ── Problem example parsing ──────────────────────────────── */

const parseLooseJson = (token: string): any => {
  let t = token.trim().replace(/[.;]+$/, '').trim();
  if (!t) return undefined;
  try { return JSON.parse(t); } catch { /* noop */ }
  try { return JSON.parse(t.replace(/'/g, '"')); } catch { /* noop */ }
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d*\.\d+$/.test(t)) return parseFloat(t);
  if (t === 'true' || t === 'false') return t === 'true';
  if (t === 'null') return null;
  if (/^[A-Za-z][\w ]*$/.test(t)) return t;
  return undefined;
};

const parseAssignmentsOrValue = (segment: string): any[] | null => {
  const assignments = [...segment.matchAll(/[A-Za-z_]\w*\s*=\s*([^,\n][^=]*?)(?=(?:,\s*[A-Za-z_]\w*\s*=)|$)/g)];
  if (assignments.length > 0) {
    const vals = assignments.map(a => parseLooseJson(a[1].trim())).filter(v => v !== undefined);
    return vals.length > 0 ? vals : null;
  }
  const single = parseLooseJson(segment.trim());
  return single === undefined ? null : [single];
};

export const parseProblemExamples = (problemText: string | undefined): TestCase[] => {
  if (!problemText) return [];
  const cases: TestCase[] = [];
  const re = /input\s*:?\s*([\s\S]*?)\s*output\s*:?\s*([^\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(problemText)) !== null) {
    const inputs = parseAssignmentsOrValue(m[1]);
    const expected = parseLooseJson(m[2].trim());
    if (inputs !== null && expected !== undefined) {
      cases.push({ input: inputs, expected, source: 'problem' });
    }
    if (cases.length >= 5) break;
  }
  return cases;
};

/* ── Merge test cases ─────────────────────────────────────── */

const caseKey = (c: TestCase): string => {
  try { return JSON.stringify([c.input, c.expected]); }
  catch { return `${String(c.input)}|${String(c.expected)}`; }
};

export const mergeTestCases = (problem: TestCase[], model: TestCase[], cap = 12): TestCase[] => {
  const seen = new Set<string>();
  const out: TestCase[] = [];
  for (const c of [...problem, ...model]) {
    const key = caseKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= cap) break;
  }
  return out;
};
