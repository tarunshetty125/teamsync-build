import React, { useEffect, useState, useCallback } from 'react';
import { Download, AlertTriangle, ArrowRight, Loader2, CheckCircle, X } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

type EnforcementPhase = 'none' | 'notice' | 'warning' | 'urgent' | 'blocked';

interface EnforcementState {
  isActive: boolean;
  phase: EnforcementPhase;
  daysElapsed: number;
  daysRemaining: number;
  graceDaysTotal: number;
  detectedVersion: string | null;
  currentVersion: string;
}

// ─── Enforcement Banner (shown during grace period) ─────────────────────────

interface EnforcementBannerProps {
  state: EnforcementState;
  onUpdate: () => void;
  onDismiss?: () => void;
}

const EnforcementBanner: React.FC<EnforcementBannerProps> = ({ state, onUpdate, onDismiss }) => {
  if (!state.isActive || state.phase === 'none' || state.phase === 'blocked') return null;

  const phaseConfig = {
    notice: {
      bg: 'linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(99,102,241,0.08) 100%)',
      border: 'rgba(59,130,246,0.25)',
      color: '#93c5fd',
      icon: <Download size={14} />,
      dismissible: true,
    },
    warning: {
      bg: 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(234,88,12,0.08) 100%)',
      border: 'rgba(245,158,11,0.25)',
      color: '#fbbf24',
      icon: <AlertTriangle size={14} />,
      dismissible: false,
    },
    urgent: {
      bg: 'linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(220,38,38,0.10) 100%)',
      border: 'rgba(239,68,68,0.35)',
      color: '#f87171',
      icon: <AlertTriangle size={14} />,
      dismissible: false,
    },
  };

  const config = phaseConfig[state.phase as keyof typeof phaseConfig];
  if (!config) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        background: config.bg,
        border: `1px solid ${config.border}`,
        borderRadius: 10,
        margin: '8px 12px 0',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        fontSize: 12,
        color: config.color,
        animation: state.phase === 'urgent' ? 'enforcementPulse 2s ease-in-out infinite' : undefined,
      }}
    >
      {config.icon}
      <span style={{ flex: 1, opacity: 0.95 }}>
        <strong>v{state.detectedVersion}</strong> available
        {state.daysRemaining > 0
          ? ` — ${state.daysRemaining} day${state.daysRemaining === 1 ? '' : 's'} remaining`
          : ' — update required'}
      </span>
      <button
        onClick={onUpdate}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 12px',
          background: config.color,
          color: '#0a0a0f',
          border: 'none',
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Update Now <ArrowRight size={11} />
      </button>
      {config.dismissible && onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: config.color,
            cursor: 'pointer',
            padding: 2,
            opacity: 0.6,
          }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};

// ─── Force Update Screen (shown after grace period expires) ─────────────────

interface ForceUpdateScreenProps {
  state: EnforcementState;
  onBypass?: () => void;
}

