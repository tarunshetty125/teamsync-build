import {
  getOverlayQuickActions,
  type OverlayActionIntent,
  type OverlayCopilotModeId,
  type OverlayQuickActionDef,
} from '../modes/overlayCopilotConfig';
import type { ActionContract, ContextTarget } from './actionContextTypes';

export type ActionSemanticsTaxonomyCategory =
  | 'user_intent'
  | 'output_shape'
  | 'contract_mode'
  | 'workflow_state';

export type ActionSemanticsAmbiguityLevel = 'none' | 'low' | 'medium' | 'high';

export type ActionSemanticsRuntimeIntent =
  | OverlayActionIntent
  | 'answer_now'
  | 'manual_chat'
  | 'code_hint'
  | 'system_design_tradeoffs'
  | 'screen_scan';

export interface ActionSemanticsEntry {
  actionId: string;
  displayLabel: string;
  taxonomyCategory: ActionSemanticsTaxonomyCategory;
  runtimeIntent: ActionSemanticsRuntimeIntent;
  actionContractMode: ActionContract | 'none';
  outputShape: string;
  validationShape: string;
  repairShape: string;
  tinyPromptShape: string;
  ambiguityLevel: ActionSemanticsAmbiguityLevel;
  ambiguityReason?: string;
  source: 'overlay_quick_action' | 'runtime_action';
  modeIds: string[];
  contextTarget?: ContextTarget;
}

export interface ActionSemanticsSummary {
  totalActions: number;
  taxonomyCounts: Record<ActionSemanticsTaxonomyCategory, number>;
  ambiguityCounts: Record<ActionSemanticsAmbiguityLevel, number>;
}

export interface ActionSemanticsReadModel {
  generatedAt: number;
  actions: ActionSemanticsEntry[];
  byActionId: Record<string, ActionSemanticsEntry>;
  byTaxonomy: Record<ActionSemanticsTaxonomyCategory, ActionSemanticsEntry[]>;
  byAmbiguity: Record<ActionSemanticsAmbiguityLevel, ActionSemanticsEntry[]>;
  summary: ActionSemanticsSummary;
}

export interface BuildActionSemanticsReadModelInput {
  generatedAt?: number;
}

interface ActionSemanticsSource {
  actionId: string;
  displayLabel: string;
  runtimeIntent: ActionSemanticsRuntimeIntent;
  actionContractMode: ActionContract | 'none';
  source: ActionSemanticsEntry['source'];
  modeIds: string[];
  contextTarget?: ContextTarget;
}

const MODE_DISCOVERY_ORDER: OverlayCopilotModeId[] = [
  'general',
  'behavioral',
  'coding',
  'follow_up',
  'system_design',
  'technical-interview',
  'sales',
  'lecture',
  'recruiting',
  'team-meet',
  'looking-for-work',
  'salary',
];

const SUPPLEMENTAL_RUNTIME_ACTIONS: ActionSemanticsSource[] = [
  {
    actionId: 'answer_now',
    displayLabel: 'Answer Now',
    runtimeIntent: 'answer_now',
    actionContractMode: 'none',
    source: 'runtime_action',
    modeIds: ['runtime'],
    contextTarget: 'latest_turn',
  },
  {
    actionId: 'manual_chat',
    displayLabel: 'Manual Chat',
    runtimeIntent: 'manual_chat',
    actionContractMode: 'none',
    source: 'runtime_action',
    modeIds: ['runtime'],
    contextTarget: 'latest_turn',
  },
  {
    actionId: 'screen_scan',
    displayLabel: 'Screen Scan',
    runtimeIntent: 'screen_scan',
    actionContractMode: 'none',
    source: 'runtime_action',
    modeIds: ['runtime'],
    contextTarget: 'latest_turn',
  },
  {
    actionId: 'code_hint',
    displayLabel: 'Code Hint',
    runtimeIntent: 'code_hint',
    actionContractMode: 'hint_only',
    source: 'runtime_action',
    modeIds: ['runtime'],
    contextTarget: 'latest_turn',
  },
  {
    actionId: 'system_design_tradeoffs',
    displayLabel: 'System Design Tradeoffs',
    runtimeIntent: 'system_design_tradeoffs',
    actionContractMode: 'none',
    source: 'runtime_action',
    modeIds: ['runtime'],
    contextTarget: 'latest_turn',
  },
];

