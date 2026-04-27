import { SttMetricsSnapshot } from "./SttAdapter";
import { SttSupervisor } from "./SttSupervisor";

export interface SttLoadTestOptions {
  durationMinutes?: number;
  chunkMs?: number;
  sampleRate?: number;
  audioChannelCount?: number;
  failureEveryMs?: number;
  metricsSampleEveryMs?: number;
}

export interface SttLoadTestSample {
  timestamp: number;
  heapUsedMb: number;
  rssMb: number;
  activeProvider: string;
  failoverCount: number;
  transcriptsPerSecond: number;
  averageLatencyMs?: number;
}

export interface SttLoadTestResult {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  injectedFailures: number;
  failoverCountDelta: number;
  memoryUsage: SttLoadTestSample[];
  latencyTrends: Array<{ timestamp: number; provider: string; averageLatencyMs?: number }>;
  finalMetrics: SttMetricsSnapshot;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runSttLoadTest(
  supervisor: SttSupervisor,
  options: SttLoadTestOptions = {},
): Promise<SttLoadTestResult> {
  const durationMs = Math.max(5_000, Math.round((options.durationMinutes ?? 1) * 60_000));
  const chunkMs = Math.max(10, options.chunkMs ?? 20);
  const sampleRate = Math.max(8_000, options.sampleRate ?? 16_000);
  const audioChannelCount = Math.max(1, options.audioChannelCount ?? 1);
  const failureEveryMs = Math.max(1_000, options.failureEveryMs ?? 60_000);
  const metricsSampleEveryMs = Math.max(1_000, options.metricsSampleEveryMs ?? 5_000);

  supervisor.setSampleRate(sampleRate);
  supervisor.setAudioChannelCount(audioChannelCount);

  const before = supervisor.getMetricsSnapshot();
  const startedAt = Date.now();
  const endsAt = startedAt + durationMs;
  const bytesPerChunk = Math.max(2, Math.round((sampleRate * chunkMs) / 1000) * audioChannelCount * 2);
  const chunk = Buffer.alloc(bytesPerChunk);

  let nextFailureAt = startedAt + failureEveryMs;
  let nextSampleAt = startedAt;
  let injectedFailures = 0;
  const memoryUsage: SttLoadTestSample[] = [];
  const latencyTrends: Array<{ timestamp: number; provider: string; averageLatencyMs?: number }> = [];

  while (Date.now() < endsAt) {
    supervisor.write(chunk);

    const now = Date.now();
    if (now >= nextFailureAt) {
      if (supervisor.debugSimulateFailure(undefined, "load_test_intermittent_network_failure")) {
        injectedFailures += 1;
      }
      nextFailureAt += failureEveryMs;
    }

    if (now >= nextSampleAt) {
      const metrics = supervisor.getMetricsSnapshot();
      const currentProvider = metrics.providers.find((provider) => provider.provider === metrics.activeProvider);
      const usage = process.memoryUsage();
      memoryUsage.push({
        timestamp: now,
        heapUsedMb: Number((usage.heapUsed / (1024 * 1024)).toFixed(2)),
        rssMb: Number((usage.rss / (1024 * 1024)).toFixed(2)),
        activeProvider: metrics.activeProvider,
        failoverCount: metrics.failoverCount,
        transcriptsPerSecond: metrics.transcriptsPerSecond,
        averageLatencyMs: currentProvider?.averageLatencyMs,
      });
      latencyTrends.push({
        timestamp: now,
        provider: metrics.activeProvider,
        averageLatencyMs: currentProvider?.averageLatencyMs,
      });
      nextSampleAt += metricsSampleEveryMs;
    }

    await sleep(chunkMs);
  }

  const finalMetrics = supervisor.getMetricsSnapshot();
  return {
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs,
    injectedFailures,
    failoverCountDelta: finalMetrics.failoverCount - before.failoverCount,
    memoryUsage,
    latencyTrends,
    finalMetrics,
  };
}
