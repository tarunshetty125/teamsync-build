// electron/llm/triggerGate.ts
// Controls when auto-triggers fire — throttles rapid re-triggers.

export interface TriggerGateInput {
  hasImages: boolean;
  isSpeculative: boolean;
  skipCooldown: boolean;
  now: number;
  lastTriggerTime: number;
  triggerCooldown: number;
}

/**
 * Returns true if the trigger should be throttled (suppressed).
 * Images, speculative requests, and explicit skip-cooldown bypass throttling.
 */
export function shouldThrottleTrigger(input: TriggerGateInput): boolean {
  const { hasImages, isSpeculative, skipCooldown, now, lastTriggerTime, triggerCooldown } = input;
  if (hasImages || isSpeculative || skipCooldown) return false;
  return now - lastTriggerTime < triggerCooldown;
}
