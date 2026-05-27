import type {
  OverlayCopilotModeId,
  OverlayQuickActionId,
  OverlayRecommendationId,
  SessionOverlayMode,
} from '../modes/overlayCopilotConfig';
import {
  getMatchedRecommendedOverlayAction,
  getRecommendedOverlayAction,
} from '../modes/overlayCopilotConfig.ts';

export type ResolveRecommendationOptions = {
  detectedQuestionType?: SessionOverlayMode;
};

/** Cross-mode transcript signals — first visible candidate wins. */
const UNIVERSAL_TRANSCRIPT_SIGNALS: Array<{
  patterns: RegExp[];
  candidates: OverlayQuickActionId[];
}> = [
  {
    patterns: [/tell me about yourself/i, /introduce yourself/i, /walk me through your background/i],
    candidates: ['what_to_answer', 'job_star', 'sales_discovery', 'lecture_explain', 'recruiting_strength'],
  },
  {
    patterns: [/\bsummari[sz]e\b/i, /\brecap\b/i, /\boverview\b/i, /\btl;dr\b/i],
    candidates: ['recap', 'lecture_summary', 'team_action_item', 'lecture_takeaway'],
  },
  {
    patterns: [/explain/i, /what is/i, /how does/i, /how do/i, /clarif/i, /mean by/i, /walk me through/i],
    candidates: ['clarify', 'lecture_explain', 'system_clarify', 'tech_hint', 'sales_discovery'],
  },
  {
    patterns: [/\bfollow.?up\b/i, /\bnext question\b/i, /then what/i, /\bgo deeper\b/i],
    candidates: ['follow_up_questions', 'recruiting_follow_up', 'sales_discovery', 'lecture_question'],
  },
  {
    patterns: [/price/i, /pricing/i, /budget/i, /cost/i, /roi/i, /discount/i, /expensive/i, /quote/i],
    candidates: ['sales_pricing', 'sales_negotiation'],
  },
  {
    patterns: [/\bobjection\b/i, /\btoo expensive\b/i, /\bconcern\b/i, /\bhesitant\b/i, /\bpushback\b/i],
    candidates: ['sales_objection', 'recruiting_red_flag'],
  },
  {
    patterns: [/\bnegotia/i, /\bprocurement\b/i, /\bterms\b/i],
    candidates: ['sales_negotiation', 'sales_pricing', 'salary_negotiate'],
  },
  {
    patterns: [/\bpain point\b/i, /\bworkflow\b/i, /\bdiscovery\b/i, /\buse case\b/i],
    candidates: ['sales_discovery', 'lecture_question'],
  },
  {
    patterns: [/implement/i, /write (?:a )?function/i, /coding/i, /algorithm/i, /leetcode/i, /solve/i, /how would you/i, /data struct/i, /hash ?map/i, /binary search/i, /array/i, /tree/i, /graph/i],
    candidates: ['tech_optimal_solution', 'tech_hint'],
  },
  {
    patterns: [/complex/i, /big o/i, /time complex/i, /space complex/i, /runtime/i, /efficien/i],
    candidates: ['tech_complexity'],
  },
  {
    patterns: [/\bedge case\b/i, /\bcorner case\b/i, /\btest case\b/i],
    candidates: ['tech_edge_case'],
  },
  {
    patterns: [/system design/i, /design (?:a |the |this )?system/i, /architect/i, /scale/i, /scalability/i, /microservice/i, /api design/i, /database design/i],
    candidates: ['system_tradeoffs', 'system_approaches', 'system_deep_dive'],
  },
  {
    patterns: [/trade[\s-]?off/i, /latency/i, /throughput/i, /reliab/i, /shard/i, /cache/i, /load balanc/i, /high traffic/i, /million users/i],
    candidates: ['system_tradeoffs', 'system_deep_dive'],
  },
  {
    patterns: [/\bred flag\b/i, /\bweakness\b/i, /\bconcern about\b/i],
    candidates: ['recruiting_red_flag', 'job_improvement'],
  },
  {
    patterns: [/\bhire\b/i, /\blevel\b/i, /\bseniority\b/i, /\bfit for\b/i],
    candidates: ['recruiting_evaluation', 'recruiting_strength'],
  },
  {
    patterns: [/\baction item\b/i, /\bnext step\b/i, /\btodo\b/i, /\bowner\b/i],
    candidates: ['team_action_item', 'team_owner', 'team_decision'],
  },
  {
    patterns: [/\bblocker\b/i, /\brisk\b/i, /\bdependency\b/i],
    candidates: ['team_risk', 'team_action_item'],
  },
  {
    patterns: [/\bresume\b/i, /\bbackground\b/i, /\bexperience aligned\b/i],
    candidates: ['job_resume_alignment', 'recruiting_strength'],
  },
  {
    patterns: [/\btell me about a time\b/i, /\bstar\b/i, /\bbehavioral\b/i],
    candidates: ['job_star', 'what_to_answer', 'recruiting_follow_up'],
  },
  {
    patterns: [/\bnervous\b/i, /\bconfidence\b/i, /\bhow do i sound\b/i],
    candidates: ['job_confidence'],
  },
  {
    patterns: [/\bimprove\b/i, /\bbetter answer\b/i, /\bweak answer\b/i],
    candidates: ['job_improvement', 'recruiting_red_flag'],
  },
  {
    patterns: [/\btakeaway\b/i, /\bkey point\b/i, /\bmain idea\b/i],
    candidates: ['lecture_takeaway', 'lecture_summary'],
  },
  {
    patterns: [/confused/i, /don.?t understand/i, /question/i, /not sure/i, /what do you mean/i],
    candidates: ['lecture_question', 'clarify', 'system_clarify'],
  },
  {
    patterns: [/stuck/i, /hint/i, /nudge/i, /struggling/i],
    candidates: ['tech_hint', 'clarify'],
  },
  {
    patterns: [/example/i, /experience/i, /project/i, /challenge/i, /impact/i],
    candidates: ['what_to_answer', 'job_star', 'recruiting_strength', 'sales_discovery'],
  },
  {
    patterns: [/salary/i, /compensation/i, /\bcomp\b/i, /\bctc\b/i, /total comp/i, /package/i, /\boffer\b/i],
    candidates: ['salary_negotiate', 'salary_counter', 'salary_anchor', 'sales_pricing'],
  },
  {
    patterns: [/counter.?offer/i, /too low/i, /higher/i, /raise/i, /increase/i, /bump/i, /more money/i],
    candidates: ['salary_counter', 'salary_negotiate', 'sales_negotiation'],
  },
  {
    patterns: [/anchor/i, /first number/i, /market rate/i, /band/i, /range/i],
    candidates: ['salary_anchor', 'salary_negotiate'],
  },
];

