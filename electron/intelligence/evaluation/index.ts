// electron/intelligence/evaluation/index.ts
// Barrel export for the evaluation module.

export type { QualityIssue, QualityRule } from './QualityRules';
export { QUALITY_RULES, getRulesForBrain, meetsMinDepth } from './QualityRules';

export type { QualityEvaluationInput, QualityEvaluationResult } from './ResponseQualityEvaluator';
export {
    evaluateResponseQuality,
    isQualityAcceptable,
    getMostCriticalIssue,
} from './ResponseQualityEvaluator';
