// electron/services/context/TrustLevels.ts
// Hierarchical trust levels for prompt context blocks.
// Higher trust = more influence over the LLM response.

export enum TrustLevel {
  SYSTEM_POLICY = 'system_policy',
  MODE_POLICY = 'mode_policy',
  DEVELOPER_POLICY = 'developer_policy',
  USER_PREFERENCES = 'user_preferences',
  TRUSTED_PROFILE = 'trusted_profile',
  ASSISTANT_HISTORY = 'assistant_history',
  UNTRUSTED_SCREEN = 'untrusted_screen',
  UNTRUSTED_TRANSCRIPT = 'untrusted_transcript',
  UNTRUSTED_REFERENCE = 'untrusted_reference',
  UNTRUSTED_MEETING_HISTORY = 'untrusted_meeting_history',
}

/** Trust levels ordered from highest (system) to lowest (meeting history). */
export const TRUST_LEVEL_ORDER: TrustLevel[] = [
  TrustLevel.SYSTEM_POLICY,
  TrustLevel.MODE_POLICY,
  TrustLevel.DEVELOPER_POLICY,
  TrustLevel.USER_PREFERENCES,
  TrustLevel.TRUSTED_PROFILE,
  TrustLevel.ASSISTANT_HISTORY,
  TrustLevel.UNTRUSTED_SCREEN,
  TrustLevel.UNTRUSTED_TRANSCRIPT,
  TrustLevel.UNTRUSTED_REFERENCE,
  TrustLevel.UNTRUSTED_MEETING_HISTORY,
];

/** Prompt-injection detection patterns. */
export const DANGEROUS_PATTERNS: RegExp[] = [
  /ignore\s*(previous|all)\s*instructions/i,
  /disregard\s*(previous|all)\s*(instructions|prompts)/i,
  /you\s*(are\s*now|should)\s*act\s+as/i,
  /system\s*prompt:/i,
  /\[INST\]\[INST\]/i,
];

/** Returns true if the text contains a known prompt-injection pattern. */
export function containsPromptInjection(text: string): boolean {
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(text));
}