/**
 * Per-mode intent fallback — used when mode-specific rules + universal signals miss.
 * Ensures template-locked modes (sales, lecture, …) still react to transcript classifier.
 */
const MODE_INTENT_VISIBLE_PREFERENCE: Partial<
  Record<OverlayCopilotModeId, Partial<Record<SessionOverlayMode, OverlayQuickActionId[]>>>
> = {
  general: {
    coding: ['what_to_answer', 'clarify'],
    system_design: ['what_to_answer', 'clarify'],
    behavioral: ['what_to_answer', 'follow_up_questions'],
    follow_up: ['follow_up_questions', 'clarify'],
  },
  behavioral: {
    behavioral: ['what_to_answer', 'follow_up_questions'],
    follow_up: ['follow_up_questions', 'what_to_answer'],
  },
  coding: {
    coding: ['tech_optimal_solution', 'tech_hint', 'tech_complexity', 'tech_edge_case'],
  },
  'technical-interview': {
    coding: ['tech_optimal_solution', 'tech_hint', 'tech_complexity', 'tech_edge_case'],
    system_design: ['system_tradeoffs', 'system_clarify', 'system_approaches'],
    behavioral: ['what_to_answer', 'follow_up_questions'],
    follow_up: ['follow_up_questions', 'clarify'],
  },
  system_design: {
    system_design: ['system_tradeoffs', 'system_approaches', 'system_deep_dive', 'system_clarify'],
  },
  follow_up: {
    follow_up: ['follow_up_questions', 'clarify'],
    behavioral: ['what_to_answer', 'follow_up_questions'],
  },
  salary: {
    salary: ['salary_negotiate', 'salary_counter', 'salary_confidence', 'salary_anchor'],
    general: ['salary_negotiate', 'salary_anchor'],
    behavioral: ['salary_negotiate', 'salary_confidence'],
  },
  sales: {
    general: ['sales_discovery', 'sales_objection'],
    behavioral: ['sales_discovery', 'sales_objection'],
    follow_up: ['sales_negotiation', 'sales_discovery'],
    coding: ['sales_discovery', 'sales_objection'],
    system_design: ['sales_discovery', 'sales_objection'],
  },
  lecture: {
    general: ['lecture_explain', 'lecture_summary'],
    behavioral: ['lecture_explain', 'lecture_takeaway'],
    follow_up: ['lecture_question', 'lecture_summary'],
    coding: ['lecture_explain', 'lecture_question'],
    system_design: ['lecture_explain', 'lecture_takeaway'],
  },
  recruiting: {
    general: ['recruiting_strength', 'recruiting_follow_up'],
    behavioral: ['recruiting_strength', 'recruiting_follow_up'],
    follow_up: ['recruiting_follow_up', 'recruiting_evaluation'],
    coding: ['recruiting_strength', 'recruiting_follow_up'],
    system_design: ['recruiting_evaluation', 'recruiting_strength'],
  },
  'team-meet': {
    general: ['team_action_item', 'team_decision'],
    follow_up: ['team_action_item', 'team_owner'],
    behavioral: ['team_decision', 'team_action_item'],
    system_design: ['team_risk', 'team_decision'],
  },
  'looking-for-work': {
    behavioral: ['job_star', 'job_resume_alignment'],
    general: ['job_star', 'job_resume_alignment'],
    follow_up: ['job_star', 'job_confidence'],
    coding: ['tech_optimal_solution', 'tech_hint'],
    system_design: ['system_tradeoffs', 'system_approaches'],
  },
};

