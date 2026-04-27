import React, { useEffect, useMemo, useState } from 'react';

type Channel = 'user' | 'interviewer';

interface SttTelemetryData {
    type: 'provider_started' | 'provider_failed' | 'failover_triggered' | 'debug_failure_injected';
    provider: string;
    channel: Channel;
    sourceLabel: string;
    timestamp: number;
    reason?: string;
    nextProvider?: string;
    consecutiveFailures?: number;
    disabledUntil?: number | null;
    replayBufferEntries?: number;
    replayBufferDurationMs?: number;
}

interface SttMetricsData {
    channel: Channel;
    sourceLabel: string;
    activeProvider: string;
    started: boolean;
    replayInProgress: boolean;
    pendingWrites: number;
    replayBufferEntries: number;
    replayBufferDurationMs: number;
    failoverCount: number;
    totalTranscripts: number;
    totalFinalTranscripts: number;
    transcriptsPerSecond: number;
    providers: Array<{
        provider: string;
        starts: number;
        transcripts: number;
        finalTranscripts: number;
        failures: number;
        failovers: number;
        successRate: number;
        cooldownUntil: number | null;
        lastLatencyMs?: number;
        averageLatencyMs?: number;
    }>;
}

interface SttRuntimePanelProps {
    sttUserStatus: 'connected' | 'reconnecting' | 'failed';
    sttUserError: string;
    sttUserProvider: string;
    sttInterviewerStatus: 'connected' | 'reconnecting' | 'failed';
    sttInterviewerError: string;
    sttInterviewerProvider: string;
    sttTelemetry: { user: SttTelemetryData | null; interviewer: SttTelemetryData | null };
    sttMetrics: { user: SttMetricsData | null; interviewer: SttMetricsData | null };
}

interface LogLine {
    id: string;
    message: string;
}

