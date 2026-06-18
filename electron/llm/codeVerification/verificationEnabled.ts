// electron/llm/codeVerification/verificationEnabled.ts
// Feature flag for the code verification engine.
// Checks env NATIVELY_CODE_VERIFY and SettingsManager.

let cachedEnv: boolean | null = null;

const envDisabled = (): boolean => {
  if (cachedEnv !== null) return cachedEnv;
  let off = false;
  try {
    const v = (process.env.NATIVELY_CODE_VERIFY || '').trim().toLowerCase();
    off = v === 'off' || v === 'false' || v === '0' || v === 'disabled';
  } catch {
    off = false;
  }
  cachedEnv = off;
  return off;
};

/** Returns true if code verification is enabled. Defaults to true. */
export const isCodeVerificationEnabled = (): boolean => {
  if (envDisabled()) return false;
  try {
    const { SettingsManager } = require('../../services/SettingsManager');
    const v = SettingsManager.getInstance().get('codeVerificationEnabled');
    if (v === false) return false;
  } catch {
    // SettingsManager not available — default enabled
  }
  return true;
};

/** Reset the env cache — useful for testing. */
export const __resetCodeVerificationCache = (): void => {
  cachedEnv = null;
};