const GLOBAL_INTENT_VISIBLE_PREFERENCE: Record<SessionOverlayMode, OverlayQuickActionId[]> = {
  coding: ['tech_optimal_solution', 'tech_hint', 'tech_complexity', 'tech_edge_case'],
  system_design: ['system_tradeoffs', 'system_clarify', 'system_approaches', 'system_deep_dive'],
  behavioral: ['what_to_answer', 'job_star', 'follow_up_questions', 'clarify', 'recap', 'brainstorm'],
  follow_up: ['follow_up_questions', 'clarify', 'what_to_answer'],
  salary: ['salary_negotiate', 'salary_counter', 'salary_confidence', 'salary_anchor'],
  general: ['what_to_answer', 'clarify', 'follow_up_questions', 'recap', 'brainstorm'],
};

const RECOMMENDATION_ALIASES: Partial<Record<OverlayRecommendationId, OverlayQuickActionId[]>> = {
  answer_now: ['what_to_answer', 'job_star'],
};

function firstVisible(
  candidates: OverlayQuickActionId[],
  visible: Set<OverlayQuickActionId>,
): OverlayQuickActionId | null {
  for (const id of candidates) {
    if (visible.has(id)) return id;
  }
  return null;
}

function clampRecommendation(
  candidate: OverlayRecommendationId,
  visibleActionIds: OverlayQuickActionId[],
): OverlayQuickActionId | null {
  const visible = new Set(visibleActionIds);
  if (visible.has(candidate as OverlayQuickActionId)) {
    return candidate as OverlayQuickActionId;
  }
  const aliases = RECOMMENDATION_ALIASES[candidate];
  if (aliases) {
    return firstVisible(aliases, visible);
  }
  return null;
}

function matchUniversalTranscript(
  combinedText: string,
  visibleActionIds: OverlayQuickActionId[],
): OverlayQuickActionId | null {
  if (!combinedText.trim()) return null;
  const visible = new Set(visibleActionIds);
  for (const signal of UNIVERSAL_TRANSCRIPT_SIGNALS) {
    if (!signal.patterns.some((p) => p.test(combinedText))) continue;
    const hit = firstVisible(signal.candidates, visible);
    if (hit) return hit;
  }
  return null;
}

function matchModeIntent(
  modeId: OverlayCopilotModeId,
  detected: SessionOverlayMode | undefined,
  visibleActionIds: OverlayQuickActionId[],
): OverlayQuickActionId | null {
  if (!detected || detected === 'general') return null;
  const visible = new Set(visibleActionIds);

  const modePrefs = MODE_INTENT_VISIBLE_PREFERENCE[modeId]?.[detected];
  if (modePrefs) {
    const hit = firstVisible(modePrefs, visible);
    if (hit) return hit;
  }

  const globalPrefs = GLOBAL_INTENT_VISIBLE_PREFERENCE[detected];
  if (globalPrefs) {
    return firstVisible(globalPrefs, visible);
  }

  return null;
}

/**
 * Resolves auto-highlight for any copilot mode — always returns a visible quick-action id.
 */
export function resolveRecommendedOverlayAction(
  modeId: OverlayCopilotModeId,
  combinedText: string,
  visibleActionIds: OverlayQuickActionId[],
  options?: ResolveRecommendationOptions,
): OverlayQuickActionId {
  if (visibleActionIds.length === 0) {
    return 'what_to_answer';
  }

  const matchedModeRule = getMatchedRecommendedOverlayAction(modeId, combinedText);
  if (matchedModeRule) {
    const clampedMode = clampRecommendation(matchedModeRule, visibleActionIds);
    if (clampedMode) return clampedMode;
  }

  const fromUniversal = matchUniversalTranscript(combinedText, visibleActionIds);
  if (fromUniversal) return fromUniversal;

  const fromIntent = matchModeIntent(modeId, options?.detectedQuestionType, visibleActionIds);
  if (fromIntent) return fromIntent;

  const configDefault = getRecommendedOverlayAction(modeId, '');
  const defaultClamped = clampRecommendation(configDefault, visibleActionIds);
  if (defaultClamped) return defaultClamped;

  return visibleActionIds[0];
}