const SttRuntimePanel: React.FC<SttRuntimePanelProps> = ({
    sttUserStatus,
    sttUserError,
    sttUserProvider,
    sttInterviewerStatus,
    sttInterviewerError,
    sttInterviewerProvider,
    sttTelemetry,
    sttMetrics,
}) => {
    const [debugEnabled, setDebugEnabled] = useState(false);
    const [logs, setLogs] = useState<LogLine[]>([]);
    const [validationRunning, setValidationRunning] = useState(false);
    const [loadTestRunning, setLoadTestRunning] = useState(false);

    const appendLog = (message: string) => {
        setLogs((prev) => {
            const next = [...prev, { id: `${Date.now()}-${Math.random()}`, message }];
            return next.slice(-18);
        });
    };

    useEffect(() => {
        window.electronAPI.getSttDebugEnabled().then(setDebugEnabled).catch(() => {});
    }, []);

    useEffect(() => {
        if (!sttTelemetry.user) return;
        appendLog(`[mic] ${sttTelemetry.user.type} ${sttTelemetry.user.provider}${sttTelemetry.user.nextProvider ? ` -> ${sttTelemetry.user.nextProvider}` : ''}${sttTelemetry.user.reason ? ` :: ${sttTelemetry.user.reason}` : ''}`);
    }, [sttTelemetry.user]);

    useEffect(() => {
        if (!sttTelemetry.interviewer) return;
        appendLog(`[system] ${sttTelemetry.interviewer.type} ${sttTelemetry.interviewer.provider}${sttTelemetry.interviewer.nextProvider ? ` -> ${sttTelemetry.interviewer.nextProvider}` : ''}${sttTelemetry.interviewer.reason ? ` :: ${sttTelemetry.interviewer.reason}` : ''}`);
    }, [sttTelemetry.interviewer]);

    const toggleDebug = async () => {
        const next = !debugEnabled;
        const result = await window.electronAPI.setSttDebugEnabled(next);
        if (result.success) {
            setDebugEnabled(!!result.enabled);
            appendLog(`STT_DEBUG=${result.enabled ? 'true' : 'false'}`);
        }
    };

    const runValidation = async () => {
        setValidationRunning(true);
        try {
            const result = await window.electronAPI.runSttFailoverValidation('interviewer');
            appendLog(`[validation] ${result.success ? 'pass' : 'fail'} ${result.beforeProvider} -> ${result.afterProvider}`);
            result.logs.forEach((line) => appendLog(`[validation] ${line}`));
        } finally {
            setValidationRunning(false);
        }
    };

    const triggerFailure = async () => {
        await window.electronAPI.sttDebugSimulateFailure('interviewer', 'deepgram', 'panel_forced_failure');
        appendLog('[validation] forced Deepgram failure');
    };

    const primeReplay = async () => {
        const result = await window.electronAPI.sttDebugPrimeReplayBuffer('interviewer', 4000);
        appendLog(`[validation] replay primed entries=${result.entryCount || 0} duration=${result.durationMs || 0}ms`);
    };

    const runLoadTest = async () => {
        setLoadTestRunning(true);
        try {
            const result = await window.electronAPI.runSttLoadTest('interviewer', {
                durationMinutes: 0.2,
                failureEveryMs: 4000,
                metricsSampleEveryMs: 2000,
            });
            appendLog(`[load-test] failovers=${result?.failoverCountDelta ?? 'n/a'} samples=${result?.memoryUsage?.length ?? 0}`);
        } finally {
            setLoadTestRunning(false);
        }
    };

    const userLatency = useMemo(() => sttMetrics.user?.providers.find((provider) => provider.provider === (sttMetrics.user?.activeProvider || sttUserProvider))?.averageLatencyMs, [sttMetrics.user, sttUserProvider]);
    const interviewerLatency = useMemo(() => sttMetrics.interviewer?.providers.find((provider) => provider.provider === (sttMetrics.interviewer?.activeProvider || sttInterviewerProvider))?.averageLatencyMs, [sttMetrics.interviewer, sttInterviewerProvider]);

    const renderChannel = (
        label: string,
        status: 'connected' | 'reconnecting' | 'failed',
        provider: string,
        error: string,
        telemetry: SttTelemetryData | null,
        metrics: SttMetricsData | null,
        latencyMs?: number,
    ) => (
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <div className="font-medium text-white/85">
                    {label}: {metrics?.activeProvider || provider || 'inactive'}
                    {telemetry?.type === 'failover_triggered' && telemetry.nextProvider ? ` -> ${telemetry.nextProvider}` : ''}
                </div>
                <div className="text-white/55">
                    {status}
                    {error ? ` · ${error}` : ''}
                </div>
            </div>
            <div className="text-right text-white/60 shrink-0">
                <div>{(metrics?.transcriptsPerSecond || 0).toFixed(2)} t/s</div>
                <div>{typeof latencyMs === 'number' ? `${Math.round(latencyMs)}ms` : 'n/a'}</div>
            </div>
        </div>
    );

    return (
        <div className="mx-4 mt-1 mb-2 px-3 py-2 rounded-[14px] border border-white/10 bg-black/10 backdrop-blur-xl text-[11px] text-white/70 no-drag">
            <div className="space-y-2">
                {renderChannel('System', sttInterviewerStatus, sttInterviewerProvider, sttInterviewerError, sttTelemetry.interviewer, sttMetrics.interviewer, interviewerLatency)}
                {renderChannel('Mic', sttUserStatus, sttUserProvider, sttUserError, sttTelemetry.user, sttMetrics.user, userLatency)}
            </div>

            {import.meta.env.DEV && (
                <div className="mt-3 border-t border-white/10 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={toggleDebug} className="px-2 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/75">
                            {debugEnabled ? 'Disable STT_DEBUG' : 'Enable STT_DEBUG'}
                        </button>
                        <button onClick={primeReplay} className="px-2 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/75">
                            Prime Replay
                        </button>
                        <button onClick={triggerFailure} className="px-2 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/75">
                            Force Deepgram Fail
                        </button>
                        <button onClick={runValidation} disabled={validationRunning} className="px-2 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/75 disabled:opacity-50">
                            {validationRunning ? 'Validating…' : 'Run Failover Test'}
                        </button>
                        <button onClick={runLoadTest} disabled={loadTestRunning} className="px-2 py-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-white/75 disabled:opacity-50">
                            {loadTestRunning ? 'Load Testing…' : 'Run Load Test'}
                        </button>
                    </div>
                    <div className="mt-3 max-h-32 overflow-y-auto space-y-1 font-mono text-[10px] text-white/55">
                        {logs.map((line) => (
                            <div key={line.id}>{line.message}</div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SttRuntimePanel;
