// electron/llm/AnswerValidator.ts
// Validates and repairs coding/DSA answer markdown structure.
// Ensures the 6-section contract is met and auto-repairs broken responses.

import { CODING_SECTIONS, CODING_SECTION_HEADINGS } from './codingContract';

/* ── Constants ────────────────────────────────────────────── */

const CODING_SECTIONS_LIST = [...CODING_SECTIONS];
const REQUIRED_MARKDOWN_HEADINGS = CODING_SECTIONS_LIST.map(section => `## ${section}`);

/* ── Section detection with aliases ───────────────────────── */

const sectionHeader = (label: string): RegExp =>
  new RegExp(`^\\s*#{0,3}\\s*(?:\\*\\*)?\\s*(?:${label})\\s*(?:\\*\\*)?\\s*(?::|[\\-–—])?\\s*$`, 'im');

const SECTION_ALIASES: Record<string, RegExp[]> = {
  'Approach': [sectionHeader('Approach')],
  'Technique / Data Structure / Algorithm Used': [
    sectionHeader('Technique|Data Structure|Algorithm Used|Technique \\/ Data Structure \\/ Algorithm Used'),
  ],
  'Code': [sectionHeader('Code')],
  'Dry Run': [sectionHeader('Dry Run')],
  'Complexity': [sectionHeader('Complexity')],
  'Interviewer Follow-up Points': [
    sectionHeader('Interviewer Follow-up Points|Follow-up Points|Follow-ups'),
  ],
};

/* ── Detection helpers ────────────────────────────────────── */

const hasSection = (answer: string, section: string): boolean =>
  SECTION_ALIASES[section]?.some(pattern => pattern.test(answer)) ?? false;

const hasCodeBlock = (answer: string): boolean =>
  /```[a-zA-Z0-9+#-]*\n[\s\S]+?```/.test(answer);

const hasLanguageTaggedCodeBlock = (answer: string): boolean =>
  /```[a-zA-Z0-9+#-]+\n[\s\S]+?```/.test(answer);

