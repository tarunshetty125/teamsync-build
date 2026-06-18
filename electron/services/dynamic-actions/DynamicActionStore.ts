// electron/services/dynamic-actions/DynamicActionStore.ts
// In-memory store for dynamic actions within a session.
// Handles deduplication, expiration, and status transitions.

import type { DynamicAction, ActionStatus } from './DynamicAction';

export class DynamicActionStore {
  private actions = new Map<string, DynamicAction>();

  /** Add a new action to the store. */
  addAction(action: DynamicAction): void {
    this.actions.set(action.id, action);
  }

  /** Update the status of an action by ID. */
  updateStatus(id: string, status: ActionStatus): void {
    const action = this.actions.get(id);
    if (action) {
      action.status = status;
    }
  }

  /** Get all active (non-expired, non-completed, non-dismissed) actions for a session. */
  getActiveActions(sessionId: string): DynamicAction[] {
    const now = Date.now();
    return Array.from(this.actions.values()).filter(
      action =>
        action.sessionId === sessionId &&
        action.status !== 'expired' &&
        action.status !== 'completed' &&
        action.status !== 'dismissed' &&
        (!action.expiresAt || action.expiresAt > now),
    );
  }

  /** Expire stale candidate actions older than maxAgeMs. */
  expireStaleActions(sessionId: string, maxAgeMs: number): void {
    const now = Date.now();
    const cutoff = now - maxAgeMs;
    for (const action of this.actions.values()) {
      if (
        action.sessionId === sessionId &&
        action.createdAt < cutoff &&
        action.status === 'candidate'
      ) {
        action.status = 'expired';
      }
    }
  }

  /** Deduplicate: returns null if a matching action exists within the time window. */
  deduplicate(newAction: DynamicAction, windowMs = 120_000): DynamicAction | null {
    const now = Date.now();
    const windowStart = now - windowMs;
    for (const existing of this.actions.values()) {
      if (
        existing.sessionId === newAction.sessionId &&
        existing.modeId === newAction.modeId &&
        existing.type === newAction.type &&
        existing.status !== 'expired' &&
        existing.status !== 'dismissed' &&
        existing.createdAt > windowStart
      ) {
        return null; // Duplicate within window
      }
    }
    return newAction;
  }

  /** Get a single action by ID. */
  getAction(id: string): DynamicAction | undefined {
    return this.actions.get(id);
  }

  /** Get all actions for a session (regardless of status). */
  getAllActions(sessionId: string): DynamicAction[] {
    return Array.from(this.actions.values()).filter(
      action => action.sessionId === sessionId,
    );
  }
}
