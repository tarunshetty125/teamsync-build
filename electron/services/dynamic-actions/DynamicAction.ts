// electron/services/dynamic-actions/DynamicAction.ts
// Type definitions for the Dynamic Actions system.
// A DynamicAction represents a context-triggered suggestion surfaced to the user
// during a live session (e.g. "Handle pricing objection" during a sales call).

/** Evidence reference linking the action back to its trigger source. */
export interface ActionEvidenceRef {
  source: 'transcript' | 'screen' | 'manual';
  text: string;
  timestamp: number;
  speaker?: string;
}

/** Answer style hints for the LLM when executing the action. */
export interface ActionAnswerStyle {
  maxWords?: number;
  format?: 'short_script' | 'bullets' | 'checklist' | 'code';
  tone?: string;
}

/** Status lifecycle of a dynamic action. */
export type ActionStatus =
  | 'candidate'
  | 'accepted'
  | 'completed'
  | 'dismissed'
  | 'expired';

/** A single dynamic action (trigger-detected suggestion). */
export interface DynamicAction {
  id: string;
  sessionId: string;
  modeId: string;
  modeTemplateType: string;
  type: string;
  label: string;
  description: string;
  confidence: number;
  priority: number;
  evidenceRefs: ActionEvidenceRef[];
  status: ActionStatus;
  createdAt: number;
  expiresAt?: number;
  promptInstruction: string;
  answerStyle?: ActionAnswerStyle;
}

/** Trigger definition: regex patterns mapped to action templates. */
export interface ActionTrigger {
  type: string;
  patterns: RegExp[];
  priority: number;
  label: string;
  promptInstruction: string;
  answerStyle?: ActionAnswerStyle;
}

/** Matched trigger with match context. */
export interface TriggerMatch {
  trigger: ActionTrigger;
  match: string;
  index: number;
}
