// electron/llm/ProfileOutputValidator.ts
// Validates LLM outputs for profile-related answers.
// Catches identity leaks (AI admitting to being an AI), false refusals
// (claiming no access when a profile IS loaded), wrong-perspective answers,
// salary leaks in non-negotiation answers, and resume references in
// profile-forbidden answers. Generates targeted repair instructions.

import type { AnswerPlan } from './AnswerPlanner';

/* ── Profile answer types ─────────────────────────────────── */

const PROFILE_ANSWER_TYPES = new Set([
  'identity_answer', 'profile_fact_answer', 'project_answer',
  'project_followup_answer', 'skills_answer', 'skill_experience_answer',
  'experience_answer', 'jd_fit_answer', 'behavioral_interview_answer',
  'negotiation_answer',
]);

export const isProfileAnswerType = (t: string): boolean => PROFILE_ANSWER_TYPES.has(t);

/* ── Detection regexes ────────────────────────────────────── */

const ASSISTANT_IDENTITY_RE = /\bI(?:'m| am)\s+Natively\b|\bI(?:'m| am)\s+an?\s+(?:AI\s+)?(?:assistant|language model|chat\s?bot)\b|\bI(?:'m| am)\s+an\s+AI\b(?!\s*(?:and|engineer|developer|intern|specialist|enthusiast)\b)(?![\s]*[&/,])|\bas\s+an\s+AI(?:\s+(?:language\s+)?model)?,?\s+I\b/i;
const NATIVELY_SELF_RE = /\b(?:I am|I'm|as)\s+Natively\b/i;
const NO_ACCESS_RE = /\bI\s+(?:do(?:n'?t| not)|cannot|can'?t)\s+(?:have\s+access\s+to|access)\b|\bI\s+do(?:n'?t| not)\s+(?:have|know)\s+(?:your|the user'?s|that)\b|\bno\s+access\s+to\s+(?:your|the user'?s|personal)\b|\bI\s+(?:cannot|can'?t)\s+share\s+(?:that|this|your|personal)\b|\bI\s+do(?:n'?t| not)\s+have\s+(?:the\s+)?(?:specific\s+)?(?:job\s+description|jd|resume|profile|past\s+experience)\b(?:\s+loaded)?|\bI\s+do(?:n'?t| not)\s+have\s+(?:specific\s+)?past\s+experience\s+loaded\b/i;
const NO_EXPERIENCE_RE = /\bI\s+do(?:n'?t| not)\s+have\s+(?:personal\s+|any\s+|a\s+)?(?:experience|projects?|a\s+resume|a\s+background|story)\b|\bI\s+have\s+no\s+personal\s+experience\b|\bas\s+an\s+AI[, ].{0,40}\b(?:experience|cannot|can'?t)\b|\bif\s+that\s+matches\s+my\s+background\b|\bI\s+do(?:n'?t| not)\s+have\s+a\s+story\s+loaded\b/i;
const SALARY_FIGURE_RE = /(?:\$|₹|€|£)\s?\d|(?:\b\d{2,3}\s?k\b)|\b\d+\s?lpa\b|\bCTC\b/i;
const NEGOTIATION_STRATEGY_RE = /\b(counter[- ]?offer|walk\s?away|batna|anchor (?:high|to)|leverage point|minimum acceptable|target range)\b/i;
const PROFILE_LEAK_RE = /\b(my resume|the candidate'?s resume|job description|the JD|candidate_profile|target_job)\b/i;

/* ── Helpers ──────────────────────────────────────────────── */

function firstPersonPresent(answer: string): boolean {
  return /\b(I|I'?m|I'?ve|I'?d|I'?ll|my|mine|myself|me)\b/i.test(answer);
}

function thirdPersonAboutUser(answer: string): boolean {
  return (
    /\b(the user'?s?|the candidate'?s?|their\s+(?:name|experience|background|projects?|skills?))\b/i.test(answer) ||
    /\byour\s+(?:name\s+is|experience\s+(?:includes|is)|background\s+is|projects?\s+(?:include|are)|skills?\s+(?:include|are))\b/i.test(answer) ||
    /\byou\s+are\s+[A-Z][a-z]+/i.test(answer)
  );
}

/* ── Types ────────────────────────────────────────────────── */

export interface ProfileViolation {
  code: string;
  detail: string;
  severity: 'error' | 'warning';
}

export interface ProfileValidationResult {
  ok: boolean;
  violations: ProfileViolation[];
  errorCodes: string[];
}

export interface ProfileValidationInput {
  answer: string;
  plan: Pick<AnswerPlan, 'answerType' | 'outputPerspective' | 'forbiddenContextLayers'>;
  profileAvailable: boolean;
  candidateDirected: boolean;
}

/* ── Main validator ───────────────────────────────────────── */

export function validateProfileOutput(input: ProfileValidationInput): ProfileValidationResult {
  const { answer, plan, profileAvailable, candidateDirected } = input;
  const text = (answer || '').trim();
  const violations: ProfileViolation[] = [];

  if (!text) {
    return { ok: true, violations: [], errorCodes: [] };
  }

  const isProfile = isProfileAnswerType(plan.answerType);
  const wantsFirstPerson = plan.outputPerspective === 'first_person_candidate';

  // False refusal: profile IS loaded but LLM says "I don't have access"
  if (isProfile && profileAvailable) {
    if (NO_ACCESS_RE.test(text)) {
      violations.push({
        code: 'false_no_access_refusal',
        detail: `${plan.answerType} answered "no access" though a profile is loaded`,
        severity: 'error',
      });
    }
    if (NO_EXPERIENCE_RE.test(text)) {
      violations.push({
        code: 'false_no_experience_refusal',
        detail: `${plan.answerType} claimed no personal experience though a profile is loaded`,
        severity: 'error',
      });
    }
  }

  // Identity leak: answering as "I am Natively / an AI"
  if (isProfile && candidateDirected && (ASSISTANT_IDENTITY_RE.test(text) || NATIVELY_SELF_RE.test(text))) {
    violations.push({
      code: 'assistant_identity_leak',
      detail: `${plan.answerType} answered as the assistant ("I am Natively / an AI") instead of the candidate`,
      severity: 'error',
    });
  }

  // Wrong perspective: should be first-person but spoke in third person
  if (isProfile && wantsFirstPerson) {
    if (!firstPersonPresent(text) && thirdPersonAboutUser(text)) {
      violations.push({
        code: 'wrong_perspective_not_first_person',
        detail: `${plan.answerType} should be first-person but spoke in third person about the user`,
        severity: 'error',
      });
    }
  }

  // Salary leak in non-negotiation answers
  if (plan.answerType !== 'negotiation_answer') {
    const forbidsNegotiation = plan.forbiddenContextLayers.includes('negotiation');
    if (forbidsNegotiation && NEGOTIATION_STRATEGY_RE.test(text)) {
      violations.push({
        code: 'sensitive_salary_leak',
        detail: `${plan.answerType} leaked negotiation strategy language in a non-salary answer`,
        severity: 'error',
      });
    }
    const figureSensitiveTypes = ['identity_answer', 'skills_answer', 'skill_experience_answer'];
    if (figureSensitiveTypes.includes(plan.answerType) && SALARY_FIGURE_RE.test(text)) {
      violations.push({
        code: 'sensitive_salary_leak',
        detail: `${plan.answerType} contained a salary/comp figure where none belongs`,
        severity: 'warning',
      });
    }
  }

  // Resume/JD reference in profile-forbidden answer
  if (plan.forbiddenContextLayers.includes('resume') && PROFILE_LEAK_RE.test(text)) {
    violations.push({
      code: 'profile_in_generic_answer',
      detail: `${plan.answerType} referenced resume/JD in a profile-forbidden answer`,
      severity: 'error',
    });
  }

  const errorCodes = violations.filter(v => v.severity === 'error').map(v => v.code);
  return { ok: errorCodes.length === 0, violations, errorCodes };
}

/* ── Repair instruction builder ───────────────────────────── */

export function buildProfileRepairInstruction(result: ProfileValidationResult): string {
  if (result.ok) return '';
  const lines: string[] = [];
  for (const code of new Set(result.errorCodes)) {
    switch (code) {
      case 'false_no_access_refusal':
        lines.push("- You DO have the user's profile. Answer the question directly from it; never say you lack access to their information.");
        break;
      case 'false_no_experience_refusal':
        lines.push("- The user's real experience is in the profile. Answer from it; never claim you have no personal experience.");
        break;
      case 'assistant_identity_leak':
        lines.push('- Answer AS the candidate in first person ("My name is ...", "I worked on ..."). Never say you are Natively or an AI.');
        break;
      case 'wrong_perspective_not_first_person':
        lines.push('- Use first person ("I", "my"). Do not describe the user in third person.');
        break;
      case 'sensitive_salary_leak':
        lines.push('- Remove all salary, compensation, and negotiation-strategy details; they do not belong in this answer.');
        break;
      case 'profile_in_generic_answer':
        lines.push('- This is a technical answer. Remove any mention of the resume, job description, or personal profile.');
        break;
    }
  }
  return lines.length
    ? `Your previous answer broke these rules. Regenerate, fixing ONLY these:\n${lines.join('\n')}`
    : '';
}
