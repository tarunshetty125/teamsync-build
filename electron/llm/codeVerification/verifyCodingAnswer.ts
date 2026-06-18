// electron/llm/codeVerification/verifyCodingAnswer.ts
// Top-level orchestrator for the code verification pipeline.
// Extracts code + spec from the LLM answer, runs test cases locally,
// and optionally triggers a correction round if the first attempt fails.

import {
  extractCodeBlock, extractVerificationSpec, parseProblemExamples,
  mergeTestCases, normalizeLanguage, inferLanguageFromText,
} from './extractTests';
import { isLocallyRunnable, smokeCase } from './drivers';
import { renderValue } from './judge';
import { runCase, runSqlCase, localLanguageAvailable } from './localRunner';
import type {
  TestCase, CaseResult, DriverHints, SqlSpec,
  VerificationVerdict, VerificationResult,
} from './types';

/* ── Types ────────────────────────────────────────────────── */

export interface VerifyCodingOpts {
  answer: string;
  question?: string;
  screenText?: string;
  correct?: (repairPrompt: string) => Promise<string>;
  onEvent?: (event: string, data?: Record<string, any>) => void;
  runCase?: typeof runCase;
  runSql?: typeof runSqlCase;
  languageAvailable?: typeof localLanguageAvailable;
}

/* ── Helpers ──────────────────────────────────────────────── */

const emptyVerdict = (skipReason: string, language?: string): VerificationVerdict => ({
  passed: false, skipped: true, skipReason, language, results: [], total: 0, passedCount: 0,
});

const executeAll = async (
  language: string, code: string, entry: string, cases: TestCase[],
  run: typeof runCase, hints?: DriverHints,
): Promise<VerificationVerdict> => {
  const results: CaseResult[] = [];
  for (const tc of cases) {
    results.push(await run(language, code, entry, tc, hints));
  }
  const firstFailure = results.find(r => r.status !== 'pass');
  const passedCount = results.filter(r => r.status === 'pass').length;
  return {
    passed: results.length > 0 && !firstFailure,
    skipped: false, language, backend: 'local',
    results, firstFailure, total: results.length, passedCount,
  };
};

const nowMs = (): number => {
  try { const p = globalThis.performance; if (p?.now) return p.now(); } catch { /* noop */ }
  return Date.now();
};

