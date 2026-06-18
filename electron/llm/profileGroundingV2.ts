// electron/llm/profileGroundingV2.ts
// Feature flag for profile grounding V2.
// Checks env var PROFILE_GROUNDING_V2 and SettingsManager to decide
// whether the V2 evidence-validation pipeline is enabled.

let cachedEnv: boolean | null = null;

const envDisabled = (): boolean => {
  if (cachedEnv !== null) return cachedEnv;
  let off = false;
  try {
    const v = (process.env.PROFILE_GROUNDING_V2 || '').trim().toLowerCase();
    off = v === 'off' || v === 'false' || v === '0' || v === 'disabled';
  } catch {
    off = false;
  }
  cachedEnv = off;
  return off;
};

/**
 * Returns true if profile grounding V2 is enabled.
 * Disabled by:
 *  - env PROFILE_GROUNDING_V2=off|false|0|disabled
 *  - SettingsManager.profileGroundingV2 === false
 * Defaults to enabled (true).
 */
export const isProfileGroundingV2Enabled = (): boolean => {
  if (envDisabled()) return false;
  // SettingsManager integration — lazy-load to avoid circular deps
  try {
    const { SettingsManager } = require('../services/SettingsManager');
    const v = SettingsManager.getInstance().get('profileGroundingV2');
    if (v === false) return false;
  } catch {
    // SettingsManager not available — default to enabled
  }
  return true;
};

/** Reset the env cache — useful for testing. */
export const __resetProfileGroundingV2Cache = (): void => {
  cachedEnv = null;
};
