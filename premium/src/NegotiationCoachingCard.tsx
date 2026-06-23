import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Shield,
  Target,
  TrendingUp,
  ArrowRight,
  Clock,
  CheckCircle,
  AlertTriangle,
  Zap,
  Copy,
  Check,
  Volume2,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────
type NegotiationPhase =
  | 'INACTIVE'
  | 'PROBE'
  | 'ANCHOR'
  | 'COUNTER'
  | 'HOLD'
  | 'PIVOT_BENEFITS'
  | 'CLOSE';

interface NegotiationCoachingCardProps {
  tacticalNote: string;
  exactScript: string;
  showSilenceTimer: boolean;
  phase: NegotiationPhase;
  theirOffer: number | null;
  yourTarget: number | null;
  currency: string;
  onSilenceTimerEnd?: () => void;
}

// ── Phase Configuration ──────────────────────────────────────
const PHASE_CONFIG: Record<NegotiationPhase, {
  label: string;
  icon: React.ReactNode;
  gradient: string;
  glowColor: string;
  borderColor: string;
  accentDark: string;
  accentLight: string;
  bgDark: string;
  bgLight: string;
}> = {
  INACTIVE: {
    label: 'Getting Started',
    icon: <Shield className="w-3.5 h-3.5" />,
    gradient: 'from-slate-500 to-slate-600',
    glowColor: 'rgba(100,116,139,0.15)',
    borderColor: 'rgba(100,116,139,0.25)',
    accentDark: '#94A3B8',
    accentLight: '#475569',
    bgDark: 'rgba(100,116,139,0.06)',
    bgLight: 'rgba(100,116,139,0.04)',
  },
  PROBE: {
    label: 'Exploring the Range',
    icon: <Target className="w-3.5 h-3.5" />,
    gradient: 'from-blue-500 to-cyan-500',
    glowColor: 'rgba(59,130,246,0.12)',
    borderColor: 'rgba(59,130,246,0.20)',
    accentDark: '#60A5FA',
    accentLight: '#2563EB',
    bgDark: 'rgba(59,130,246,0.06)',
    bgLight: 'rgba(59,130,246,0.04)',
  },
  ANCHOR: {
    label: 'Recruiter Made an Offer',
    icon: <TrendingUp className="w-3.5 h-3.5" />,
    gradient: 'from-amber-500 to-orange-500',
    glowColor: 'rgba(245,158,11,0.12)',
    borderColor: 'rgba(245,158,11,0.20)',
    accentDark: '#FBBF24',
    accentLight: '#D97706',
    bgDark: 'rgba(245,158,11,0.06)',
    bgLight: 'rgba(245,158,11,0.04)',
  },
  COUNTER: {
    label: 'Holding Position',
    icon: <Shield className="w-3.5 h-3.5" />,
    gradient: 'from-violet-500 to-purple-500',
    glowColor: 'rgba(139,92,246,0.12)',
    borderColor: 'rgba(139,92,246,0.20)',
    accentDark: '#A78BFA',
    accentLight: '#7C3AED',
    bgDark: 'rgba(139,92,246,0.06)',
    bgLight: 'rgba(139,92,246,0.04)',
  },
  HOLD: {
    label: 'Recruiter Pushed Back',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    gradient: 'from-rose-500 to-red-500',
    glowColor: 'rgba(244,63,94,0.12)',
    borderColor: 'rgba(244,63,94,0.20)',
    accentDark: '#FB7185',
    accentLight: '#E11D48',
    bgDark: 'rgba(244,63,94,0.06)',
    bgLight: 'rgba(244,63,94,0.04)',
  },
  PIVOT_BENEFITS: {
    label: 'Pivoting to Total Comp',
    icon: <Zap className="w-3.5 h-3.5" />,
    gradient: 'from-teal-500 to-emerald-500',
    glowColor: 'rgba(20,184,166,0.12)',
    borderColor: 'rgba(20,184,166,0.20)',
    accentDark: '#2DD4BF',
    accentLight: '#0D9488',
    bgDark: 'rgba(20,184,166,0.06)',
    bgLight: 'rgba(20,184,166,0.04)',
  },
  CLOSE: {
    label: 'Closing the Deal',
    icon: <CheckCircle className="w-3.5 h-3.5" />,
    gradient: 'from-emerald-500 to-green-500',
    glowColor: 'rgba(16,185,129,0.12)',
    borderColor: 'rgba(16,185,129,0.20)',
    accentDark: '#34D399',
    accentLight: '#059669',
    bgDark: 'rgba(16,185,129,0.06)',
    bgLight: 'rgba(16,185,129,0.04)',
  },
};

