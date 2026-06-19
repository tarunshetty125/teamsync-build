import React, { useState, useEffect, useCallback } from 'react';
import { Smartphone, Copy, Check, Wifi, WifiOff, RefreshCw, Globe, Shield } from 'lucide-react';

interface PhoneMirrorState {
    enabled: boolean;
    lanAccess: boolean;
    port: number;
    pairingUrl: string | null;
    connectedDeviceCount: number;
    connectedDevices: Array<{ id: string; name: string; connectedAt: number }>;
}

export const PhoneMirrorSettings: React.FC = () => {
    const mountedRef = React.useRef(true);
    const [state, setState] = useState<PhoneMirrorState>({
        enabled: false,
        lanAccess: false,
        port: 8765,
        pairingUrl: null,
        connectedDeviceCount: 0,
        connectedDevices: [],
    });
    const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [urlCopied, setUrlCopied] = useState(false);
    const [enablingLoading, setEnablingLoading] = useState(false);
    const [lanLoading, setLanLoading] = useState(false);

    const fetchState = useCallback(async () => {
        try {
            const s = await window.electronAPI.phoneMirrorGetState();
            if (!mountedRef.current) return;
            setState(s);
            if (s.enabled) {
                const qr = await window.electronAPI.phoneMirrorGetQrCode();
                if (mountedRef.current && qr.success && qr.dataUrl) {
                    setQrCodeUrl(qr.dataUrl);
                }
            } else {
                if (mountedRef.current) setQrCodeUrl(null);
            }
        } catch (e: any) {
            console.warn('[PhoneMirrorSettings] Failed to fetch state:', e);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        fetchState();
        const unsub = window.electronAPI.onPhoneMirrorStateChanged?.((newState: PhoneMirrorState) => {
            if (!mountedRef.current) return;
            setState(newState);
            if (newState.enabled) {
                window.electronAPI.phoneMirrorGetQrCode().then((qr: any) => {
                    if (mountedRef.current && qr.success && qr.dataUrl) setQrCodeUrl(qr.dataUrl);
                }).catch(() => { });
            } else {
                setQrCodeUrl(null);
            }
        });
        return () => {
            mountedRef.current = false;
            unsub?.();
        };
    }, [fetchState]);

    const handleToggleEnabled = async () => {
        if (enablingLoading) return;
        setEnablingLoading(true);
        setError(null);
        const wasEnabled = state.enabled;
        setState(prev => ({ ...prev, enabled: !prev.enabled })); // Instant flip
        try {
            if (wasEnabled) {
                await window.electronAPI.phoneMirrorDisable();
            } else {
                const result = await window.electronAPI.phoneMirrorEnable();
                if (!result.success) {
                    if (mountedRef.current) {
                        setError(result.error || 'Failed to enable Phone Mirror');
                        setState(prev => ({ ...prev, enabled: wasEnabled }));
                    }
                    return;
                }
            }
            if (mountedRef.current) await fetchState();
        } catch (e: any) {
            if (mountedRef.current) {
                setError(e.message || 'Unexpected error');
                setState(prev => ({ ...prev, enabled: wasEnabled }));
            }
        } finally {
            if (mountedRef.current) setEnablingLoading(false);
        }
    };

    const handleToggleLan = async () => {
        if (lanLoading) return;
        setLanLoading(true);
        setError(null);
        const wasLan = state.lanAccess;
        setState(prev => ({ ...prev, lanAccess: !prev.lanAccess })); // Instant flip
        try {
            const result = await window.electronAPI.phoneMirrorSetLanAccess(!wasLan);
            if (!result.success) {
                if (mountedRef.current) {
                    setError(result.error || 'Failed to toggle LAN access');
                    setState(prev => ({ ...prev, lanAccess: wasLan }));
                }
            }
            if (mountedRef.current) await fetchState();
        } catch (e: any) {
            if (mountedRef.current) {
                setError(e.message || 'Unexpected error');
                setState(prev => ({ ...prev, lanAccess: wasLan }));
            }
        } finally {
            if (mountedRef.current) setLanLoading(false);
        }
    };

    const handleCopyUrl = () => {
        if (!state.pairingUrl) return;
        navigator.clipboard.writeText(state.pairingUrl);
        setUrlCopied(true);
        setTimeout(() => setUrlCopied(false), 2000);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-teal-500/20 bg-teal-500/10 text-teal-400">
                    <Smartphone size={20} />
                </div>
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <h2 className="text-[18px] font-bold text-text-primary tracking-tight">Phone Mirror</h2>
                        <span className="inline-flex items-center rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-500">
                            Beta
                        </span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-text-secondary leading-relaxed">
                        Stream live AI responses to a phone browser on your local network.
                    </p>
                </div>
            </div>

            {/* Enable Toggle Card */}
            <section className={`rounded-xl border border-border-subtle bg-bg-card p-5 transition-opacity duration-150 ${enablingLoading || lanLoading ? 'opacity-60 pointer-events-none' : ''}`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${state.enabled ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' : 'border-border-subtle bg-bg-input text-text-tertiary'}`}>
                            {state.enabled ? <Wifi size={16} /> : <WifiOff size={16} />}
                        </div>
                        <div>
                            <p className="text-[13px] font-semibold text-text-primary">Enable Phone Mirror</p>
                            <p className="text-[11px] text-text-tertiary mt-0.5">
                                {enablingLoading
                                    ? 'Applying…'
                                    : state.enabled
                                        ? `Active on port ${state.port}`
                                        : 'Off — no port opened, no network listener'
                                }
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleToggleEnabled}
                        disabled={enablingLoading || lanLoading}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus:outline-none ${enablingLoading || lanLoading ? 'cursor-not-allowed' : 'cursor-pointer'} ${state.enabled
                            ? 'border-emerald-500/30 bg-emerald-500'
                            : 'border-border-subtle bg-bg-toggle-switch'
                            }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${state.enabled ? 'translate-x-[22px]' : 'translate-x-[3px]'
                                }`}
                        />
                    </button>
                </div>
            </section>

            {/* LAN Access Toggle */}
            {state.enabled && (
                <section className={`rounded-xl border border-border-subtle bg-bg-card p-5 transition-opacity duration-150 ${enablingLoading || lanLoading ? 'opacity-60 pointer-events-none' : ''}`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${state.lanAccess ? 'border-blue-500/25 bg-blue-500/10 text-blue-400' : 'border-border-subtle bg-bg-input text-text-tertiary'}`}>
                                <Globe size={16} />
                            </div>
                            <div>
                                <p className="text-[13px] font-semibold text-text-primary">Allow LAN Access</p>
                                <p className="text-[11px] text-text-tertiary mt-0.5">
                                    {lanLoading
                                        ? 'Applying…'
                                        : state.lanAccess
                                            ? 'Available on your local network'
                                            : 'Loopback only (127.0.0.1) — same machine access'
                                    }
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={handleToggleLan}
                            disabled={enablingLoading || lanLoading}
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus:outline-none ${enablingLoading || lanLoading ? 'cursor-not-allowed' : 'cursor-pointer'} ${state.lanAccess
                                ? 'border-blue-500/30 bg-blue-500'
                                : 'border-border-subtle bg-bg-toggle-switch'
                                }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${state.lanAccess ? 'translate-x-[22px]' : 'translate-x-[3px]'
                                    }`}
                            />
                        </button>
                    </div>
                </section>
            )}

            {/* Error */}
            {error && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-[12px] text-red-400">
                    {error}
                </div>
            )}

            {/* Pairing Section */}
            {state.enabled && state.pairingUrl && (
                <section className="rounded-xl border border-border-subtle bg-bg-card p-5 space-y-5">
                    <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3">Pairing</p>

                        {/* URL */}
                        <div className="flex items-center gap-2">
                            <div className="flex-1 overflow-hidden rounded-lg border border-border-subtle bg-bg-input px-3 py-2">
                                <p className="truncate text-[12px] font-mono text-text-secondary">{state.pairingUrl}</p>
                            </div>
                            <button
                                onClick={handleCopyUrl}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-bg-input text-text-secondary transition-colors hover:bg-bg-item-hover hover:text-text-primary"
                                title="Copy URL"
                            >
                                {urlCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                            </button>
                        </div>
                    </div>

                    {/* QR Code */}
                    {qrCodeUrl && (
                        <div className="flex flex-col items-center gap-3">
                            <div className="rounded-2xl border border-border-subtle bg-bg-input p-3">
                                <img
                                    src={qrCodeUrl}
                                    alt="Phone Mirror QR Code"
                                    className="h-[180px] w-[180px] rounded-xl"
                                    style={{ imageRendering: 'pixelated' }}
                                />
                            </div>
                            <p className="text-[11px] text-text-tertiary text-center">
                                Scan with your phone camera to connect
                            </p>
                        </div>
                    )}

                    {/* Connected Devices */}
                    <div className="flex items-center justify-between border-t border-border-subtle pt-4">
                        <div className="flex items-center gap-2">
                            <Smartphone size={14} className="text-text-tertiary" />
                            <p className="text-[12px] text-text-secondary">
                                {state.connectedDeviceCount === 0
                                    ? 'No devices connected'
                                    : `${state.connectedDeviceCount} device${state.connectedDeviceCount > 1 ? 's' : ''} connected`
                                }
                            </p>
                        </div>
                        {state.connectedDeviceCount > 0 && (
                            <button
                                onClick={() => window.electronAPI.phoneMirrorDisconnectAll()}
                                className="text-[11px] font-medium text-red-400 hover:text-red-300 transition-colors"
                            >
                                Disconnect all
                            </button>
                        )}
                    </div>
                </section>
            )}

            {/* Privacy Note */}
            <section className="rounded-xl border border-border-subtle bg-bg-card p-4">
                <div className="flex items-start gap-3">
                    <Shield size={16} className="text-text-tertiary shrink-0 mt-0.5" />
                    <div>
                        <p className="text-[12px] font-medium text-text-secondary">Local network only</p>
                        <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed">
                            Phone Mirror runs entirely on your machine. No data is sent to the internet.
                            AI responses are streamed over your local network only when a device is paired with a valid token.
                        </p>
                    </div>
                </div>
            </section>
        </div>
    );
};