const TAXONOMY_OVERRIDES: Record<string, ActionSemanticsTaxonomyCategory> = {
  recap: 'output_shape',
  clarify: 'workflow_state',
  brainstorm: 'output_shape',
  follow_up_questions: 'output_shape',
  tech_hint: 'contract_mode',
  tech_optimal_solution: 'contract_mode',
  tech_complexity: 'contract_mode',
  tech_edge_case: 'contract_mode',
  lecture_summary: 'output_shape',
  lecture_question: 'workflow_state',
  recruiting_follow_up: 'output_shape',
  team_action_item: 'output_shape',
  system_tradeoffs: 'output_shape',
  system_clarify: 'workflow_state',
  system_approaches: 'output_shape',
  system_deep_dive: 'output_shape',
  salary_anchor: 'user_intent',
  answer_now: 'user_intent',
  manual_chat: 'workflow_state',
  screen_scan: 'workflow_state',
  code_hint: 'contract_mode',
  system_design_tradeoffs: 'output_shape',
};

const HIGH_AMBIGUITY_REASONS: Record<string, string> = {};

const MEDIUM_AMBIGUITY_REASONS: Record<string, string> = {
  clarify: 'Generic Clarify means one question for non-coding contexts, but coding-profile clarify keeps a full coding answer contract.',
  brainstorm: 'Generic Brainstorm means approach bullets for non-coding contexts, but coding-profile brainstorm keeps a full coding answer contract.',
};

const LOW_AMBIGUITY_REASONS: Record<string, string> = {
  tech_complexity: 'Runtime intent is clarify, but the explicit complexity_only ActionContract preserves the label.',
  tech_edge_case: 'Runtime intent is brainstorm, but the explicit edge_cases_only ActionContract preserves the label.',
  sales_negotiation: 'Runtime intent is brainstorm, so the label depends on supplemental context for negotiation-specific framing.',
  recruiting_evaluation: 'Runtime intent is brainstorm, so the label depends on supplemental context for evaluation-specific framing.',
  team_owner: 'Runtime intent is brainstorm, so the label depends on supplemental context for ownership-specific framing.',
  job_confidence: 'Runtime intent is brainstorm, so the label depends on supplemental context for coaching-specific framing.',
};

function emptyTaxonomyCounts(): Record<ActionSemanticsTaxonomyCategory, number> {
  return {
    user_intent: 0,
    output_shape: 0,
    contract_mode: 0,
    workflow_state: 0,
  };
}

function emptyAmbiguityCounts(): Record<ActionSemanticsAmbiguityLevel, number> {
  return {
    none: 0,
    low: 0,
    medium: 0,
    high: 0,
  };
}

function emptyTaxonomyBuckets(): Record<ActionSemanticsTaxonomyCategory, ActionSemanticsEntry[]> {
  return {
    user_intent: [],
    output_shape: [],
    contract_mode: [],
    workflow_state: [],
  };
}

function emptyAmbiguityBuckets(): Record<ActionSemanticsAmbiguityLevel, ActionSemanticsEntry[]> {
  return {
    none: [],
    low: [],
    medium: [],
    high: [],
  };
}

function toSource(action: OverlayQuickActionDef, modeId: OverlayCopilotModeId): ActionSemanticsSource {
  return {
    actionId: action.id,
    displayLabel: action.label,
    runtimeIntent: action.intent,
    actionContractMode: action.actionContract ?? 'none',
    source: 'overlay_quick_action',
    modeIds: [modeId],
    contextTarget: action.contextTarget,
  };
}

function discoverOverlayActions(): ActionSemanticsSource[] {
  const byId = new Map<string, ActionSemanticsSource>();

  for (const modeId of MODE_DISCOVERY_ORDER) {
    for (const action of getOverlayQuickActions(modeId, true)) {
      const current = byId.get(action.id);
      if (!current) {
        byId.set(action.id, toSource(action, modeId));
        continue;
      }
      if (!current.modeIds.includes(modeId)) {
        current.modeIds = [...current.modeIds, modeId];
      }
    }
  }

  return [...byId.values()];
}

function resolveTaxonomy(source: ActionSemanticsSource): ActionSemanticsTaxonomyCategory {
  if (TAXONOMY_OVERRIDES[source.actionId]) return TAXONOMY_OVERRIDES[source.actionId];
  if (source.actionContractMode !== 'none') return 'contract_mode';
  if (source.runtimeIntent === 'clarify' || source.runtimeIntent === 'manual_chat' || source.runtimeIntent === 'screen_scan') {
    return 'workflow_state';
  }
  if (source.runtimeIntent === 'recap' || source.runtimeIntent === 'brainstorm' || source.runtimeIntent === 'follow_up_questions') {
    return 'output_shape';
  }
  return 'user_intent';
}