const hasComplexity = (answer: string): boolean =>
  /\bTime(?:\s+Complexity)?\s*:?\s*(?:`|\$|\\\()??\s*O\s*\(/i.test(answer) &&
  /\bSpace(?:\s+Complexity)?\s*:?\s*(?:`|\$|\\\()??\s*O\s*\(/i.test(answer);

const isCodingType = (answerType: string): boolean =>
  answerType === 'coding_question_answer' || answerType === 'dsa_question_answer';

const startsWithCodeLikeContent = (answer: string): boolean => {
  const trimmed = answer.trimStart();
  return /^```/.test(trimmed) ||
    /^(def|function|class|const|let|var|public|private|import|from|SELECT\b|WITH\b)\b/i.test(trimmed);
};

const headingPositions = (answer: string): number[] =>
  REQUIRED_MARKDOWN_HEADINGS.map(heading => answer.indexOf(heading));

const hasExactMarkdownSectionOrder = (answer: string): boolean => {
  const positions = headingPositions(answer);
  if (positions.some(position => position < 0)) return false;
  return positions.every((position, index) => index === 0 || positions[index - 1] < position);
};

const containsForbiddenCodingContext = (answer: string): boolean =>
  /\b(resume|job description|salary|compensation|negotiation|Natively|as an AI|AI assistant)\b/i.test(answer);

/* ── Scaffold builder ─────────────────────────────────────── */

export function buildCodingScaffold(): string {
  return `## Approach

_Working on the approach…_

## Technique / Data Structure / Algorithm Used

_Identifying the core technique…_

## Code

_Writing the solution…_

## Dry Run

_Preparing a sample walkthrough…_

## Complexity

_Analyzing time and space complexity…_

## Interviewer Follow-up Points

_Gathering likely follow-ups…_`;
}

/* ── Render structured coding answer ──────────────────────── */

interface CodingAnswerParts {
  approach: string;
  technique: string;
  language: string;
  code: string;
  dryRun: string;
  complexity: string;
  interviewerFollowUpPoints: string[];
}

export function renderCodingAnswerMarkdown(answer: CodingAnswerParts): string {
  const language = (answer.language || 'python').trim() || 'python';
  const followUps = answer.interviewerFollowUpPoints.length > 0
    ? answer.interviewerFollowUpPoints.map(point => `- ${point.trim()}`).join('\n')
    : '- Clarify edge cases and assumptions with the interviewer.';

  return `## Approach

${answer.approach.trim()}

## Technique / Data Structure / Algorithm Used

${answer.technique.trim()}

## Code

\`\`\`${language}
${answer.code.trim()}
\`\`\`

## Dry Run

${answer.dryRun.trim()}

## Complexity

${answer.complexity.trim()}

## Interviewer Follow-up Points

${followUps}`.trim();
}

/* ── Code block extraction ────────────────────────────────── */

function extractFirstCodeBlock(answer: string): { language: string; code: string; block: string } | null {
  const match = answer.match(/```([a-zA-Z0-9+#-]*)\n([\s\S]+?)```/);
  if (!match) return null;
  return {
    language: match[1]?.trim() || 'python',
    code: match[2]?.trim() || '',
    block: match[0],
  };
}

function stripCodeBlock(answer: string, block?: string): string {
  return block ? answer.replace(block, '').trim() : answer.trim();
}

function inferLanguage(answer: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  if (/\b(javascript|js)\b/i.test(answer)) return 'javascript';
  if (/\btypescript|\bts\b/i.test(answer)) return 'typescript';
  if (/\bjava\b/i.test(answer)) return 'java';
  if (/\bc\+\+|cpp\b/i.test(answer)) return 'cpp';
  if (/\bsql\b/i.test(answer)) return 'sql';
  return 'python';
}

/* ── Missing section markers ──────────────────────────────── */

const MISSING_COMPLEXITY_MARKER = 'Time Complexity: O(?) — state the actual time bound and why.\n\nSpace Complexity: O(?) — state the actual space bound and why.';
const MISSING_DRY_RUN_MARKER = 'Trace a small sample input through the code step by step to confirm it produces the expected output.';
const MISSING_TECHNIQUE_MARKER = 'See the approach above for the core technique.';
const MISSING_APPROACH_MARKER = 'Solve the problem with the most direct correct method, then optimize.';
const MISSING_CODE_MARKER = '// The model did not return code. Regenerate for a complete solution.';

/* ── Complexity extraction from prose ─────────────────────── */

const COMPLEXITY_CONNECTOR = `(?:(?:\\b(?:this|it|that)\\b\\s+(?:is\\s+)?)?,?\\s*(?:which is|which runs? in|running in|that runs? in|runs? in|giving|yielding|for a|with|in)\\s+)?`;
const COMPLEXITY_TAIL = `(?:\\s*(?:time|space))?(?:\\s*(?:and|,)\\s*\`?O\\s*\\([^)]*\\)\`?(?:\\s*(?:time|space))?)?(?:[^.\\n]*?(?:because|due to)[^.\\n]*)?`;
const COMPLEXITY_FRAGMENT_RE = new RegExp(
  `(?:(?:time|space)\\s*(?:complexity)?\\s*[:=]?\\s*\`?O\\s*\\([^)]*\\)\`?${COMPLEXITY_TAIL})|(?:${COMPLEXITY_CONNECTOR}\`?O\\s*\\([^)]*\\)\`?${COMPLEXITY_TAIL})`,
  'gi'
);
const BARE_BIGO_WITH_KIND_RE = /\bO\s*\([^)]*\)\s*(?:time|space)\b|\b(?:time|space)\s+O\s*\([^)]*\)/gi;

function extractComplexityText(prose: string): string | null {
  const fragments = new Set<string>();
  for (const m of prose.matchAll(COMPLEXITY_FRAGMENT_RE)) {
    const frag = m[0]
      .replace(/^[\s,]*(?:(?:this|it|that)\s+(?:is\s+)?)?(?:which is|which runs? in|running in|that runs? in|runs? in|giving|yielding|for a|with|in)\s+/i, '')
      .trim();
    if (frag) fragments.add(frag);
  }
  if (fragments.size === 0) {
    for (const m of prose.matchAll(BARE_BIGO_WITH_KIND_RE)) {
      const frag = m[0].trim();
      if (frag) fragments.add(frag);
    }
  }
  if (fragments.size > 0) return [...fragments].join('\n\n');
  const bareBigO = prose.match(/O\s*\([^)]*\)/i);
  return bareBigO ? `Time Complexity: ${bareBigO[0]} (as stated by the model — verify).` : null;
}

/* ── Section parser ───────────────────────────────────────── */

type CanonicalSection = 'approach' | 'technique' | 'code' | 'dryRun' | 'complexity' | 'followUps';

