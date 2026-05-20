import Store from 'electron-store';

export interface BenchmarkRecord {
    id: string;
    timestamp: number;
    model: string;
    provider: string;
    mode: string;
    intent: string;
    latencyMs: number;
    totalLatencyMs: number;
    promptBeforeTokens: number;
    promptAfterTokens: number;
    compressionRatio: number;
    inputTokens: number;
    outputTokens: number;
    responseLength: number;
    cacheHit: boolean;
    fallbackUsed: boolean;
    retryCount: number;
    confidenceSignalPresent: boolean;
    structuredOutputCompliant: boolean;
    hallucinationIndicatorCount: number;
    qualityScore: number | null;
}

export interface BenchmarkSummaryBucket {
    count: number;
    avgLatencyMs: number;
    avgTotalLatencyMs: number;
    avgCompressionRatio: number;
    avgInputTokens: number;
    avgOutputTokens: number;
    avgQualityScore: number | null;
}

interface BenchmarkStoreState {
    version: number;
    records: BenchmarkRecord[];
}

const STORE_VERSION = 1;
const STORE_NAME = 'teamsync-benchmarks';
const MAX_RECORDS = 100;

function round(value: number, digits: number = 0): number {
    const scale = Math.pow(10, digits);
    return Math.round(value * scale) / scale;
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeRecords(records: BenchmarkRecord[]): BenchmarkSummaryBucket {
    const qualityScores = records
        .map((record) => record.qualityScore)
        .filter((value): value is number => typeof value === 'number');

    return {
        count: records.length,
        avgLatencyMs: round(average(records.map((record) => record.latencyMs))),
        avgTotalLatencyMs: round(average(records.map((record) => record.totalLatencyMs))),
        avgCompressionRatio: round(average(records.map((record) => record.compressionRatio)), 2),
        avgInputTokens: round(average(records.map((record) => record.inputTokens))),
        avgOutputTokens: round(average(records.map((record) => record.outputTokens))),
        avgQualityScore: qualityScores.length > 0 ? round(average(qualityScores), 2) : null,
    };
}

export class BenchmarkManager {
    private static instance: BenchmarkManager | null = null;
    private readonly store: Store<BenchmarkStoreState>;
    private records: BenchmarkRecord[];
    private flushTimer: NodeJS.Timeout | null = null;

    private constructor() {
        this.store = new Store<BenchmarkStoreState>({
            name: STORE_NAME,
            defaults: {
                version: STORE_VERSION,
                records: [],
            },
        });
        this.records = this.store.get('records', []).slice(-MAX_RECORDS);
    }

    public static getInstance(): BenchmarkManager {
        if (!BenchmarkManager.instance) {
            BenchmarkManager.instance = new BenchmarkManager();
        }
        return BenchmarkManager.instance;
    }

    record(record: BenchmarkRecord): void {
        this.records.push(record);
        if (this.records.length > MAX_RECORDS) {
            this.records = this.records.slice(-MAX_RECORDS);
        }

        this.scheduleFlush();

        console.log(
            `[Benchmark] model=${record.model} mode=${record.mode} latency=${record.latencyMs}ms promptBefore=${record.promptBeforeTokens} promptAfter=${record.promptAfterTokens} compression=${Math.round(record.compressionRatio)}% outputTokens=${record.outputTokens}`
        );
    }

    getRecent(limit: number = MAX_RECORDS): BenchmarkRecord[] {
        return this.records.slice(-Math.max(1, limit));
    }

    getSummary(): {
        totalRuns: number;
        byMode: Record<string, BenchmarkSummaryBucket>;
        byModel: Record<string, BenchmarkSummaryBucket>;
        recent: BenchmarkRecord[];
    } {
        const byMode = new Map<string, BenchmarkRecord[]>();
        const byModel = new Map<string, BenchmarkRecord[]>();

        for (const record of this.records) {
            const modeBucket = byMode.get(record.mode) ?? [];
            modeBucket.push(record);
            byMode.set(record.mode, modeBucket);

            const modelKey = `${record.model}__${record.mode}`;
            const modelBucket = byModel.get(modelKey) ?? [];
            modelBucket.push(record);
            byModel.set(modelKey, modelBucket);
        }

        return {
            totalRuns: this.records.length,
            byMode: Object.fromEntries(
                Array.from(byMode.entries()).map(([mode, records]) => [mode, summarizeRecords(records)])
            ),
            byModel: Object.fromEntries(
                Array.from(byModel.entries()).map(([key, records]) => [key, summarizeRecords(records)])
            ),
            recent: this.getRecent(20),
        };
    }

    private scheduleFlush(): void {
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.store.set('records', this.records.slice(-MAX_RECORDS));
        }, 1_000);
    }
}

export function countHallucinationIndicators(text: string, options?: { hasImages?: boolean }): number {
    const normalized = text.toLowerCase();
    let count = 0;

    const certaintyPatterns = [
        /\bdefinitely\b/g,
        /\bguaranteed\b/g,
        /\bobviously\b/g,
    ];

    for (const pattern of certaintyPatterns) {
        count += (normalized.match(pattern) || []).length;
    }

    if (!options?.hasImages) {
        const visualClaimPatterns = [
            /\bon the screen\b/g,
            /\bin the screenshot\b/g,
            /\bi can see\b/g,
            /\bthe image shows\b/g,
        ];
        for (const pattern of visualClaimPatterns) {
            count += (normalized.match(pattern) || []).length;
        }
    }

    return count;
}

export function hasConfidenceSignal(text: string): boolean {
    return /\bconfidence\b/i.test(text) || /"confidence"\s*:/.test(text);
}
