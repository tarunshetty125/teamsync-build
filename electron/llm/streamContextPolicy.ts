// electron/llm/streamContextPolicy.ts
// Controls what context is injected during streaming based on the answer plan.

import type { AnswerPlan } from './AnswerPlanner';

/**
 * Whether the profile-intelligence intercept (resume injection) is allowed
 * for this answer route. Returns false if 'resume' is in the forbidden layers.
 */
export function profileInterceptAllowedByRoute(route: Pick<AnswerPlan, 'forbiddenContextLayers'> | undefined): boolean {
  const forbidden = route?.forbiddenContextLayers;
  if (!forbidden || forbidden.length === 0) return true;
  return !forbidden.includes('resume');
}

/**
 * Returns the answerType from the route, defaulting to 'general_meeting_answer'.
 */
export function modeAnswerType(route: Pick<AnswerPlan, 'answerType'> | undefined): string {
  return route?.answerType ?? 'general_meeting_answer';
}