function resolveOutputShape(source: ActionSemanticsSource): string {
  switch (source.actionContractMode) {
    case 'hint_only':
      return 'hint_bullets_no_solution';
    case 'complexity_only':
      return 'complexity_analysis_only';
    case 'edge_cases_only':
      return 'edge_cases_and_tests_only';
    case 'debugging_only':
      return 'debugging_guidance_only';
    case 'bruteforce_only':
      return 'bruteforce_approach_only';
    case 'followup_questions_only':
      return 'follow_up_questions_only';
    case 'optimal_solution':
      return 'strongest_complete_answer_profile_dependent';
    case 'default':
    case 'none':
    default:
      break;
  }

  switch (source.runtimeIntent) {
    case 'recap':
      return 'bullet_summary';
    case 'clarify':
      return 'clarifying_question_or_coding_full_answer';
    case 'brainstorm':
      return 'approach_bullets_or_coding_full_answer';
    case 'follow_up_questions':
      return 'follow_up_question_bullets';
    case 'answer_now':
      return 'direct_answer_profile_dependent';
    case 'manual_chat':
      return 'manual_direct_answer_profile_dependent';
    case 'code_hint':
      return 'coding_hint_only';
    case 'system_design_tradeoffs':
      return 'system_design_tradeoff_bullets';
    case 'screen_scan':
      return 'screen_analysis_or_coding_solution';
    case 'what_to_answer':
    default:
      return source.modeIds.includes('system_design')
        ? 'profile_dependent_answer_may_include_full_architecture'
        : 'structured_answer_profile_dependent';
  }
}

function resolveValidationShape(source: ActionSemanticsSource): string {
  switch (source.actionContractMode) {
    case 'hint_only':
      return 'coding_contract_hint_only';
    case 'complexity_only':
      return 'coding_contract_complexity_only';
    case 'edge_cases_only':
      return 'coding_contract_edge_cases_only';
    case 'debugging_only':
      return 'coding_contract_debugging_only';
    case 'bruteforce_only':
      return 'coding_contract_bruteforce_only';
    case 'followup_questions_only':
      return 'bullet_questions_contract';
    case 'optimal_solution':
      return 'profile_dependent_optimal_contract';
    case 'default':
    case 'none':
    default:
      break;
  }

  switch (source.runtimeIntent) {
    case 'recap':
      return 'recap_bullets';
    case 'clarify':
      return 'one_clarifying_question_or_coding_contract';
    case 'brainstorm':
      return 'brainstorm_bullets_or_coding_contract';
    case 'follow_up_questions':
      return 'bullet_questions';
    case 'answer_now':
    case 'what_to_answer':
      return source.modeIds.includes('system_design')
        ? 'profile_dependent_structured_or_system_design_contract'
        : 'profile_dependent_structured_answer';
    case 'manual_chat':
      return 'direct_answer_or_profile_contract';
    case 'code_hint':
      return 'coding_contract_hint_only';
    case 'system_design_tradeoffs':
      return 'brainstorm_bullets';
    case 'screen_scan':
      return 'screen_direct_answer_or_coding_screen_scan';
    default:
      return 'profile_dependent_structured_answer';
  }
}

function resolveRepairShape(source: ActionSemanticsSource): string {
  switch (source.actionContractMode) {
    case 'hint_only':
      return 'repair_to_hints_only_no_code';
    case 'complexity_only':
      return 'repair_to_complexity_only_no_code';
    case 'edge_cases_only':
      return 'repair_to_edge_cases_only_no_code';
    case 'debugging_only':
      return 'repair_to_debugging_only_no_full_rewrite';
    case 'bruteforce_only':
      return 'repair_to_bruteforce_only_no_optimal_solution';
    case 'followup_questions_only':
      return 'repair_to_questions_only';
    case 'optimal_solution':
      return 'repair_to_originating_profile_contract';
    case 'default':
    case 'none':
    default:
      break;
  }

  switch (source.runtimeIntent) {
    case 'system_design_tradeoffs':
      return 'repair_to_concise_tradeoff_bullets';
    case 'clarify':
      return 'repair_to_one_question_or_coding_contract';
    case 'brainstorm':
      return 'repair_to_bullets_or_coding_contract';
    case 'follow_up_questions':
      return 'repair_to_bullet_questions';
    case 'recap':
      return 'repair_to_bullet_summary';
    case 'code_hint':
      return 'repair_to_hints_only_no_code';
    case 'screen_scan':
      return 'repair_to_screen_or_detected_coding_language_contract';
    case 'manual_chat':
      return 'repair_to_direct_or_profile_contract';
    case 'answer_now':
    case 'what_to_answer':
    default:
      return 'repair_to_profile_dependent_contract';
  }
}

