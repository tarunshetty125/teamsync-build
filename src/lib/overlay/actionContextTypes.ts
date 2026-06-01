export type ContextTarget = 'latest_turn' | 'active_context' | 'transcript';

export type ActionContract =
  | 'default'
  | 'hint_only'
  | 'complexity_only'
  | 'edge_cases_only'
  | 'debugging_only'
  | 'bruteforce_only'
  | 'optimal_solution'
  | 'followup_questions_only';

export function normalizeActionContract(actionContract?: ActionContract | null): ActionContract | undefined {
  if (!actionContract || actionContract === 'default') return undefined;
  return actionContract;
}

export function resolveEffectiveActionContract(args: {
  intent?: string | null;
  actionId?: string | null;
  actionContract?: ActionContract | null;
}): ActionContract | undefined {
  const explicitContract = normalizeActionContract(args.actionContract);
  if (explicitContract) return explicitContract;

  const intent = (args.intent || '').trim();
  const actionId = (args.actionId || '').trim();

  if (intent === 'code_hint' || actionId === 'tech_hint') {
    return 'hint_only';
  }

  return undefined;
}

export function actionContractAllowsCode(actionContract?: ActionContract | null): boolean {
  const effectiveContract = normalizeActionContract(actionContract);
  return !(
    effectiveContract === 'hint_only'
    || effectiveContract === 'complexity_only'
    || effectiveContract === 'edge_cases_only'
    || effectiveContract === 'debugging_only'
    || effectiveContract === 'followup_questions_only'
  );
}

export interface ResponseOwnership {
  responseId: string;
  questionTurnId: string;
  transcriptVersion: number;
  contextTarget: ContextTarget;
  actionId?: string;
  parentResponseId?: string;
  mode?: string;
  createdAt: number;
  sourceProvider?: string;
  sourceModel?: string;
  requestedProvider?: string;
  requestedModel?: string;
  actualProvider?: string;
  actualModel?: string;
  routingReason?: string;
  resolvedCodingLanguage?: string;
  providerPreference?: string;
  responseStyle?: string;
  interviewFocus?: string;
  personalizationVersion?: number;
}
