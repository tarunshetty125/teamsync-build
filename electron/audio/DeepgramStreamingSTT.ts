/**
 * DeepgramStreamingSTT - SDK-based streaming Speech-to-Text using Deepgram Nova-3
 *
 * Uses @deepgram/sdk v3 (listen.live) instead of raw WebSocket.
 * Implements the same EventEmitter interface as GoogleSTT:
 *   Events: 'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: start(), stop(), write(chunk), setSampleRate(), setAudioChannelCount()
 */

import { EventEmitter } from 'events';
import { RECOGNITION_LANGUAGES } from '../config/languages';
import type { SttActivityEvent } from './stt/SttAdapter';

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_MAX_ATTEMPTS = 10;
const KEEPALIVE_INTERVAL_MS = 1000;
const STABLE_CONNECTION_RESET_MS = 5000;
const RECONNECT_JITTER_RATIO = 0.2;

export class DeepgramStreamingSTT extends EventEmitter {
    private apiKey: string;
    private live: any = null;
    private isActive = false;
    private shouldReconnect = false;
    private isOpen = false; // tracks whether SDK connection is in OPEN state

    private sampleRate = 16000;
    private numChannels = 1;
    private languageCode = 'en';

    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private keepAliveInterval: NodeJS.Timeout | null = null;
    private stableConnectionTimer: NodeJS.Timeout | null = null;
    private buffer: Buffer[] = [];
    private isConnecting = false;
    private connectionGeneration = 0;
    private closingGeneration = 0;
    private lastFailureSignature: string | null = null;
    private lastFailureAt = 0;

    constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
    }

    public setSampleRate(rate: number): void {
        if (this.sampleRate === rate) return;
        this.sampleRate = rate;
        console.log(`[DeepgramStreaming] Sample rate set to ${rate}`);
        if (this.isActive) this.restartStream();
    }

    public setAudioChannelCount(count: number): void {
        if (this.numChannels === count) return;
        this.numChannels = count;
        console.log(`[DeepgramStreaming] Channel count set to ${count}`);
        if (this.isActive) this.restartStream();
    }

    public setRecognitionLanguage(key: string): void {
        if (key === 'auto') {
            if (this.languageCode === 'multi') return;
            this.languageCode = 'multi';
            console.log('[DeepgramStreaming] Language set to multilingual (multi)');
            if (this.isActive) this.restartStream();
            return;
        }
        const config = RECOGNITION_LANGUAGES[key];
        if (config && this.languageCode !== config.iso639) {
            this.languageCode = config.iso639;
            console.log(`[DeepgramStreaming] Language set to ${this.languageCode}`);
            if (this.isActive) this.restartStream();
        }
    }

    public setCredentials(_path: string): void { }

    private restartStream(): void {
        console.log('[DeepgramStreaming] Restarting due to config change...');
        this.stop();
        this.start();
    }

    public start(): void {
        if (this.isActive) return;
        this.isActive = true;
        this.shouldReconnect = true;
        this.reconnectAttempts = 0;
        this.connect();
    }

    public stop(): void {
        this.shouldReconnect = false;
        this.clearTimers();

        this.closeLiveConnection('stop');

        this.isActive = false;
        this.isConnecting = false;
        this.isOpen = false;
        this.buffer = [];
        console.log('[DeepgramStreaming] Stopped');
    }

    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        if (!this.isOpen) {
            this.buffer.push(chunk);
            if (this.buffer.length > 500) this.buffer.shift();

            if (!this.shouldReconnect) {
                return;
            }

            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            if (!this.isConnecting) {
                this.connect();
            }
            return;
        }

        try {
            this.live.send(chunk);
        } catch (err: any) {
            const error = this.normalizeError(err, 'Deepgram send failed');
            console.error('[DeepgramStreaming] Send error:', error.message);
            this.handleConnectionFailure(error, 'send');
        }
    }

    private connect(): void {
        if (this.isConnecting) return;
        this.isConnecting = true;

        console.log(`[DeepgramStreaming] Connecting (rate=${this.sampleRate}, ch=${this.numChannels}, lang=${this.languageCode})...`);

        try {
            const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');

            const deepgram = createClient(this.apiKey);
            const connectionGeneration = ++this.connectionGeneration;

            const connection = deepgram.listen.live({
                model: 'nova-3',
                language: this.languageCode,
                smart_format: true,
                interim_results: true,
                encoding: 'linear16',
                sample_rate: this.sampleRate,
                channels: this.numChannels,
                endpointing: 300,
                utterance_end_ms: 1000,
                vad_events: true,
            });
            this.live = connection;

            const emitActivity = (event: Omit<SttActivityEvent, 'provider' | 'sourceLabel'>) => {
                this.emit('activity', event);
            };

            connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
                if (this.live !== connection || this.connectionGeneration !== connectionGeneration) {
                    return;
                }

                emitActivity({
                    kind: 'transcript',
                    timestamp: Date.now(),
                    isFinal: data?.is_final ?? false,
                });

                try {
                    const alt = data.channel?.alternatives?.[0];
                    const transcript = alt?.transcript;
                    const isFinal = data.is_final ?? false;
                    console.log(`[DeepgramStreaming] Transcript event — isFinal=${isFinal}, textLength=${transcript?.length ?? 0} redacted=true`);
                    if (!transcript) return;
                    this.emit('transcript', {
                        text: transcript,
                        isFinal,
                        confidence: alt?.confidence ?? 1.0,
                    });
                } catch (err) {
                    console.error('[DeepgramStreaming] Parse error:', err);
                }
            });

            connection.on(LiveTranscriptionEvents.SpeechStarted, (event: any) => {
                if (this.live !== connection || this.connectionGeneration !== connectionGeneration) {
                    return;
                }

                emitActivity({
                    kind: 'speech_started',
                    timestamp: Date.now(),
                    detail: JSON.stringify(event),
                });
            });

            connection.on(LiveTranscriptionEvents.UtteranceEnd, (event: any) => {
                if (this.live !== connection || this.connectionGeneration !== connectionGeneration) {
                    return;
                }

                emitActivity({
                    kind: 'utterance_end',
                    timestamp: Date.now(),
                    detail: JSON.stringify(event),
                });
            });

            connection.on(LiveTranscriptionEvents.Open, () => {
                if (this.live !== connection || this.connectionGeneration !== connectionGeneration || !this.shouldReconnect) {
                    this.safeRequestClose(connection);
                    return;
                }

                this.isConnecting = false;
                this.isOpen = true;
                console.log('[DeepgramStreaming] Connected');
                emitActivity({
                    kind: 'provider_open',
                    timestamp: Date.now(),
                });

                // Flush buffered audio
                const buffered = this.buffer.splice(0);
                for (const chunk of buffered) {
                    try {
                        connection.send(chunk);
                    } catch (err) {
                        const error = this.normalizeError(err, 'Deepgram flush failed');
                        console.error('[DeepgramStreaming] Flush error:', error.message);
                        this.handleConnectionFailure(error, 'flush', connection, connectionGeneration);
                        break;
                    }
                }
                if (buffered.length > 0) {
                    console.log(`[DeepgramStreaming] Flushed ${buffered.length} buffered chunks`);
                }

                // Deepgram can close quiet streams quickly, so arm keepalive immediately.
                try { connection.keepAlive(); } catch { }
                this.keepAliveInterval = setInterval(() => {
                    if (this.isOpen && this.live === connection && this.connectionGeneration === connectionGeneration) {
                        try {
                            connection.keepAlive();
                        } catch (err) {
                            const error = this.normalizeError(err, 'Deepgram keepalive failed');
                            console.error('[DeepgramStreaming] Keepalive error:', error.message);
                            this.handleConnectionFailure(error, 'keepalive', connection, connectionGeneration);
                        }
                    }
                }, KEEPALIVE_INTERVAL_MS);

                // Reset backoff only after a stable window so rapid 1006 loops keep escalating.
                this.stableConnectionTimer = setTimeout(() => {
                    if (this.isOpen && this.live === connection && this.connectionGeneration === connectionGeneration) {
                        this.reconnectAttempts = 0;
                        this.lastFailureSignature = null;
                        this.lastFailureAt = 0;
                    }
                }, STABLE_CONNECTION_RESET_MS);
            });

            connection.on(LiveTranscriptionEvents.Error, (err: any) => {
                if (this.live !== connection || this.connectionGeneration !== connectionGeneration) {
                    return;
                }

                const error = this.normalizeError(err, 'Deepgram websocket error');
                console.error('[DeepgramStreaming] Error:', error.message);
                emitActivity({
                    kind: 'provider_error',
                    timestamp: Date.now(),
                    detail: error.message,
                });
                this.handleConnectionFailure(error, 'ws_error', connection, connectionGeneration);
            });

            connection.on(LiveTranscriptionEvents.Unhandled, (event: any) => {
                if (this.live !== connection || this.connectionGeneration !== connectionGeneration) {
                    return;
                }
                console.log('[DeepgramStreaming] Unhandled event:', event);
            });

            connection.on(LiveTranscriptionEvents.Close, (event: any) => {
                if (this.live !== connection || this.connectionGeneration !== connectionGeneration) {
                    return;
                }

                const code = event?.code ?? 'unknown';
                const reason = event?.reason || '(empty)';
                console.log(`[DeepgramStreaming] Closed (code=${code}, reason=${reason})`);

                const isIntentional = connectionGeneration <= this.closingGeneration || !this.shouldReconnect;
                emitActivity({
                    kind: 'provider_close',
                    timestamp: Date.now(),
                    detail: `code=${code} reason=${reason}`,
                });
                if (this.live === connection) {
                    this.live = null;
                }
                this.isOpen = false;
                this.isConnecting = false;
                this.clearTimers();

                if (!isIntentional && code !== 1000) {
                    this.handleConnectionFailure(
                        new Error(`Deepgram websocket closed unexpectedly (${code}): ${reason}`),
                        'ws_close',
                        connection,
                        connectionGeneration
                    );
                }
            });

        } catch (err: any) {
            const error = this.normalizeError(err, 'Deepgram initialization failed');
            console.error('[DeepgramStreaming] Initialization error:', error.message);
            this.isConnecting = false;
            this.handleConnectionFailure(error, 'init');
        }
    }

    private scheduleReconnect(): void {
        if (!this.shouldReconnect) return;

        // Discard stale buffered audio — replaying seconds-old audio on reconnect
        // overwhelms Deepgram's real-time endpoint and causes EPIPE storms.
        this.buffer = [];

        if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
            console.error(`[DeepgramStreaming] Max reconnect attempts reached — giving up`);
            this.emit('error', new Error('DeepgramStreamingSTT: max reconnect attempts exceeded'));
            return;
        }

        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
            RECONNECT_MAX_DELAY_MS
        );
        const jitter = Math.round(delay * RECONNECT_JITTER_RATIO * Math.random());
        const staggeredDelay = delay + jitter;
        this.reconnectAttempts++;

        console.log(`[DeepgramStreaming] Reconnecting in ${staggeredDelay}ms (attempt ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})...`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldReconnect) this.connect();
        }, staggeredDelay);
    }

    private clearTimers(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        if (this.stableConnectionTimer) {
            clearTimeout(this.stableConnectionTimer);
            this.stableConnectionTimer = null;
        }
    }

    public finalize(): void {
        if (!this.live || !this.isOpen) {
            return;
        }

        try {
            this.live.finalize();
        } catch (err) {
            const error = this.normalizeError(err, 'Deepgram finalize failed');
            console.error('[DeepgramStreaming] Finalize error:', error.message);
        }
    }

    private closeLiveConnection(reason: string): void {
        if (!this.live) {
            return;
        }

        this.closingGeneration = Math.max(this.closingGeneration, this.connectionGeneration);
        const connection = this.live;
        this.live = null;
        this.isOpen = false;

        try {
            this.safeRequestClose(connection);
        } catch (err) {
            const error = this.normalizeError(err, `Deepgram close failed during ${reason}`);
            if (!this.isBenignTransportError(error)) {
                console.error('[DeepgramStreaming] Close error:', error.message);
            }
        }
    }

    private safeRequestClose(connection: any): void {
        if (!connection) return;

        try {
            connection.requestClose();
        } catch (err) {
            const error = this.normalizeError(err, 'Deepgram requestClose failed');
            if (!this.isBenignTransportError(error)) {
                throw error;
            }
        }
    }

    private handleConnectionFailure(
        err: unknown,
        source: string,
        connection: any = this.live,
        generation: number = this.connectionGeneration
    ): void {
        const error = this.normalizeError(err, `Deepgram ${source} failure`);
        const isIntentional = generation <= this.closingGeneration || !this.shouldReconnect;
        if (isIntentional) {
            if (!this.isBenignTransportError(error)) {
                console.log(`[DeepgramStreaming] Ignoring ${source} after intentional close: ${error.message}`);
            }
            return;
        }

        const signature = `${generation}:${source}:${error.message}`;
        const now = Date.now();
        if (this.lastFailureSignature === signature && now - this.lastFailureAt < 750) {
            return;
        }
        this.lastFailureSignature = signature;
        this.lastFailureAt = now;

        this.clearTimers();
        this.isOpen = false;
        this.isConnecting = false;

        if (this.live === connection) {
            this.closeLiveConnection(source);
        }

        this.emit('error', error);
        this.scheduleReconnect();
    }

    private normalizeError(err: unknown, fallbackMessage: string): Error {
        if (err instanceof Error) {
            return err;
        }
        if (typeof err === 'string' && err.trim()) {
            return new Error(err);
        }
        if (err && typeof err === 'object') {
            const message = (err as any).message || (err as any).type || JSON.stringify(err);
            return new Error(typeof message === 'string' && message.trim() ? message : fallbackMessage);
        }
        return new Error(fallbackMessage);
    }

    private isBenignTransportError(error: Error): boolean {
        const message = error.message.toLowerCase();
        return message.includes('epipe')
            || message.includes('socket is not open')
            || message.includes('ready state')
            || message.includes('closed before the connection was established');
    }
}
