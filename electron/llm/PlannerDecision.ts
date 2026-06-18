// electron/llm/PlannerDecision.ts
// Decides what the assistant should do next: answer, brainstorm, clarify, recap, or stay silent.

/* ── Pattern library ──────────────────────────────────────── */

const QUESTION_PATTERN    = /\b(what|how|why|where|when|which|who|can you|could you|tell me|explain|describe|walk me through|talk me through|should i|would you)\b/i;
const BRAINSTORM_PATTERN  = /\b(brainstorm|options|strategy|ways to solve|possible solutions)\b/i;
const CLARIFY_PATTERN     = /\b(clarify|not clear|ambiguous|what do they mean|ask a follow|scope|constraints?)\b/i;
const RESTATEMENT_PATTERN = /\b(sorry[,\s]+let me (?:restate|restart|say that again)|let me (?:restate|restart|say that again)|i(?:'| a)?m going to restate|that came out wrong|not what i meant)\b/i;
const INCOMPLETE_TECHNICAL_PATTERN = /\b(the thing|unclear|not clear|missing|incomplete|ambiguous|contradictory|constraints? (?:are )?unclear|input unclear|output unclear|not sure|audio cut|didn(?:'|o)?t catch|garbled)\b/i;
const RECAP_PATTERN       = /\b(recap|summari[sz]e|catch me up|what happened|key points|takeaways)\b/i;
const FOLLOW_UP_PATTERN   = /\b(follow[- ]?up questions?|questions should i ask|what should i ask|ask next)\b/i;

/* ── Types ────────────────────────────────────────────────── */

export type ActionKind = 'answer' | 'brainstorm' | 'clarify' | 'recap' | 'follow_up_questions' | 'silent';

export interface PlannerInput {
  triggerQuestion?: string;
  transcriptContext?: string;
  confidence?: number;
  intentResult?: { intent?: string; confidence?: number };
  hasImages?: boolean;
  hasDetectedCodingQuestion?: boolean;
  now?: number;
  cooldownMs?: number;
  lastTriggerTime?: number;
}

export interface PlannerOutput {
  kind: ActionKind;
  reason: string;
  confidence: number;
}

/* ── Helpers ──────────────────────────────────────────────── */

function normalize(text: string | undefined): string {
  return (text ?? '').trim();
}

function hasQuestionSignal(text: string): boolean {
  return text.endsWith('?') || QUESTION_PATTERN.test(text);
}

function intentSupportsAnswer(intent: string | undefined): boolean {
  return intent === 'coding' || intent === 'behavioral' ||
         intent === 'deep_dive' || intent === 'example_request' ||
         intent === 'follow_up' || intent === 'clarification' ||
         intent === 'general';
}

/* ── Main Function ────────────────────────────────────────── */

export function planNextAssistantAction(input: PlannerInput): PlannerOutput {
  const text = normalize(input.triggerQuestion || input.transcriptContext);
  const confidence = input.confidence || input.intentResult?.confidence || 0;
  const now = input.now ?? Date.now();
  const cooldownMs = input.cooldownMs ?? 3000;
  const lastTriggerTime = input.lastTriggerTime ?? 0;

  // No context
  if (!text && !input.hasImages) {
    return { kind: 'silent', reason: 'no_context', confidence };
  }
  // Cooldown
  if (!input.hasImages && now - lastTriggerTime < cooldownMs) {
    return { kind: 'silent', reason: 'cooldown', confidence };
  }
  // Low confidence
  if (confidence < 0.5 && !input.hasImages) {
    return { kind: 'silent', reason: 'low_confidence', confidence };
  }
  // Incomplete technical restatement
  if (RESTATEMENT_PATTERN.test(text) && INCOMPLETE_TECHNICAL_PATTERN.test(text)) {
    return { kind: 'clarify', reason: 'incomplete_technical_restatement', confidence };
  }
  // Recap
  if (RECAP_PATTERN.test(text)) {
    return { kind: 'recap', reason: 'recap_request', confidence };
  }
  // Follow-up questions
  if (FOLLOW_UP_PATTERN.test(text)) {
    return { kind: 'follow_up_questions', reason: 'follow_up_questions_request', confidence };
  }
  // Clarify
  if (CLARIFY_PATTERN.test(text)) {
    return { kind: 'clarify', reason: 'clarify_request', confidence };
  }
  // Brainstorm / Visual
  if (BRAINSTORM_PATTERN.test(text) || input.hasImages || input.hasDetectedCodingQuestion) {
    return { kind: 'brainstorm', reason: input.hasImages ? 'visual_problem_context' : 'strategy_request', confidence };
  }
  // Answerable question
  if (intentSupportsAnswer(input.intentResult?.intent) || hasQuestionSignal(text)) {
    return { kind: 'answer', reason: 'answerable_question', confidence };
  }

  return { kind: 'silent', reason: 'no_actionable_question', confidence };
}
