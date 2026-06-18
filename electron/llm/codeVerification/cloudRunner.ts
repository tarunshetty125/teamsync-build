// electron/llm/codeVerification/cloudRunner.ts
// Cloud execution via Piston API (currently only language "c").
// Gated by env NATIVELY_CODE_EXECUTION_CLOUD and SettingsManager data-scope policy.

import type { TestCase, CaseResult } from './types';

export const CLOUD_LANGUAGES = ['c'];

const DEFAULT_PISTON_URL = 'https://emkc.org/api/v2/piston';

export const cloudExecutionEnabled = (): boolean => {
  try {
    if (process.env.NATIVELY_CODE_EXECUTION_CLOUD !== 'true') return false;
    const { SettingsManager } = require('../../services/SettingsManager');
    const policy = SettingsManager.getInstance().get('providerDataScopes');
    return policy?.code_execution !== false;
  } catch {
    return false;
  }
};

export const pistonUrl = (): string => {
  try {
    return process.env.NATIVELY_PISTON_URL || DEFAULT_PISTON_URL;
  } catch {
    return DEFAULT_PISTON_URL;
  }
};

export const runCaseCloud = async (
  language: string,
  _code: string,
  _entry: string,
  tc: TestCase,
): Promise<CaseResult> => {
  if (!cloudExecutionEnabled()) {
    return { case: tc, status: 'error', stdout: '', error: 'cloud_execution_disabled', ms: 0 };
  }
  // Placeholder — cloud runner not yet wired to Piston
  return { case: tc, status: 'error', stdout: '', error: `cloud_runner_pending:${language}`, ms: 0 };
};
