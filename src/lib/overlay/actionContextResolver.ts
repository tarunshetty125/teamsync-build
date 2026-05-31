import type { ActionContract, ContextTarget, ResponseOwnership } from './actionContextTypes';

export interface ActionContextAction {
  id?: string;
  intent: string;
  contextTarget: ContextTarget;
  actionContract?: ActionContract;
  additionalContext?: string;
  message?: string;
}

export interface ActionContextResponse {
  id: string;
  question?: string;
  text?: string;
  ownership?: ResponseOwnership;
  questionTurnId?: string;
}

export interface ActionContextTranscriptSnapshot {
  questionTurnId?: string | null;
  transcriptVersion: number;
  currentTurnText?: string;
  lastFinalSentence?: string;
  finalizedTranscript?: string;
  rollingTranscript?: string;
  mode?: string;
}

export interface ResolvedActionContext {
  contextTarget: ContextTarget;
  requestedContextTarget: ContextTarget;
  previewLabel: string;
  message?: string;
  additionalContext?: string;
  transcriptOverride?: string;
  questionTurnId: string;
  transcriptVersion: number;
  parentResponseId?: string;
  actionContract?: ActionContract;
}

const NO_TRANSCRIPT = '[NO TRANSCRIPT AVAILABLE]';

function latestTurnText(snapshot: ActionContextTranscriptSnapshot): string {
  return (
    snapshot.currentTurnText?.trim()
    || snapshot.lastFinalSentence?.trim()
    || snapshot.finalizedTranscript?.split('  ·  ').filter(Boolean).pop()?.trim()
    || snapshot.rollingTranscript?.split('  ·  ').filter(Boolean).pop()?.trim()
    || ''
  );
}

function formatVisibleTranscript(snapshot: ActionContextTranscriptSnapshot): string {
  const raw = (snapshot.rollingTranscript || snapshot.finalizedTranscript || snapshot.lastFinalSentence || '').trim();
  if (!raw) return NO_TRANSCRIPT;

  const lines = raw
    .split('  ·  ')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => `[INTERVIEWER]: ${segment}`);

  return lines.length > 0 ? lines.join('\n') : NO_TRANSCRIPT;
}

function buildActiveResponseContext(activeResponse: ActionContextResponse): string {
  const question = activeResponse.question?.trim() || '';
  const answer = activeResponse.text?.trim() || '';

  return [
    'ACTIVE RESPONSE CONTEXT:',
    question ? `Original user question: ${question}` : '',
    answer ? `Current answer excerpt: ${answer.slice(0, 1200)}` : '',
    'Apply this action to the active response above, not to unrelated transcript text.',
  ].filter(Boolean).join('\n');
}

export function resolveActionContext(args: {
  action: ActionContextAction;
  latestTurn: ActionContextTranscriptSnapshot;
  activeResponse?: ActionContextResponse | null;
}): ResolvedActionContext {
  const { action, latestTurn, activeResponse } = args;
  const requestedTarget = action.contextTarget;
  const hasActiveResponse = Boolean(activeResponse?.id);
  const effectiveTarget: ContextTarget =
    requestedTarget === 'active_context' && !hasActiveResponse
      ? 'latest_turn'
      : requestedTarget;

  const fallbackTurnText = latestTurnText(latestTurn);
  const fallbackTurnId = latestTurn.questionTurnId || 'unassigned-turn';
  const fallbackVersion = latestTurn.transcriptVersion || 0;
  const contract = action.actionContract && action.actionContract !== 'default'
    ? action.actionContract
    : undefined;

  if (effectiveTarget === 'transcript') {
    return {
      contextTarget: 'transcript',
      requestedContextTarget: requestedTarget,
      previewLabel: 'Meeting Transcript',
      message: action.message?.trim() || undefined,
      additionalContext: action.additionalContext?.trim() || undefined,
      transcriptOverride: formatVisibleTranscript(latestTurn),
      questionTurnId: fallbackTurnId,
      transcriptVersion: fallbackVersion,
      actionContract: contract,
    };
  }

  if (effectiveTarget === 'active_context' && activeResponse) {
    const responseQuestion = activeResponse.question?.trim() || fallbackTurnText;
    const activeContext = buildActiveResponseContext(activeResponse);
    const responseOwnership = activeResponse.ownership;

    return {
      contextTarget: 'active_context',
      requestedContextTarget: requestedTarget,
      previewLabel: 'Current Response',
      message: action.message?.trim() || responseQuestion || undefined,
      additionalContext: [
        action.additionalContext?.trim(),
        activeContext,
      ].filter(Boolean).join('\n\n') || undefined,
      transcriptOverride: NO_TRANSCRIPT,
      questionTurnId:
        responseOwnership?.questionTurnId
        || activeResponse.questionTurnId
        || fallbackTurnId,
      transcriptVersion:
        responseOwnership?.transcriptVersion
        ?? fallbackVersion,
      parentResponseId: activeResponse.id,
      actionContract: contract,
    };
  }

  return {
    contextTarget: 'latest_turn',
    requestedContextTarget: requestedTarget,
    previewLabel: 'Latest Question',
    message: action.message?.trim() || (action.intent === 'recap' ? undefined : fallbackTurnText || undefined),
    additionalContext: action.additionalContext?.trim() || undefined,
    transcriptOverride: formatVisibleTranscript(latestTurn),
    questionTurnId: fallbackTurnId,
    transcriptVersion: fallbackVersion,
    actionContract: contract,
  };
}
