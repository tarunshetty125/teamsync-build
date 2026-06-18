// electron/llm/profileEvidenceValidator.ts
// Evidence-level validation for profile answers.
// Extends ProfileOutputValidator with:
//  - Metric grounding: checks that specific numbers ($2M, 25%, 10x) in the
//    answer actually appear in the evidence block.
//  - Company grounding: checks that employer claims ("worked at X") are in evidence.
// Generates repair instructions for any fabricated metrics or employers.

import {
  validateProfileOutput,
  buildProfileRepairInstruction,
  type ProfileViolation,
  type ProfileValidationResult,
} from './ProfileOutputValidator';
import type { AnswerPlan } from './AnswerPlanner';

/* ── Regex for metrics and companies ──────────────────────── */

const METRIC_RE = new RegExp(
  [
    '(?:\\$|₹|€|£)\\s?\\d[\\d,]*(?:\\.\\d+)?\\s?[kmb]?\\b', // $2M, ₹50,000, $150k
    '\\b\\d+(?:\\.\\d+)?\\s?%',                                // 25%, 3.5 %
    '\\b\\d+(?:\\.\\d+)?\\s?x\\b',                             // 10x
    '\\b\\d+(?:\\.\\d+)?\\s?(?:million|billion|m|b|k)\\b',     // 2 million, 500k
  ].join('|'),
  'gi',
);

const COMPANY_RE = /\b(?:worked|interned|employed|was)\s+(?:at|for|with)\s+([A-Z][A-Za-z0-9&.]*(?:\s+[A-Z][A-Za-z0-9&.]*){0,3})/g;
const COMPANY_STOPWORDS = new Set(['I', 'The', 'A', 'An', 'My', 'Our', 'Scale', 'Least', 'Most', 'Times', 'Times,']);

/* ── Helpers ──────────────────────────────────────────────── */

const digitsOf = (s: string): string => (s.match(/\d[\d,]*(?:\.\d+)?/)?.[0] || '').replace(/,/g, '');
const numberTokens = (s: string): Set<string> => new Set((s.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(t => t.replace(/,/g, '')));

const MAGNITUDE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, million: 1e6, billion: 1e9, thousand: 1e3 };

const metricForms = (raw: string): string[] => {
  const num = digitsOf(raw);
  if (!num) return [];
  const forms = new Set<string>([num]);
  const suffix = (raw.toLowerCase().match(/(k|m|b|million|billion|thousand)\b/) || [])[1];
  if (suffix && MAGNITUDE[suffix]) {
    const expanded = Math.round(parseFloat(num) * MAGNITUDE[suffix]);
    if (Number.isFinite(expanded)) forms.add(String(expanded));
  }
  return [...forms];
};

const norm = (s: string): string => (s || '').toLowerCase();

/* ── Grounded types (negotiation excluded — salary comes from strategy) ── */

const GROUNDED_TYPES = new Set([
  'identity_answer', 'profile_fact_answer', 'project_answer',
  'project_followup_answer', 'skills_answer', 'skill_experience_answer',
  'experience_answer', 'jd_fit_answer', 'behavioral_interview_answer',
]);

/* ── Types ────────────────────────────────────────────────── */

export interface EvidenceValidationInput {
  answer: string;
  plan: Pick<AnswerPlan, 'answerType' | 'outputPerspective' | 'forbiddenContextLayers'> & {
    profileContextPolicy?: string;
  };
  evidence: string;
  profileAvailable: boolean;
  candidateDirected: boolean;
}

export interface EvidenceValidationResult extends ProfileValidationResult {
  repairInstruction: string;
}

/* ── Main validator ───────────────────────────────────────── */

export function validateProfileEvidence(input: EvidenceValidationInput): EvidenceValidationResult {
  const { answer, plan, evidence, profileAvailable, candidateDirected } = input;
  const text = (answer || '').trim();

  // Run base profile-output checks first
  const base = validateProfileOutput({
    answer: text,
    plan: {
      answerType: plan.answerType,
      outputPerspective: plan.outputPerspective,
      forbiddenContextLayers: plan.forbiddenContextLayers,
    },
    profileAvailable,
    candidateDirected,
  });

  const violations: ProfileViolation[] = base.violations.map(v => ({ ...v }));
  const policy = plan.profileContextPolicy;
  const shouldCheckEvidence = GROUNDED_TYPES.has(plan.answerType) && policy !== 'forbidden' && text.length > 0;

  if (shouldCheckEvidence) {
    const ev = norm(evidence);
    const evNums = numberTokens(evidence);
    const evMetricForms = new Set(evNums);
    for (const em of evidence.match(METRIC_RE) || []) {
      for (const f of metricForms(em)) evMetricForms.add(f);
    }

    // Check metrics in the answer against evidence
    const seenMetric = new Set<string>();
    for (const m of text.match(METRIC_RE) || []) {
      const d = digitsOf(m);
      if (!d || seenMetric.has(d)) continue;
      seenMetric.add(d);
      const grounded = metricForms(m).some(f => evMetricForms.has(f));
      if (!grounded) {
        violations.push({
          code: 'unsupported_metric',
          detail: `answer cited a specific metric ("${m.trim()}") absent from the grounded evidence`,
          severity: 'error',
        });
      }
    }

    // Check company names in the answer against evidence
    let cm: RegExpExecArray | null;
    COMPANY_RE.lastIndex = 0;
    const seenCo = new Set<string>();
    while ((cm = COMPANY_RE.exec(text)) !== null) {
      const co = cm[1].trim().replace(/[.,]$/, '');
      const first = co.split(/\s+/)[0];
      if (!co || COMPANY_STOPWORDS.has(co) || COMPANY_STOPWORDS.has(first)) continue;
      if (seenCo.has(co.toLowerCase())) continue;
      seenCo.add(co.toLowerCase());
      if (!ev.includes(co.toLowerCase()) && !(first.length >= 4 && ev.includes(first.toLowerCase()))) {
        violations.push({
          code: 'unsupported_company',
          detail: `answer claimed employment at "${co}" which is not in the grounded evidence`,
          severity: 'warning',
        });
      }
    }
  }

  // Build repair instruction
  const errorCodes = violations.filter(v => v.severity === 'error').map(v => v.code);
  const lines: string[] = [];
  const baseRepair = buildProfileRepairInstruction(base);
  if (baseRepair) lines.push(baseRepair.replace(/^Your previous answer.*?:\n/, ''));

  if (errorCodes.includes('unsupported_metric')) {
    lines.push('- Remove or soften any specific number, percentage, or dollar amount that is not in the provided profile facts. Use a qualitative phrase instead (e.g. "significantly improved").');
  }
  if (violations.some(v => v.code === 'unsupported_company')) {
    lines.push('- Only name companies that appear in the provided profile facts. Do not claim employment anywhere else.');
  }

  const repairInstruction = lines.length
    ? `Your previous answer broke these rules. Regenerate, fixing ONLY these:\n${lines.join('\n')}`
    : '';

  return { ok: errorCodes.length === 0, violations, errorCodes, repairInstruction };
}
