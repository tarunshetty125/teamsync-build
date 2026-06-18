// electron/services/toggleStateReducer.ts
// Pure-function reducers for overlay toggle & dock-icon transition state.

export interface ToggleResult {
  next: boolean;
  changed: boolean;
  broadcast: boolean;
}

export interface DockTransitionResult {
  shouldApply: boolean;
  next: boolean;
}

/** Decide whether a toggle state change should be applied and broadcast. */
export function decideToggle(current: boolean, requested: boolean): ToggleResult {
  return {
    next: requested,
    changed: current !== requested,
    broadcast: true,
  };
}

/** Decide whether a dock-icon transition should be applied. */
export function decideDockTransition(settled: boolean, lastApplied: boolean): DockTransitionResult {
  return {
    shouldApply: settled !== lastApplied,
    next: settled,
  };
}
