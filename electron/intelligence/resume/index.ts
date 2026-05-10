// electron/intelligence/resume/index.ts
// Barrel export for the resume intelligence module.

export type { FitSignal, ResumeJDAnalysis, ResumeJDInput } from './ResumeJDAnalyzer';
export { analyzeResumeJDFit, isAnalysisUsable } from './ResumeJDAnalyzer';