const guessEntry = (code: string, language: string): string => {
  if (language === 'python') {
    const defs = [...code.matchAll(/^\s*def\s+([A-Za-z_]\w*)\s*\(/gm)]
      .map(m => m[1]).filter(n => n !== '__init__');
    return defs.find(n => !n.startsWith('_')) || defs[0] || '';
  }
  if (language === 'javascript' || language === 'typescript') {
    const fn = code.match(/function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (fn) return fn[1];
    const arrow = code.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/);
    if (arrow) return arrow[1];
    const method = code.match(/^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/m);
    return method ? method[1] : '';
  }
  return '';
};

/* ── Repair prompt builders ───────────────────────────────── */

const buildRepairPrompt = (
  question: string | undefined, code: string, language: string, failure: CaseResult,
): string => {
  const f = failure;
  const what = f.status === 'error'
    ? `it failed to run: ${f.error}`
    : `for input ${renderValue(f.case.input)} it returned ${renderValue(f.actual)} but the correct output is ${renderValue(f.case.expected)}`;
  return `Your previous ${language} solution is INCORRECT — ${what}.

${question ? `Problem:\n${question}\n\n` : ''}Your code:
\`\`\`${language}
${code}
\`\`\`

Fix ONLY the bug so the function returns the correct output for that input (and all others). Keep the SAME six-section coding format (## Approach / ## Technique / Data Structure / Algorithm Used / ## Code / ## Dry Run / ## Complexity / ## Interviewer Follow-up Points) and re-emit the hidden <verification_spec> with the same cases. Do not change the function name. Output the full corrected answer.`;
};

const buildSqlRepairPrompt = (
  question: string | undefined, query: string, expected: any, actual: any,
): string =>
`Your SQL query returned a different result set than expected.

${question ? `Problem:\n${question}\n\n` : ''}Your query:
\`\`\`sql
${query}
\`\`\`

Expected rows: ${renderValue(expected, 400)}
Your query returned: ${renderValue(actual, 400)}

Fix the query to produce EXACTLY the expected rows. Keep the same six-section coding format and re-emit the hidden <verification_spec> with the same schema/seeds/expected (language "sql"). Output the full corrected answer.`;

/* ── Main orchestrator ────────────────────────────────────── */

export const verifyCodingAnswer = async (opts: VerifyCodingOpts): Promise<VerificationResult> => {
  const run = opts.runCase ?? runCase;
  const runSql = opts.runSql ?? runSqlCase;
  const langAvailable = opts.languageAvailable ?? localLanguageAvailable;
  const emit = opts.onEvent ?? (() => {});

  try {
    emit('code_verify_started');
    const { spec } = extractVerificationSpec(opts.answer);
    const codeBlock = extractCodeBlock(opts.answer);

    if (!codeBlock.code) {
      emit('code_verify_skipped', { reason: 'no_code' });
      return { verdict: emptyVerdict('no_code') };
    }

    // Resolve language
    const declaredRaw = (spec?.declaredLanguageRaw ?? '').trim() || (codeBlock.declaredTag ?? '').trim();
    const declaredLang = declaredRaw ? normalizeLanguage(declaredRaw) : null;
    if (declaredRaw && !declaredLang) {
      emit('code_verify_skipped', { reason: 'unsupported_language', declared: declaredRaw.slice(0, 24) });
      return { verdict: emptyVerdict('unsupported_language') };
    }
    const language = declaredLang || inferLanguageFromText(`${opts.question || ''}\n${opts.answer}`);
    if (!language) {
      emit('code_verify_skipped', { reason: 'unknown_language' });
      return { verdict: emptyVerdict('unsupported_language') };
    }

    // SQL path
    if (language === 'sql') {
      if (!spec?.sql || !Array.isArray(spec.sql.schema) || spec.sql.schema.length === 0 || !Array.isArray(spec.sql.expected)) {
        emit('code_verify_skipped', { reason: 'no_sql_spec' });
        return { verdict: emptyVerdict('no_spec', 'sql') };
      }
      if (!await langAvailable('sql')) {
        emit('code_verify_skipped', { reason: 'runtime_unavailable', language: 'sql' });
        return { verdict: emptyVerdict('runtime_unavailable', 'sql') };
      }
      emit('tests_extracted', { count: 1, language: 'sql', rows: spec.sql.expected.length });
      const t0sql = nowMs();
      const sqlResult = await runSql(codeBlock.code, spec.sql);
      emit('code_executed', { language: 'sql', backend: 'local', ms: nowMs() - t0sql, status: sqlResult.status });
      const sqlVerdict: VerificationVerdict = {
        passed: sqlResult.status === 'pass', skipped: false, language: 'sql', backend: 'local',
        results: [sqlResult], firstFailure: sqlResult.status === 'pass' ? undefined : sqlResult,
        total: 1, passedCount: sqlResult.status === 'pass' ? 1 : 0,
      };
      if (sqlVerdict.passed) { emit('code_verify_passed', { language: 'sql', total: 1 }); return { verdict: sqlVerdict }; }
      emit('code_verify_failed', { language: 'sql', firstFailureStatus: sqlResult.status });
      if (sqlResult.status !== 'fail' || !opts.correct) return { verdict: sqlVerdict };
      emit('code_correction_used', { language: 'sql' });
      const sqlRepair = buildSqlRepairPrompt(opts.question, codeBlock.code, spec.sql.expected, sqlResult.actual);
      let correctedSqlAnswer = '';
      try { correctedSqlAnswer = await opts.correct(sqlRepair); } catch (e: any) {
        emit('code_correction_error', { message: String(e?.message || e).slice(0, 120) });
        return { verdict: sqlVerdict };
      }
      if (!correctedSqlAnswer.trim()) return { verdict: sqlVerdict };
      const reCode = extractCodeBlock(correctedSqlAnswer);
      const reSpec = extractVerificationSpec(correctedSqlAnswer).spec;
      let reOk = false;
      if (reCode.code && reSpec?.sql) {
        const reRes = await runSql(reCode.code, reSpec.sql);
        reOk = reRes.status === 'pass';
        emit('code_correction_reverified', { passed: reOk });
      }
      return {
        verdict: sqlVerdict,
        corrected: {
          answer: correctedSqlAnswer, reVerifiedPassed: reOk,
          note: reOk ? 'Corrected: the previous query returned a different result set.' : 'The previous query was wrong; this revision may still need review.',
        },
      };
    }

    // Standard code path
    if (!isLocallyRunnable(language)) {
      emit('code_verify_skipped', { reason: 'cloud_language_pending', language });
      return { verdict: emptyVerdict('unsupported_language', language) };
    }
    if (!await langAvailable(language)) {
      emit('code_verify_skipped', { reason: 'runtime_unavailable', language });
      return { verdict: emptyVerdict('runtime_unavailable', language) };
    }
    const entry = spec?.entry || guessEntry(codeBlock.code, language);
    if (!entry) {
      emit('code_verify_skipped', { reason: 'no_entry', language });
      return { verdict: emptyVerdict('no_spec', language) };
    }

    const problemCases = [
      ...parseProblemExamples(opts.question),
      ...parseProblemExamples(opts.screenText),
    ];
    const modelCases = spec?.cases ?? [];
    let cases = mergeTestCases(problemCases, modelCases);
    if (cases.length === 0) cases = [smokeCase()];
    emit('tests_extracted', { count: cases.length, problem: problemCases.length, model: modelCases.length, language });

    const hints: DriverHints = { argTypes: spec?.argTypes, retType: spec?.retType };
    const t0 = nowMs();
    const verdict = await executeAll(language, codeBlock.code, entry, cases, run, hints);
    emit('code_executed', { language, backend: 'local', ms: nowMs() - t0, total: verdict.total, passed: verdict.passedCount });

    if (verdict.passed) { emit('code_verify_passed', { language, total: verdict.total }); return { verdict }; }
    emit('code_verify_failed', { language, firstFailureStatus: verdict.firstFailure?.status });
    if (!opts.correct || !verdict.firstFailure) return { verdict };

    // Correction round
    emit('code_correction_used', { language });
    const repairPrompt = buildRepairPrompt(opts.question, codeBlock.code, language, verdict.firstFailure);
    let correctedAnswer = '';
    try { correctedAnswer = await opts.correct(repairPrompt); } catch (e: any) {
      emit('code_correction_error', { message: String(e?.message || e).slice(0, 120) });
      return { verdict };
    }
    if (!correctedAnswer?.trim()) return { verdict };
    const correctedCode = extractCodeBlock(correctedAnswer);
    const correctedSpec = extractVerificationSpec(correctedAnswer);
    const correctedEntry = correctedSpec.spec?.entry || entry;
    let reVerifiedPassed = false;
    if (correctedCode.code) {
      const reHints: DriverHints = { argTypes: correctedSpec.spec?.argTypes ?? hints.argTypes, retType: correctedSpec.spec?.retType ?? hints.retType };
      const reVerdict = await executeAll(language, correctedCode.code, correctedEntry, cases, run, reHints);
      reVerifiedPassed = reVerdict.passed;
      emit('code_correction_reverified', { passed: reVerifiedPassed, total: reVerdict.total });
    }
    const f = verdict.firstFailure;
    const note = reVerifiedPassed
      ? `Corrected: the previous code ${f.status === 'error' ? 'failed to run' : `returned ${renderValue(f.actual)} for input ${renderValue(f.case.input)}`}.`
      : `The previous code ${f.status === 'error' ? 'failed to run' : `was wrong for input ${renderValue(f.case.input)}`}; this revision may still need review.`;
    return { verdict, corrected: { answer: correctedAnswer, reVerifiedPassed, note } };

  } catch (e: any) {
    emit('code_verify_error', { message: String(e?.message || e).slice(0, 120) });
    return { verdict: emptyVerdict('no_spec') };
  }
};
