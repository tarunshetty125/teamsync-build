// electron/llm/contextRoute.ts
// Routes context to the right prompt slot based on the answer plan.
// Assigns per-layer token budgets and builds a context route summary.

import type { AnswerPlan, ContextLayer } from './AnswerPlanner';

/* ── All known context layers ─────────────────────────────── */

const ALL_LAYERS: ContextLayer[] = [
  'stable_identity', 'resume', 'jd', 'custom_context', 'ai_persona',
  'negotiation', 'reference_files', 'live_transcript',
  'prior_assistant_responses', 'active_mode', 'screen_context', 'preferred_language',
];

/** Token budget per layer (approx max tokens allowed). */
const LAYER_BUDGET: Record<ContextLayer, number> = {
  stable_identity: 200,
  resume: 1200,
  jd: 800,
  custom_context: 600,
  ai_persona: 200,
  negotiation: 600,
  reference_files: 1200,
  live_transcript: 1500,
  prior_assistant_responses: 600,
  active_mode: 800,
  screen_context: 1200,
  preferred_language: 50,
};

/* ── Types ────────────────────────────────────────────────── */

export interface LayerDecision {
  layer: ContextLayer;
  selected: boolean;
  reason: string;
  tokenBudget: number;
}

export interface ContextRoute {
  answerType: string;
  selectedLayers: ContextLayer[];
  excludedLayers: ContextLayer[];
  layers: LayerDecision[];
  maxTotalPromptTokens: number;
}

export interface ContextRouteSummary {
  answerType: string;
  selected: ContextLayer[];
  excluded: ContextLayer[];
  maxTotalPromptTokens: number;
}

/* ── Builders ─────────────────────────────────────────────── */

export function buildContextRoute(plan: Pick<AnswerPlan, 'answerType' | 'requiredContextLayers' | 'forbiddenContextLayers'>): ContextRoute {
  const required = new Set(plan.requiredContextLayers);
  const forbidden = new Set(plan.forbiddenContextLayers);

  const layers: LayerDecision[] = ALL_LAYERS.map(layer => {
    if (forbidden.has(layer)) {
      return { layer, selected: false, reason: 'forbidden_by_answer_type', tokenBudget: 0 };
    }
    if (required.has(layer)) {
      return { layer, selected: true, reason: 'required_by_answer_type', tokenBudget: LAYER_BUDGET[layer] ?? 400 };
    }
    return { layer, selected: false, reason: 'not_required_by_answer_type', tokenBudget: 0 };
  });

  const selectedLayers = layers.filter(l => l.selected).map(l => l.layer);
  const excludedLayers = layers.filter(l => !l.selected).map(l => l.layer);
  const maxTotalPromptTokens = Math.max(
    1200,
    layers.reduce((sum, l) => sum + l.tokenBudget, 0) + 1200, // + headroom for system prompt/question
  );

  return { answerType: plan.answerType, selectedLayers, excludedLayers, layers, maxTotalPromptTokens };
}

export function isLayerAllowed(plan: Pick<AnswerPlan, 'forbiddenContextLayers'>, layer: ContextLayer): boolean {
  return !plan.forbiddenContextLayers.includes(layer);
}

export function summarizeContextRoute(route: ContextRoute): ContextRouteSummary {
  return {
    answerType: route.answerType,
    selected: route.selectedLayers,
    excluded: route.excludedLayers,
    maxTotalPromptTokens: route.maxTotalPromptTokens,
  };
}