// ── Silence Timer ────────────────────────────────────────────
const SILENCE_DURATION = 7; // seconds

const SilenceTimer: React.FC<{
  onEnd?: () => void;
  accent: string;
}> = ({ onEnd, accent }) => {
  const [remaining, setRemaining] = useState(SILENCE_DURATION);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          onEnd?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [onEnd]);

  const progress = ((SILENCE_DURATION - remaining) / SILENCE_DURATION) * 100;

  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg mt-2"
      style={{
        background: `linear-gradient(135deg, ${accent}08, ${accent}04)`,
        border: `1px solid ${accent}18`,
      }}
    >
      <Volume2
        className="w-3.5 h-3.5 flex-shrink-0"
        style={{ color: accent, opacity: remaining % 2 === 0 ? 1 : 0.5, transition: 'opacity 500ms ease' }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: accent }}
          >
            Strategic Pause
          </span>
          <span
            className="text-[10px] font-mono tabular-nums"
            style={{ color: accent, opacity: 0.8 }}
          >
            {remaining}s
          </span>
        </div>
        <div
          className="h-1 rounded-full overflow-hidden"
          style={{ background: `${accent}15` }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${progress}%`,
              background: `linear-gradient(90deg, ${accent}80, ${accent})`,
              transition: 'width 1s linear',
            }}
          />
        </div>
        <p
          className="text-[10px] mt-1 leading-snug"
          style={{ color: `${accent}B0` }}
        >
          Let them fill the silence — it signals confidence.
        </p>
      </div>
    </div>
  );
};

// ── Currency Formatter ───────────────────────────────────────
function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

// ── Main Component ───────────────────────────────────────────
export const NegotiationCoachingCard: React.FC<NegotiationCoachingCardProps> = ({
  tacticalNote,
  exactScript,
  showSilenceTimer,
  phase,
  theirOffer,
  yourTarget,
  currency,
  onSilenceTimerEnd,
}) => {
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Detect theme from parent overlay context
  const isLightTheme = useMemo(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('light') ||
      document.documentElement.getAttribute('data-theme') === 'light';
  }, []);

  const config = PHASE_CONFIG[phase] || PHASE_CONFIG.PROBE;

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(exactScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const accent = isLightTheme ? config.accentLight : config.accentDark;
  const bg = isLightTheme ? config.bgLight : config.bgDark;
  const border = config.borderColor;

  const hasOfferComparison = theirOffer != null && yourTarget != null;
  const offerGap = hasOfferComparison ? yourTarget! - theirOffer! : 0;
  const offerGapPct = hasOfferComparison && theirOffer! > 0
    ? ((offerGap / theirOffer!) * 100).toFixed(0)
    : null;

  return (
    <div
      ref={cardRef}
      className="relative overflow-hidden rounded-xl my-1.5"
      style={{
        background: bg,
        border: `1px solid ${border}`,
        boxShadow: `0 0 24px ${config.glowColor}, 0 1px 3px rgba(0,0,0,0.06)`,
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.98)',
        transition: 'opacity 280ms cubic-bezier(0.23,1,0.32,1), transform 280ms cubic-bezier(0.23,1,0.32,1)',
      }}
    >
      {/* ── Accent top bar ── */}
      <div
        className="h-[2px] w-full"
        style={{
          background: `linear-gradient(90deg, ${accent}60, ${accent}, ${accent}60)`,
        }}
      />

      <div className="px-3.5 py-3 space-y-2.5">
        {/* ── Header: Phase badge + label ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md"
              style={{
                background: `${accent}15`,
                border: `1px solid ${accent}25`,
              }}
            >
              <span style={{ color: accent }}>{config.icon}</span>
              <span
                className="text-[10px] font-bold uppercase tracking-[0.06em]"
                style={{ color: accent }}
              >
                {config.label}
              </span>
            </div>
          </div>

          {/* Live indicator */}
          <div className="flex items-center gap-1.5">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: accent,
                boxShadow: `0 0 6px ${accent}`,
                animation: 'negotiation-pulse 2s ease-in-out infinite',
              }}
            />
            <span
              className="text-[9px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: `${accent}90` }}
            >
              Live Coach
            </span>
          </div>
        </div>

        {/* ── Offer Comparison Bar ── */}
        {hasOfferComparison && (
          <div
            className="flex items-center justify-between px-3 py-2 rounded-lg"
            style={{
              background: isLightTheme ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${isLightTheme ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)'}`,
            }}
          >
            <div className="flex flex-col">
              <span
                className="text-[9px] uppercase tracking-[0.06em] font-medium"
                style={{ color: isLightTheme ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.35)' }}
              >
                Their Offer
              </span>
              <span
                className="text-[13px] font-bold tabular-nums"
                style={{ color: isLightTheme ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.8)' }}
              >
                {formatCurrency(theirOffer!, currency)}
              </span>
            </div>

            <div className="flex flex-col items-center px-3">
              <ArrowRight
                className="w-3.5 h-3.5"
                style={{ color: `${accent}80` }}
              />
              {offerGapPct && (
                <span
                  className="text-[9px] font-bold tabular-nums mt-0.5"
                  style={{ color: offerGap >= 0 ? (isLightTheme ? '#059669' : '#34D399') : (isLightTheme ? '#DC2626' : '#F87171') }}
                >
                  {offerGap >= 0 ? '+' : ''}{offerGapPct}%
                </span>
              )}
            </div>

            <div className="flex flex-col items-end">
              <span
                className="text-[9px] uppercase tracking-[0.06em] font-medium"
                style={{ color: isLightTheme ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.35)' }}
              >
                Your Target
              </span>
              <span
                className="text-[13px] font-bold tabular-nums"
                style={{ color: accent }}
              >
                {formatCurrency(yourTarget!, currency)}
              </span>
            </div>
          </div>
        )}

        {/* ── Tactical Note ── */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <div
              className="w-1 h-1 rounded-full"
              style={{ background: accent, opacity: 0.6 }}
            />
            <span
              className="text-[9px] font-bold uppercase tracking-[0.08em]"
              style={{ color: `${accent}90` }}
            >
              Tactical Read
            </span>
          </div>
          <p
            className="text-[12px] leading-[1.6]"
            style={{
              color: isLightTheme ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.6)',
            }}
          >
            {tacticalNote}
          </p>
        </div>

        {/* ── Exact Script (hero section) ── */}
        <div
          className="relative rounded-lg px-3 py-2.5 group"
          style={{
            background: `linear-gradient(135deg, ${accent}0A, ${accent}05)`,
            border: `1px solid ${accent}20`,
          }}
        >
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Zap className="w-3 h-3" style={{ color: accent }} />
              <span
                className="text-[10px] font-bold uppercase tracking-[0.06em]"
                style={{ color: accent }}
              >
                Say This
              </span>
            </div>

            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              style={{
                background: copied ? `${accent}15` : 'transparent',
                border: `1px solid ${copied ? `${accent}30` : 'transparent'}`,
                color: copied ? accent : (isLightTheme ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)'),
              }}
              title={copied ? 'Copied!' : 'Copy script'}
            >
              {copied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
              <span className="text-[8px] font-semibold tracking-wide">
                {copied ? 'Copied' : 'Copy'}
              </span>
            </button>
          </div>

          <p
            className="text-[13.5px] leading-[1.7] font-medium"
            style={{
              color: isLightTheme ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)',
            }}
          >
            "{exactScript}"
          </p>
        </div>

        {/* ── Silence Timer ── */}
        {showSilenceTimer && (
          <SilenceTimer onEnd={onSilenceTimerEnd} accent={accent} />
        )}
      </div>

      {/* ── Keyframe animation ── */}
      <style>{`
        @keyframes negotiation-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
};
