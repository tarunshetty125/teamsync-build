// electron/llm/customContextClassifier.ts
// Classifies user-uploaded custom context into pinned (directives),
// searchable (topical facts), and sensitive (salary/pricing) categories.

/* ── Constants ────────────────────────────────────────────── */

const PINNED_MAX_CHARS = 160;
const PINNED_DIRECTIVE_RE = /^(always|never|please|use|prefer|avoid|keep|be |speak|respond|answer|don'?t|do not|make sure|remember|note:|tone:|style:|i am |i'?m |my role|my name is|call me)\b/i;
const SENSITIVE_RE = /\b(salar(?:y|ies)|compensation|\bctc\b|\blpa\b|\btc\b|lakhs?|\bcrore?s?\b|\bcr\b|base\s+(?:pay|salary)|total\s+comp(?:ensation)?|take[- ]?home|equity|stock|\brsu\b|options?\b|bonus|commission|severance|notice period|garden(?:ing)? leave|confidential|do not (?:share|disclose|reveal|leak)|don'?t (?:share|disclose|reveal)|keep (?:this )?(?:internal|private|confidential)|internal only|\bnda\b|under embargo|gross margins?|net margins?|\bmargins?\b|cost price|\bcogs\b|\bebitda\b|wholesale price|discount (?:floor|ceiling|limit|cap)|(?:price|pricing) (?:floor|cap)|floor price|list price|rack rate|\barr\b|\bmrr\b|\bacv\b|\btcv\b|churn|win rate|quota|burn rate|runway|cap table|valuation|rebate|take rate|bookings)\b/i;
const MONEY_AMOUNT_RE = /(?:[$₹€£]\s?\d[\d,.]*|(?<![\w.])\d[\d,.]*\s?(?:k\b|m\b|mm\b|lpa\b|lakhs?\b|cr\b|crores?\b|usd\b|inr\b|million\b|\/(?:seat|user|month|mo|year|yr|seat\/mo)))/i;

/* ── Types ────────────────────────────────────────────────── */

export interface ClassifiedChunk {
  text: string;
  category: 'pinned' | 'searchable' | 'sensitive';
  reason: string;
}

export interface ClassifiedContext {
  pinned: ClassifiedChunk[];
  searchable: ClassifiedChunk[];
  sensitive: ClassifiedChunk[];
  hasSensitive: boolean;
}

export interface ContextSelection {
  included: ClassifiedChunk[];
  excluded: Array<{ category: string; reason: string }>;
  sensitiveIncluded: boolean;
}

export interface ScopedContextResult {
  text: string;
  selection: ContextSelection;
  classified: ClassifiedContext;
}

/* ── Helpers ──────────────────────────────────────────────── */

const isSensitive = (chunk: string): boolean => SENSITIVE_RE.test(chunk) || MONEY_AMOUNT_RE.test(chunk);
const isLikelyDirective = (chunk: string): boolean => chunk.length <= PINNED_MAX_CHARS && PINNED_DIRECTIVE_RE.test(chunk.trim());

/* ── Chunk splitter ───────────────────────────────────────── */

export function splitCustomContextChunks(raw: string): string[] {
  const trimmed = (raw || '').trim();
  if (!trimmed) return [];

  const byBlankLine = trimmed.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);
  if (byBlankLine.length > 1) return byBlankLine;

  const hasWordChar = (s: string) => /[A-Za-z0-9]/.test(s);
  const byLine = trimmed.split(/\n+/).map(s => s.replace(/^[-*•\s]+/, '').trim()).filter(s => s.length > 0 && hasWordChar(s));
  return byLine.length > 0 ? byLine : hasWordChar(trimmed) ? [trimmed] : [];
}

/* ── Classifier ───────────────────────────────────────────── */

export function classifyCustomContext(raw: string): ClassifiedContext {
  const result: ClassifiedContext = { pinned: [], searchable: [], sensitive: [], hasSensitive: false };
  for (const text of splitCustomContextChunks(raw)) {
    if (isSensitive(text)) {
      result.sensitive.push({ text, category: 'sensitive', reason: 'matched_sensitive_terms' });
      result.hasSensitive = true;
    } else if (isLikelyDirective(text)) {
      result.pinned.push({ text, category: 'pinned', reason: 'short_imperative_directive' });
    } else {
      result.searchable.push({ text, category: 'searchable', reason: 'topical_fact_or_note' });
    }
  }
  return result;
}

/* ── Selection ────────────────────────────────────────────── */

const SENSITIVE_ALLOWED_TYPES = new Set(['negotiation_answer']);
const CUSTOM_CONTEXT_FORBIDDEN_TYPES = new Set([
  'coding_question_answer', 'dsa_question_answer', 'system_design_answer',
  'debugging_question_answer', 'identity_answer',
]);

export function selectCustomContextForAnswer(classified: ClassifiedContext, answerType: string): ContextSelection {
  const excluded: Array<{ category: string; reason: string }> = [];

  if (CUSTOM_CONTEXT_FORBIDDEN_TYPES.has(answerType)) {
    if (classified.pinned.length) excluded.push({ category: 'pinned', reason: 'forbidden_for_answer_type' });
    if (classified.searchable.length) excluded.push({ category: 'searchable', reason: 'forbidden_for_answer_type' });
    if (classified.sensitive.length) excluded.push({ category: 'sensitive', reason: 'forbidden_for_answer_type' });
    return { included: [], excluded, sensitiveIncluded: false };
  }

  const included: ClassifiedChunk[] = [...classified.pinned, ...classified.searchable];
  let sensitiveIncluded = false;

  if (classified.sensitive.length) {
    if (SENSITIVE_ALLOWED_TYPES.has(answerType)) {
      included.push(...classified.sensitive);
      sensitiveIncluded = true;
    } else {
      excluded.push({ category: 'sensitive', reason: 'not_relevant_to_answer_type' });
    }
  }

  return { included, excluded, sensitiveIncluded };
}

/* ── Convenience ──────────────────────────────────────────── */

export function buildScopedCustomContext(raw: string, answerType: string): ScopedContextResult {
  const classified = classifyCustomContext(raw);
  const selection = selectCustomContextForAnswer(classified, answerType);
  const text = selection.included.map(c => c.text).join('\n');
  return { text, selection, classified };
}

export function summarizeCustomContextSelection(
  selection: ContextSelection,
  classified: ClassifiedContext,
): { pinned: number; searchable: number; sensitive: number; includedCount: number; sensitiveIncluded: boolean; excluded: string[] } {
  return {
    pinned: classified.pinned.length,
    searchable: classified.searchable.length,
    sensitive: classified.sensitive.length,
    includedCount: selection.included.length,
    sensitiveIncluded: selection.sensitiveIncluded,
    excluded: selection.excluded.map(e => `${e.category}:${e.reason}`),
  };
}