function resolveTinyPromptShape(source: ActionSemanticsSource): string {
  switch (source.actionContractMode) {
    case 'hint_only':
      return 'contract_preserved_hints_only';
    case 'complexity_only':
      return 'contract_preserved_complexity_only';
    case 'edge_cases_only':
      return 'contract_preserved_edge_cases_only';
    case 'debugging_only':
      return 'contract_preserved_debugging_only';
    case 'bruteforce_only':
      return 'contract_preserved_bruteforce_only';
    case 'followup_questions_only':
      return 'contract_preserved_follow_up_questions_only';
    case 'optimal_solution':
      return 'contract_preserved_optimal_solution';
    case 'default':
    case 'none':
    default:
      break;
  }

  switch (source.runtimeIntent) {
    case 'clarify':
      return 'question';
    case 'follow_up_questions':
      return 'questions';
    case 'recap':
      return 'bullets';
    case 'code_hint':
      return 'hint_why_pitfall';
    case 'system_design_tradeoffs':
      return 'compacted_tradeoff_answer';
    case 'screen_scan':
      return 'screen_or_problem_approach_solution';
    case 'brainstorm':
      return 'mode_dependent_brainstorm_format';
    case 'answer_now':
    case 'manual_chat':
    case 'what_to_answer':
    default:
      return 'mode_dependent_answer_format';
  }
}

function resolveAmbiguity(source: ActionSemanticsSource): {
  level: ActionSemanticsAmbiguityLevel;
  reason?: string;
} {
  if (HIGH_AMBIGUITY_REASONS[source.actionId]) {
    return { level: 'high', reason: HIGH_AMBIGUITY_REASONS[source.actionId] };
  }
  if (MEDIUM_AMBIGUITY_REASONS[source.actionId]) {
    return { level: 'medium', reason: MEDIUM_AMBIGUITY_REASONS[source.actionId] };
  }
  if (LOW_AMBIGUITY_REASONS[source.actionId]) {
    return { level: 'low', reason: LOW_AMBIGUITY_REASONS[source.actionId] };
  }
  if (source.actionContractMode !== 'none' && source.runtimeIntent !== 'what_to_answer' && source.runtimeIntent !== 'code_hint') {
    return {
      level: 'low',
      reason: 'Explicit ActionContract preserves the user-facing label despite using a generic runtime intent.',
    };
  }
  return { level: 'none' };
}

function buildEntry(source: ActionSemanticsSource): ActionSemanticsEntry {
  const ambiguity = resolveAmbiguity(source);
  return {
    actionId: source.actionId,
    displayLabel: source.displayLabel,
    taxonomyCategory: resolveTaxonomy(source),
    runtimeIntent: source.runtimeIntent,
    actionContractMode: source.actionContractMode,
    outputShape: resolveOutputShape(source),
    validationShape: resolveValidationShape(source),
    repairShape: resolveRepairShape(source),
    tinyPromptShape: resolveTinyPromptShape(source),
    ambiguityLevel: ambiguity.level,
    ...(ambiguity.reason ? { ambiguityReason: ambiguity.reason } : {}),
    source: source.source,
    modeIds: [...source.modeIds].sort(),
    ...(source.contextTarget ? { contextTarget: source.contextTarget } : {}),
  };
}

export function buildActionSemanticsReadModel(
  input: BuildActionSemanticsReadModelInput = {},
): ActionSemanticsReadModel {
  const sources = [
    ...discoverOverlayActions(),
    ...SUPPLEMENTAL_RUNTIME_ACTIONS,
  ];
  const actions = sources
    .map(buildEntry)
    .sort((left, right) => left.actionId.localeCompare(right.actionId));

  const byActionId: Record<string, ActionSemanticsEntry> = {};
  const byTaxonomy = emptyTaxonomyBuckets();
  const byAmbiguity = emptyAmbiguityBuckets();
  const taxonomyCounts = emptyTaxonomyCounts();
  const ambiguityCounts = emptyAmbiguityCounts();

  for (const action of actions) {
    byActionId[action.actionId] = action;
    byTaxonomy[action.taxonomyCategory].push(action);
    byAmbiguity[action.ambiguityLevel].push(action);
    taxonomyCounts[action.taxonomyCategory] += 1;
    ambiguityCounts[action.ambiguityLevel] += 1;
  }

  return {
    generatedAt: input.generatedAt ?? 0,
    actions,
    byActionId,
    byTaxonomy,
    byAmbiguity,
    summary: {
      totalActions: actions.length,
      taxonomyCounts,
      ambiguityCounts,
    },
  };
}
