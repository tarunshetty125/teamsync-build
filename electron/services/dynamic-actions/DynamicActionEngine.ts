// electron/services/dynamic-actions/DynamicActionEngine.ts
// Top-level orchestrator for the Dynamic Actions system.
// Combines DynamicActionDetector (pattern matching) with DynamicActionStore
// (lifecycle management) to detect, deduplicate, rank, and manage actions.

import * as crypto from 'crypto';
import type { DynamicAction } from './DynamicAction';
import { DynamicActionStore } from './DynamicActionStore';
import { DynamicActionDetector, MODE_TRIGGERS } from './DynamicActionDetector';

export interface DetectActionsParams {
  transcript: string;
  speaker?: string;
  modeTemplateType: string;
  modeId: string;
  sessionId: string;
}

export class DynamicActionEngine {
  private store: DynamicActionStore;
  private detector: DynamicActionDetector;

  constructor(
    store = new DynamicActionStore(),
    detector = new DynamicActionDetector(MODE_TRIGGERS),
  ) {
    this.store = store;
    this.detector = detector;
  }

  /**
   * Scan transcript for trigger matches, create DynamicActions,
   * deduplicate, and return new candidate actions.
   */
  detectActions(params: DetectActionsParams): DynamicAction[] {
    const { transcript, speaker, modeTemplateType, modeId, sessionId } = params;
    const now = Date.now();
    const candidateActions: DynamicAction[] = [];

    const matchedTriggers = this.detector.detectTriggers({ transcript, modeTemplateType });

    for (const { trigger, match } of matchedTriggers) {
      const evidenceRef = {
        source: 'transcript' as const,
        text: transcript,
        timestamp: now,
        speaker,
      };

      const action: DynamicAction = {
        id: `action_${crypto.randomUUID()}`,
        sessionId,
        modeId,
        modeTemplateType,
        type: trigger.type,
        label: trigger.label,
        description: `Triggered by: "${match}"`,
        confidence: trigger.priority,
        priority: trigger.priority,
        evidenceRefs: [evidenceRef],
        status: 'candidate',
        createdAt: now,
        promptInstruction: trigger.promptInstruction,
        answerStyle: trigger.answerStyle,
      };

      const deduplicatedAction = this.store.deduplicate(action);
      if (deduplicatedAction) {
        candidateActions.push(deduplicatedAction);
        this.store.addAction(deduplicatedAction);
      }
    }

    return candidateActions;
  }

  /** Get the top N (default 3) highest-priority active actions, expiring stale ones first. */
  getTopActions(sessionId: string, maxAgeMs = 60_000): DynamicAction[] {
    this.store.expireStaleActions(sessionId, maxAgeMs);
    const activeActions = this.store.getActiveActions(sessionId);
    return activeActions
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 3);
  }

  /** Accept an action (user clicked it). Returns the action or null. */
  acceptAction(actionId: string): DynamicAction | null {
    const action = this.store.getAction(actionId);
    if (action) {
      this.store.updateStatus(actionId, 'accepted');
      return action;
    }
    return null;
  }

  /** Dismiss an action (user swiped it away). */
  dismissAction(actionId: string): void {
    this.store.updateStatus(actionId, 'dismissed');
  }

  /** Mark an action as completed. */
  completeAction(actionId: string): void {
    this.store.updateStatus(actionId, 'completed');
  }

  /** Access the underlying store. */
  getStore(): DynamicActionStore {
    return this.store;
  }

  /** Access the underlying detector. */
  getDetector(): DynamicActionDetector {
    return this.detector;
  }
}