const ForceUpdateScreen: React.FC<ForceUpdateScreenProps> = ({ state, onBypass }) => {
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'ready' | 'installing' | 'error' | 'instructions'>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [instructionsArch, setInstructionsArch] = useState<'arm64' | 'x64' | null>(null);

  // Safety valve: 5 rapid clicks on version badge bypasses block for 24 hrs
  const [bypassClicks, setBypassClicks] = useState(0);
  const bypassTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!window.electronAPI) return;

    const unsubProgress = window.electronAPI.onDownloadProgress?.((progressObj: any) => {
      setDownloadStatus('downloading');
      setDownloadProgress(progressObj.percent || 0);
    });

    const unsubDownloaded = window.electronAPI.onUpdateDownloaded?.(() => {
      setDownloadStatus('ready');
    });

    const unsubError = window.electronAPI.onUpdateError?.((err: string) => {
      setDownloadStatus('error');
      setErrorMessage(err);
    });

    return () => {
      unsubProgress?.();
      unsubDownloaded?.();
      unsubError?.();
    };
  }, []);

  // Primary download: use electron-updater on ALL platforms (enables auto-replace on macOS)
  const handleDownload = useCallback(() => {
    setDownloadStatus('downloading');
    setDownloadProgress(0);
    setErrorMessage(null);
    window.electronAPI?.downloadUpdate?.();
  }, []);

  // macOS fallback: open DMG from GitHub releases (if auto-download fails)
  const handleDmgFallback = useCallback(async () => {
    try {
      const arch = await window.electronAPI?.getArch?.();
      const isArm = arch === 'arm64';
      setInstructionsArch(isArm ? 'arm64' : 'x64');
      const version = state.detectedVersion ? state.detectedVersion.replace(/^v/, '') : '';
      if (version) {
        const dmgFileName = isArm ? `Quietly-${version}-arm64.dmg` : `Quietly-${version}.dmg`;
        const url = `https://github.com/tarunshetty125/Quietly/releases/download/v${version}/${dmgFileName}`;
        window.electronAPI?.openExternal?.(url);
        setDownloadStatus('instructions');
        return;
      }
    } catch (err) {
      console.error('[ForceUpdate] DMG fallback failed', err);
    }
  }, [state.detectedVersion]);

  const handleInstall = useCallback(() => {
    setDownloadStatus('installing');
    window.electronAPI?.restartAndInstall?.();
  }, []);

  const handleRetry = useCallback(() => {
    setErrorMessage(null);
    setDownloadStatus('idle');
  }, []);

  const handleBypassClick = useCallback(() => {
    const next = bypassClicks + 1;
    setBypassClicks(next);

    // Reset counter after 3 seconds of inactivity
    if (bypassTimerRef.current) clearTimeout(bypassTimerRef.current);
    bypassTimerRef.current = setTimeout(() => setBypassClicks(0), 3000);

    if (next >= 5 && onBypass) {
      onBypass();
      setBypassClicks(0);
    }
  }, [bypassClicks, onBypass]);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 99999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.85)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      {/* Decorative gradient orbs */}
      <div style={{
        position: 'absolute',
        top: '20%',
        left: '30%',
        width: 300,
        height: 300,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
        filter: 'blur(80px)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        bottom: '25%',
        right: '25%',
        width: 250,
        height: 250,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(168,85,247,0.12) 0%, transparent 70%)',
        filter: 'blur(80px)',
        pointerEvents: 'none',
      }} />

      {/* Main card */}
      <div style={{
        position: 'relative',
        width: 420,
        maxWidth: '90vw',
        background: 'linear-gradient(145deg, rgba(20,20,30,0.95) 0%, rgba(15,15,25,0.98) 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 20,
        padding: '40px 36px',
        textAlign: 'center',
        boxShadow: '0 25px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
      }}>
        {/* App icon */}
        <div style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 24px',
          boxShadow: '0 8px 32px rgba(99,102,241,0.3)',
        }}>
          <Download size={28} color="#fff" />
        </div>

        <h1 style={{
          fontSize: 22,
          fontWeight: 700,
          color: '#f1f1f5',
          margin: '0 0 8px',
          letterSpacing: '-0.02em',
        }}>
          Update Required
        </h1>

        <p style={{
          fontSize: 13,
          color: 'rgba(255,255,255,0.5)',
          margin: '0 0 24px',
          lineHeight: 1.5,
        }}>
          A new version is available. Please update to continue using Quietly.
        </p>

        {/* Version badge — also serves as safety valve (5 rapid clicks to bypass) */}
        <div
          onClick={handleBypassClick}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 16px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 20,
            fontSize: 12,
            color: 'rgba(255,255,255,0.6)',
            margin: '0 0 28px',
            cursor: 'default',
            userSelect: 'none',
          }}
        >
          <span>v{state.currentVersion}</span>
          <ArrowRight size={12} style={{ opacity: 0.4 }} />
          <span style={{ color: '#a78bfa', fontWeight: 600 }}>v{state.detectedVersion}</span>
        </div>

        {/* Action area */}
        <div style={{ marginTop: 4 }}>
          {downloadStatus === 'idle' && (
            <button
              onClick={handleDownload}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                padding: '14px 24px',
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'transform 0.15s, box-shadow 0.15s',
                boxShadow: '0 4px 24px rgba(99,102,241,0.3)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 6px 32px rgba(99,102,241,0.4)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 24px rgba(99,102,241,0.3)';
              }}
            >
              <Download size={16} />
              Download Update
            </button>
          )}

          {downloadStatus === 'downloading' && (
            <div>
              <div style={{
                width: '100%',
                height: 6,
                background: 'rgba(255,255,255,0.06)',
                borderRadius: 3,
                overflow: 'hidden',
                marginBottom: 12,
              }}>
                <div style={{
                  height: '100%',
                  width: `${downloadProgress}%`,
                  background: 'linear-gradient(90deg, #6366f1, #a855f7)',
                  borderRadius: 3,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontSize: 13,
                color: 'rgba(255,255,255,0.5)',
              }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                Downloading... {Math.round(downloadProgress)}%
              </div>
            </div>
          )}

          {downloadStatus === 'ready' && (
            <button
              onClick={handleInstall}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                padding: '14px 24px',
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 4px 24px rgba(34,197,94,0.3)',
              }}
            >
              <CheckCircle size={16} />
              Install & Restart
            </button>
          )}

          {downloadStatus === 'installing' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '14px 24px',
              fontSize: 13,
              color: 'rgba(255,255,255,0.5)',
            }}>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              Installing update...
            </div>
          )}

          {/* macOS: manual install instructions after DMG download opens */}
          {downloadStatus === 'instructions' && (
            <div style={{ textAlign: 'left' }}>
              <p style={{
                fontSize: 13,
                color: 'rgba(255,255,255,0.7)',
                margin: '0 0 12px',
                lineHeight: 1.6,
              }}>
                Download started in your browser. To install:
              </p>
              <ol style={{
                fontSize: 12,
                color: 'rgba(255,255,255,0.55)',
                margin: '0 0 16px',
                paddingLeft: 20,
                lineHeight: 1.8,
              }}>
                <li>Open the downloaded <strong>.dmg</strong> file</li>
                <li>Drag <strong>Quietly.app</strong> to <strong>Applications</strong></li>
                <li>Replace the existing version when prompted</li>
                <li>Open Quietly from Applications</li>
              </ol>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => {
                    window.electronAPI?.quitApp?.();
                  }}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Quit & Install
                </button>
                <button
                  onClick={() => setDownloadStatus('idle')}
                  style={{
                    padding: '10px 16px',
                    background: 'rgba(255,255,255,0.06)',
                    color: 'rgba(255,255,255,0.5)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {downloadStatus === 'error' && (
            <div>
              <p style={{
                fontSize: 12,
                color: '#f87171',
                margin: '0 0 12px',
              }}>
                {errorMessage || 'Download failed. Please check your connection.'}
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button
                  onClick={handleRetry}
                  style={{
                    padding: '10px 24px',
                    background: 'rgba(239,68,68,0.15)',
                    color: '#f87171',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
                {(window.electronAPI as any)?.platform === 'darwin' && (
                  <button
                    onClick={handleDmgFallback}
                    style={{
                      padding: '10px 24px',
                      background: 'rgba(99,102,241,0.12)',
                      color: '#93c5fd',
                      border: '1px solid rgba(99,102,241,0.25)',
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Download DMG Instead
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CSS for animations */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

// ─── Main Hook ──────────────────────────────────────────────────────────────

export function useUpdateEnforcement() {
  const [enforcementState, setEnforcementState] = useState<EnforcementState>({
    isActive: false,
    phase: 'none',
    daysElapsed: 0,
    daysRemaining: 15,
    graceDaysTotal: 15,
    detectedVersion: null,
    currentVersion: '',
  });
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // Safety valve: bypass block for 24 hours (stored in sessionStorage so it resets on restart)
  const [bypassed, setBypassed] = useState(() => {
    try {
      const bypassUntil = sessionStorage.getItem('quietly_enforcement_bypass');
      if (bypassUntil && Date.now() < parseInt(bypassUntil, 10)) return true;
    } catch {}
    return false;
  });

  useEffect(() => {
    if (!window.electronAPI) return;

    // Query current state on mount
    window.electronAPI.getUpdateEnforcementState?.().then((state: EnforcementState) => {
      if (state) setEnforcementState(state);
    }).catch(() => {});

    // Listen for state changes (broadcast from main process)
    const unsub = window.electronAPI.onUpdateEnforcement?.((state: EnforcementState) => {
      if (state) {
        setEnforcementState(state);
        // Reset banner dismissal when phase changes
        setBannerDismissed(false);
      }
    });

    return () => { unsub?.(); };
  }, []);

  const handleUpdate = useCallback(() => {
    window.electronAPI?.checkForUpdates?.();
    window.electronAPI?.downloadUpdate?.();
  }, []);

  const handleDismiss = useCallback(() => {
    setBannerDismissed(true);
  }, []);

  const handleBypass = useCallback(() => {
    // Allow 24 hours of use without the blocker
    const bypassUntil = Date.now() + 24 * 60 * 60 * 1000;
    try {
      sessionStorage.setItem('quietly_enforcement_bypass', String(bypassUntil));
    } catch {}
    setBypassed(true);
    console.log('[UpdateEnforcement] User bypassed block for 24 hours');
  }, []);

  const effectivelyBlocked = enforcementState.phase === 'blocked' && !bypassed;

  return {
    enforcementState,
    bannerDismissed,
    handleUpdate,
    handleDismiss,
    handleBypass,
    isBlocked: effectivelyBlocked,
    showBanner: enforcementState.isActive && enforcementState.phase !== 'none' && enforcementState.phase !== 'blocked' && !bannerDismissed,
  };
}

export { EnforcementBanner, ForceUpdateScreen };
export type { EnforcementState, EnforcementPhase };