function headingToCanonical(title: string): CanonicalSection | null {
  const t = title.toLowerCase().replace(/[*_`#]/g, '').trim();
  if (/^approach\b|^intuition\b|^idea\b|^solution\b|^overview\b/.test(t)) return 'approach';
  if (/technique|data structure|algorithm|pattern|method used/.test(t)) return 'technique';
  if (/^code\b|^implementation\b|^solution code\b/.test(t)) return 'code';
  if (/dry run|walkthrough|walk through|trace|example run|step[- ]by[- ]step/.test(t)) return 'dryRun';
  if (/complexity|time.*space|big[- ]?o|analysis/.test(t)) return 'complexity';
  if (/follow[- ]?up|interviewer|edge case|gotcha|notes?\b/.test(t)) return 'followUps';
  return null;
}

const HEADING_LINE_RE = /^\s*(?:#{1,3}\s*(.+?)|\*\*(.+?)\*\*\s*:?|([A-Z][^.!?\n]{2,60}?))\s*:?\s*$/;

function parseModelSections(text: string): { sections: Record<string, string>; preamble: string; recognized: number } {
  const sections: Record<string, string> = {};
  const preambleLines: string[] = [];
  let current: string | null = null;
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (current) {
      sections[current] = sections[current] ? `${sections[current]}\n${content}` : content;
    } else if (content) {
      preambleLines.push(content);
    }
    buffer = [];
  };

  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const headingMatch = !inFence ? line.match(HEADING_LINE_RE) : null;
    const title = headingMatch ? (headingMatch[1] ?? headingMatch[2] ?? headingMatch[3] ?? '') : '';
    const canonical = headingMatch ? headingToCanonical(title) : null;
    if (canonical) { flush(); current = canonical; continue; }
    buffer.push(line);
  }
  flush();

  return { sections, preamble: preambleLines.join('\n').trim(), recognized: Object.keys(sections).length };
}

/* ── Repair ───────────────────────────────────────────────── */

export function repairCodingMarkdown(rawResponse: string, question?: string, language?: string): string {
  const trimmed = rawResponse.trim();
  const codeBlock = extractFirstCodeBlock(trimmed);
  const inferredLanguage = inferLanguage(`${question || ''}\n${trimmed}`, language || codeBlock?.language);
  const code = codeBlock?.code || MISSING_CODE_MARKER;
  const parsed = parseModelSections(trimmed);

  const approachRaw = (parsed.sections.approach || parsed.preamble || '').trim();
  const approach = stripCodeBlock(
    approachRaw,
    codeBlock && approachRaw.includes(codeBlock.block) ? codeBlock.block : undefined
  ).trim() || MISSING_APPROACH_MARKER;

  const technique = (parsed.sections.technique || '').trim() || MISSING_TECHNIQUE_MARKER;
  const dryRun = (parsed.sections.dryRun || '').trim() || MISSING_DRY_RUN_MARKER;

  const complexitySection = (parsed.sections.complexity || '').trim();
  const complexity = complexitySection || extractComplexityText(parsed.preamble) || MISSING_COMPLEXITY_MARKER;

  const followUpsSection = (parsed.sections.followUps || '').trim();
  const interviewerFollowUpPoints = followUpsSection
    ? followUpsSection.split('\n').map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean)
    : [
        'Clarify edge cases such as empty input, duplicates, and boundary values.',
        'Be ready to justify the time and space complexity.',
      ];

  return renderCodingAnswerMarkdown({
    approach,
    technique,
    language: inferredLanguage,
    code,
    dryRun,
    complexity,
    interviewerFollowUpPoints,
  });
}

export const repairCodingAnswer = repairCodingMarkdown;

/* ── Validate ─────────────────────────────────────────────── */

export interface ValidationResult {
  ok: boolean;
  missingSections: string[];
  hasCodeBlock: boolean;
  hasComplexity: boolean;
  repaired?: string;
}

export function validateCodingMarkdown(response: string): ValidationResult {
  const answer = response.trim();
  const missingSections = CODING_SECTIONS_LIST.filter(section => !hasSection(answer, section));
  const codeBlockPresent = hasCodeBlock(answer);
  const complexityPresent = hasComplexity(answer);
  const ordered = hasExactMarkdownSectionOrder(answer);
  const startsWithCode = startsWithCodeLikeContent(answer);
  const hasTaggedBlock = hasLanguageTaggedCodeBlock(answer);
  const leaksContext = containsForbiddenCodingContext(answer);

  const ok = missingSections.length === 0 && codeBlockPresent && hasTaggedBlock &&
    complexityPresent && ordered && !startsWithCode && !leaksContext;

  return {
    ok,
    missingSections,
    hasCodeBlock: codeBlockPresent,
    hasComplexity: complexityPresent,
    repaired: ok ? undefined : repairCodingMarkdown(answer),
  };
}

export function validateAnswerStructure(answerType: string, answer: string): ValidationResult {
  if (!isCodingType(answerType)) {
    return {
      ok: true,
      missingSections: [],
      hasCodeBlock: hasCodeBlock(answer),
      hasComplexity: hasComplexity(answer),
    };
  }
  return validateCodingMarkdown(answer);
}
