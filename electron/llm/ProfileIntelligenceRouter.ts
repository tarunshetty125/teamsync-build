// electron/llm/ProfileIntelligenceRouter.ts
// Top-level profile-intelligence decision layer.
// Combines AnswerPlanner + contextRoute to decide:
//  - Whether the profile should be used for this answer
//  - Which profile context types to include/exclude
//  - What answer perspective to use (first-person, generic AI, etc.)
//  - What fallback behavior to apply when profile is missing

import { planAnswer, type AnswerPlan, type ContextLayer, type SpeakerPerspective } from './AnswerPlanner';
import { buildContextRoute } from './contextRoute';

/* ── Profile answer types (answers that use resume/profile data) ── */

const PROFILE_ANSWER_TYPES = new Set([
  'identity_answer', 'profile_fact_answer', 'project_answer',
  'project_followup_answer', 'skills_answer', 'skill_experience_answer',
  'experience_answer', 'jd_fit_answer', 'behavioral_interview_answer',
  'negotiation_answer',
]);

/* ── Profile context type mapping ─────────────────────────── */

const LAYER_TO_TYPES: Record<string, string[]> = {
  stable_identity: ['identity'],
  resume: ['resume_summary', 'experience', 'projects', 'skills', 'education', 'achievements'],
  jd: ['job_description'],
  custom_context: ['custom_context_pinned', 'custom_context_searchable'],
  ai_persona: ['ai_persona_style'],
  negotiation: ['negotiation_strategy', 'salary_context'],
  reference_files: ['reference_files'],
  live_transcript: ['live_transcript'],
  prior_assistant_responses: [],
  active_mode: [],
  screen_context: ['screen_context'],
  preferred_language: [],
};

const ALL_PROFILE_CONTEXT_TYPES = [
  'identity', 'resume_summary', 'experience', 'projects', 'skills',
  'education', 'achievements', 'star_stories', 'job_description',
  'company_context', 'gap_analysis', 'mock_questions',
  'negotiation_strategy', 'salary_context',
  'custom_context_pinned', 'custom_context_searchable', 'custom_context_sensitive',
  'reference_files', 'live_transcript', 'screen_context', 'ai_persona_style',
];

/* ── Helpers ──────────────────────────────────────────────── */

function expandLayers(layers: ContextLayer[]): Set<string> {
  const out = new Set<string>();
  for (const layer of layers) {
    for (const t of LAYER_TO_TYPES[layer] || []) out.add(t);
  }
  return out;
}

/* ── Answer perspective ───────────────────────────────────── */

export type AnswerPerspective = 'first_person_user' | 'assistant_coach' | 'generic_ai';

function perspectiveFor(answerType: string, speakerPerspective: string, source: string): AnswerPerspective {
  const genericTypes = [
    'coding_question_answer', 'dsa_question_answer', 'technical_concept_answer',
    'system_design_answer', 'debugging_question_answer', 'sales_answer',
    'lecture_answer', 'general_meeting_answer',
  ];
  if (genericTypes.includes(answerType)) return 'generic_ai';
  if (answerType === 'negotiation_answer' && source === 'what_to_answer') return 'assistant_coach';
  if (PROFILE_ANSWER_TYPES.has(answerType)) {
    // Profile answers are always first-person from the user's perspective
    return 'first_person_user';
  }
  return 'generic_ai';
}

/* ── Types ────────────────────────────────────────────────── */

export type FallbackBehavior = 'ground_in_profile' | 'answer_without_profile' | 'profile_missing_admit_no_data';

export interface ProfileIntelligenceInput {
  question: string;
  source: string;
  speakerPerspective?: SpeakerPerspective;
  profileAvailable?: boolean;
  jdAvailable?: boolean;
}

export interface ProfileIntelligenceResult {
  shouldUseProfile: boolean;
  reason: string;
  answerType: string;
  answerPerspective: AnswerPerspective;
  profileContextPolicy: string;
  profileContextTypes: string[];
  excludedContextTypes: string[];
  sensitiveContextAllowed: boolean;
  confidence: number;
  fallbackBehavior: FallbackBehavior;
}

/* ── Main Decision Function ───────────────────────────────── */

export function decideProfileIntelligence(input: ProfileIntelligenceInput): ProfileIntelligenceResult {
  const plan = planAnswer({
    question: input.question,
    source: input.source,
    speakerPerspective: input.speakerPerspective,
    hasCandidateProfile: input.profileAvailable,
  });

  const route = buildContextRoute(plan);
  const answerType = plan.answerType;
  const isProfileType = PROFILE_ANSWER_TYPES.has(answerType);
  const resumeForbidden = plan.forbiddenContextLayers.includes('resume');
  const shouldUseProfile = isProfileType && !resumeForbidden;
  const sensitiveContextAllowed = answerType === 'negotiation_answer';

  // Expand selected layers to profile context types
  const included = expandLayers(route.selectedLayers);

  // Add special context types per answer type
  if (sensitiveContextAllowed && route.selectedLayers.includes('custom_context')) {
    included.add('custom_context_sensitive');
  }
  if (answerType === 'negotiation_answer') {
    included.add('company_context');
    included.add('salary_context');
  }
  if (answerType === 'behavioral_interview_answer') {
    included.add('star_stories');
  }
  if (answerType === 'jd_fit_answer') {
    included.add('company_context');
    included.add('gap_analysis');
  }

  const profileContextTypes = ALL_PROFILE_CONTEXT_TYPES.filter(t => included.has(t));
  const excludedContextTypes = ALL_PROFILE_CONTEXT_TYPES.filter(t => !included.has(t));
  const answerPerspective = perspectiveFor(answerType, plan.speakerPerspective, input.source);

  const reason = shouldUseProfile
    ? `${answerType}: profile used (${profileContextTypes.length} context types)`
    : `${answerType}: profile NOT used (${resumeForbidden ? 'resume forbidden for this answer type' : 'non-profile answer type'})`;

  const fallbackBehavior: FallbackBehavior =
    input.profileAvailable === false && isProfileType
      ? 'profile_missing_admit_no_data'
      : shouldUseProfile
        ? 'ground_in_profile'
        : 'answer_without_profile';

  return {
    shouldUseProfile,
    reason,
    answerType,
    answerPerspective,
    profileContextPolicy: plan.profileContextPolicy,
    profileContextTypes,
    excludedContextTypes,
    sensitiveContextAllowed,
    confidence: plan.confidence,
    fallbackBehavior,
  };
}
