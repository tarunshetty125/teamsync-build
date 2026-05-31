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
}
