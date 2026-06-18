// electron/llm/codeVerification/types.ts
// Shared types for the code verification engine.

/** A single test case for function verification. */
export interface TestCase {
  input: any[];
  expected?: any;
  source: 'model' | 'problem' | 'smoke';
}

/** Result of running a single test case. */
export interface CaseResult {
  case: TestCase;
  status: 'pass' | 'fail' | 'error';
  stdout: string;
  actual?: any;
  error?: string;
  ms: number;
}

/** SQL spec embedded in <verification_spec>. */
export interface SqlSpec {
  schema: string[];
  seeds: string[];
  expected: Record<string, any>[];
  ordered: boolean;
}

/** Parsed verification spec from model answer. */
export interface VerificationSpec {
  entry: string;
  language: string;
  declaredLanguageRaw?: string;
  cases: TestCase[];
  argTypes?: ('value' | 'list' | 'tree')[];
  retType?: 'value' | 'list' | 'tree';
  sql?: SqlSpec;
}

/** Hints for arg/return type conversion (ListNode, TreeNode). */
export interface DriverHints {
  argTypes?: ('value' | 'list' | 'tree')[];
  retType?: 'value' | 'list' | 'tree';
}

/** Built driver info for interpreter-based languages. */
export interface DriverInfo {
  localCmd: string;
  ext: string;
  source: string;
}

/** Signature parsed from compiled-language source code. */
export interface ParsedSignature {
  returnType: string;
  params: string[];
}

/** Overall verdict from the verification pipeline. */
export interface VerificationVerdict {
  passed: boolean;
  skipped: boolean;
  skipReason?: string;
  language?: string;
  backend?: string;
  results: CaseResult[];
  firstFailure?: CaseResult;
  total: number;
  passedCount: number;
}

/** Corrected answer with re-verification result. */
export interface CorrectedAnswer {
  answer: string;
  reVerifiedPassed: boolean;
  note: string;
}

/** Full result from verifyCodingAnswer. */
export interface VerificationResult {
  verdict: VerificationVerdict;
  corrected?: CorrectedAnswer;
}
