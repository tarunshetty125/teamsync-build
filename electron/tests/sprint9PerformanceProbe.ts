import { performance } from 'node:perf_hooks';

export type PerformanceClassification = 'PASS' | 'WARN' | 'CEILING_EXCEEDED';

export interface PerformanceBenchmarkResult {
    area: string;
    case: string;
    size: string;
    min: number;
    avg: number;
    max: number;
    p95: number;
    budget: number;
    ceiling: number;
    classification: PerformanceClassification;
    optimizationTarget?: string;
}

export interface PerformanceBenchmarkInput {
    area: string;
    case: string;
    size: string;
    budgetMs: number;
    ceilingMs: number;
    run: () => unknown | Promise<unknown>;
    iterations?: number;
    warmupIterations?: number;
    optimizationTarget?: string;
}

export interface PerformanceBenchmarkReportRow {
    area: string;
    case: string;
    size: string;
    min: number;
    avg: number;
    max: number;
    p95: number;
    budget: number;
    ceiling: number;
    classification: PerformanceClassification;
    optimizationTarget?: string;
}

function roundMs(value: number): number {
    return Math.round(value * 100) / 100;
}

function percentile(sortedValues: number[], percentileValue: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.min(
        sortedValues.length - 1,
        Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1),
    );
    return sortedValues[index];
}

function classifyPerformance(p95: number, max: number, budgetMs: number, ceilingMs: number): PerformanceClassification {
    if (max > ceilingMs) return 'CEILING_EXCEEDED';
    if (p95 > budgetMs) return 'WARN';
    return 'PASS';
}

export async function measurePerformanceCase(input: PerformanceBenchmarkInput): Promise<PerformanceBenchmarkResult> {
    const iterations = input.iterations ?? 12;
    const warmupIterations = input.warmupIterations ?? 2;
    const durations: number[] = [];

    for (let index = 0; index < warmupIterations; index += 1) {
        await input.run();
    }

    for (let index = 0; index < iterations; index += 1) {
        const startedAt = performance.now();
        await input.run();
        durations.push(performance.now() - startedAt);
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const avg = durations.length > 0
        ? durations.reduce((sum, value) => sum + value, 0) / durations.length
        : 0;
    const p95 = percentile(sorted, 0.95);
    const classification = classifyPerformance(p95, max, input.budgetMs, input.ceilingMs);

    return {
        area: input.area,
        case: input.case,
        size: input.size,
        min: roundMs(min),
        avg: roundMs(avg),
        max: roundMs(max),
        p95: roundMs(p95),
        budget: input.budgetMs,
        ceiling: input.ceilingMs,
        classification,
        ...(classification !== 'PASS' && input.optimizationTarget
            ? { optimizationTarget: input.optimizationTarget }
            : {}),
    };
}

export function formatPerformanceReportRows(
    results: PerformanceBenchmarkResult[],
): PerformanceBenchmarkReportRow[] {
    return results.map((result) => ({
        area: result.area,
        case: result.case,
        size: result.size,
        min: result.min,
        avg: result.avg,
        max: result.max,
        p95: result.p95,
        budget: result.budget,
        ceiling: result.ceiling,
        classification: result.classification,
        ...(result.optimizationTarget ? { optimizationTarget: result.optimizationTarget } : {}),
    }));
}

export function printPerformanceReport(results: PerformanceBenchmarkResult[]): void {
    console.table(formatPerformanceReportRows(results));
}
