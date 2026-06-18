import { motion, AnimatePresence } from 'framer-motion';
import {
  Monitor,
  Mic,
  Settings,
  ChevronUp,
  Loader2,
  X,
  EyeOff,
  Square,
  Sparkles,
  MessageSquare,
  ArrowRight,
  Send,
  Video,
  MicOff,
} from 'lucide-react';
import { useEffect, useState, useCallback, useRef } from 'react';
import { usePermissionsStore } from '../../../stores/usePermissionsStore';
import type { PermissionKind, PermissionState } from '../../../lib/permissions/types';
import { isPermissionStatusOperational } from '../../../lib/permissions/utils';
import appIconDark from '../../../assets/iconq.png';

/* ── Natively-exact constants ── */
const MODAL_DELAY_MS = 2000;
const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

const PERMISSION_ROWS: Array<{
  key: PermissionKind;
  label: string;
  icon: typeof Monitor;
}> = [
    { key: 'screenRecording', label: 'Screen Recording', icon: Monitor },
    { key: 'microphone', label: 'Microphone', icon: Mic },
  ];

function getStatusInfo(state: PermissionState | undefined) {
  switch (state) {
    case 'granted':
      return { label: 'Access granted', isGranted: true, needsSettings: false };
    case 'denied':
    case 'restart_required':
      return { label: 'Re-enable in Settings', isGranted: false, needsSettings: true };
    default:
      return { label: 'Required', isGranted: false, needsSettings: false };
  }
}

/* ── Framer variants — exact from Natively source ── */
const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
};

/* ── Types ── */
export type WelcomePermissionsStepProps = {
  isAdvancing: boolean;
  onLaunch: () => void;
};

/* ══════════════════════════════════════════════════════════════════════════ */

export function WelcomePermissionsStep({ isAdvancing, onLaunch }: WelcomePermissionsStepProps) {
  const status = usePermissionsStore((s) => s.status);
  const activePermission = usePermissionsStore((s) => s.activePermission);
  const requestPermission = usePermissionsStore((s) => s.requestPermission);
  const openSettings = usePermissionsStore((s) => s.openSettings);
  const refreshPermissions = usePermissionsStore((s) => s.refreshPermissions);

  const [showPermissions, setShowPermissions] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const hasAutoRefreshed = useRef(false);
  const allGranted = status ? isPermissionStatusOperational(status) : false;

  // Show permissions modal after 2s — no loop
  useEffect(() => {
    if (allGranted) return;
    const t = setTimeout(() => setShowPermissions(true), MODAL_DELAY_MS);
    return () => clearTimeout(t);
  }, [allGranted]);

  // One-time refresh on mount
  useEffect(() => {
    if (!hasAutoRefreshed.current) {
      hasAutoRefreshed.current = true;
      void refreshPermissions();
    }
  }, [refreshPermissions]);

  const handlePermissionAction = useCallback(
    (p: PermissionKind) => {
      const s = status?.[p];
      if (s === 'denied' || s === 'restart_required') void openSettings(p);
      else void requestPermission(p);
    },
    [status, openSettings, requestPermission],
  );

  const dismissModal = () => { setDismissed(true); setShowPermissions(false); };
  const permissionsVisible = showPermissions && !dismissed && !allGranted;

  /* ══════════════════════ RENDER ══════════════════════ */
  return (
    <motion.div
      key="v3-welcome"
      initial={{ opacity: 0 }}
      animate={isAdvancing ? { opacity: 0, scale: 1.02 } : { opacity: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.4, ease: EASE }}
      className={`fixed inset-0 z-[140] flex overflow-hidden ${isAdvancing ? 'pointer-events-none' : ''}`}
      style={{
        /* Natively: lg:grid lg:grid-cols-[1fr_1fr] — 50/50 split */
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        fontFamily: "'Inter', 'Geist', ui-sans-serif, system-ui, sans-serif",
        backgroundColor: '#f3f3f4',
        color: '#2f2f34',
      }}
    >
      {/* ═══ LEFT PANEL — bg-white, p-12, centered ═══ */}
      <motion.div
        className="relative flex flex-col items-center justify-center w-full h-full p-12 bg-white"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <div
          className="flex flex-col items-center w-full mt-auto"
          style={{ transform: 'translateY(-4px)' }}
        >
          {/* Title — Inter Medium, 44px, gradient text (exact from Natively source) */}
          <motion.h1
            variants={fadeUp}
            className="text-center mb-3"
            style={{
              fontSize: '44px',
              fontWeight: 500,
              letterSpacing: '-0.5px',
              lineHeight: 1.2,
              background: 'linear-gradient(180deg, #2f2f34 0%, #50505a 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Welcome to Quietly
          </motion.h1>

          {/* Subtitle — Celeb MF Light fallback to Georgia, 25px (exact from Natively) */}
          <motion.p
            variants={fadeUp}
            className="text-center mb-12"
            style={{
              fontSize: '25px',
              color: '#a7a7ad',
              fontFamily: "Georgia, 'Times New Roman', 'Noto Serif', serif",
              fontWeight: 300,
            }}
          >
            The ultimate AI meeting assistant
          </motion.p>

          {/* Continue Button — exact Natively values */}
          <motion.div variants={fadeUp} className="w-full flex justify-center">
            <motion.button
              type="button"
              onClick={() => { if (!isAdvancing) onLaunch(); }}
              disabled={isAdvancing}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="relative w-full max-w-[320px] h-[64px] rounded-[20px] text-[20px] font-medium text-white flex items-center justify-center cursor-pointer outline-none overflow-hidden transition-all"
              style={{
                background: 'linear-gradient(135deg, #082f49 0%, #0ea5e9 52%, #2563eb 100%)',
                boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.6), inset 0 -1px 2px rgba(8,47,73,0.3), 0 2px 10px rgba(14,165,233,0.32), 0 0 0 1px rgba(255,255,255,0.14)',
                border: 'none',
              }}
            >
              {/* Glass bevel highlight — same as launcher */}
              <span
                className="absolute top-0 left-2.5 right-2.5 rounded-full pointer-events-none z-10"
                style={{
                  height: '38%',
                  background: 'linear-gradient(to bottom, rgba(255,255,255,0.35), transparent)',
                  filter: 'blur(2px)',
                  opacity: 0.8,
                }}
              />
              <span className="relative z-20 flex items-center">
                Continue{' '}
                <span className="ml-[10px] text-[22px] opacity-90">›</span>
              </span>
            </motion.button>
          </motion.div>
        </div>

        {/* Bottom section — legal + social proof */}
        <motion.div variants={fadeUp} className="mt-auto flex flex-col items-center w-full">
          {/* Legal text — exact Natively: text-[12px] opacity-60 mb-6 */}
          <p
            className="text-[12px] mb-6 text-center"
            style={{ color: '#a7a7ad', opacity: 0.6 }}
          >
            By clicking Continue, you agree to our{' '}
            <span
              className="font-semibold underline cursor-pointer transition-colors"
              style={{
                color: '#2f2f34',
                textUnderlineOffset: '3px',
                textDecorationColor: 'rgba(47,47,52,0.30)',
              }}
            >
              Terms & Conditions
            </span>{' '}
            and{' '}
            <span
              className="font-semibold underline cursor-pointer transition-colors"
              style={{
                color: '#2f2f34',
                textUnderlineOffset: '3px',
                textDecorationColor: 'rgba(47,47,52,0.30)',
              }}
            >
              Privacy Policy
            </span>
            .
          </p>

          {/* Social proof — compact to fit one line */}
          <div
            className="flex items-center justify-center select-none mb-10 flex-nowrap"
            style={{ gap: '12px', color: '#9ea3ab', opacity: 0.9, transform: 'translateY(2px)' }}
          >
            {/* Hacker News — Natively exact: w-[18px] h-[18px] bg-current rounded-[1.5px] */}
            <div className="flex items-center gap-1 transition-opacity hover:opacity-100">
              <div
                className="flex items-center justify-center"
                style={{
                  width: 15, height: 15,
                  backgroundColor: 'currentColor',
                  borderRadius: '1.5px',
                  transform: 'translateY(-1px)',
                }}
              >
                <span
                  className="leading-none"
                  style={{ fontSize: '10px', fontWeight: 700, color: '#f3f3f4', fontFamily: 'Verdana, sans-serif', paddingBottom: '1px' }}
                >
                  Y
                </span>
              </div>
              <span
                className="tracking-tight"
                style={{ fontSize: '11px', fontWeight: 700, color: 'currentColor', fontFamily: 'Verdana, sans-serif' }}
              >
                Hacker News
              </span>
            </div>

            {/* AlternativeTo — simplified SVG matching Natively */}
            <div className="flex items-center gap-1 transition-opacity hover:opacity-100">
              <svg className="fill-current" style={{ width: 16, height: 16 }} viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="11" />
              </svg>
              <span
                className="tracking-tight"
                style={{ fontSize: '11px', fontWeight: 700, color: 'currentColor', fontFamily: 'Verdana, sans-serif' }}
              >
                AlternativeTo
              </span>
            </div>

            {/* Product Hunt */}
            <div className="flex items-center gap-1 transition-opacity hover:opacity-100">
              <svg className="fill-current" style={{ width: 16, height: 16 }} viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="11" />
                <text x="12" y="16" textAnchor="middle" fill="#f3f3f4" fontSize="13" fontWeight="700" fontFamily="Verdana">P</text>
              </svg>
              <span
                className="tracking-tight"
                style={{ fontSize: '11px', fontWeight: 700, color: 'currentColor', fontFamily: 'Verdana, sans-serif' }}
              >
                Product Hunt
              </span>
            </div>

            {/* reddit */}
            <div className="flex items-center gap-1 transition-opacity hover:opacity-100">
              <svg className="fill-current" style={{ width: 16, height: 16 }} viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="11" />
                <circle cx="12" cy="12" r="4" fill="#f3f3f4" />
                <circle cx="12" cy="5.5" r="1.5" fill="#f3f3f4" />
              </svg>
              <span
                className="tracking-tight"
                style={{ fontSize: '11px', fontWeight: 700, color: 'currentColor', fontFamily: 'Verdana, sans-serif' }}
              >
                reddit
              </span>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* ═══ RIGHT PANEL — #F0F2F6, grid lines, product demo ═══ */}
      <div
        className="hidden lg:flex flex-col relative items-center justify-center overflow-hidden w-full h-full"
        style={{ backgroundColor: '#F0F2F6' }}
      >
        {/* Animated grid lines — breathing pulse */}
        <style>{`
          @keyframes gridPulse {
            0%, 100% { opacity: 0.5; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.03); }
          }
        `}</style>
        <div
          className="absolute inset-[-20px] z-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)
            `,
            backgroundSize: '48px 48px',
            animation: 'gridPulse 6s ease-in-out infinite',
            willChange: 'transform, opacity',
          }}
        />
        {/* Radial fade — exact Natively: ellipse 80% 80% at 50% 50% */}
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 80% 80% at 50% 50%, transparent 40%, #F0F2F6 100%)',
          }}
        />

        {/* Product demo content */}
        <div
          className="relative z-10 w-full flex flex-col items-center justify-center px-8"
          style={{ paddingBottom: '80px' }}
        >
          {/* ── Mock Overlay Widget (Fie equivalent) ── */}
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 1, ease: EASE }}
            className="relative w-[95%]"
            style={{ zIndex: 2, filter: 'drop-shadow(0 24px 48px rgba(0,0,0,0.25))' }}
          >
            {/* Floating header pill — ABOVE the panel, overlapping (Natively 1:1) */}
            <div
              style={{
                position: 'absolute',
                top: '-18px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 5,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(35,35,50,0.94)',
                backdropFilter: 'blur(12px)',
                borderRadius: '9999px',
                padding: '5px 12px 5px 5px',
                boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
              }}
            >
              <img src={appIconDark} alt="" style={{ width: 26, height: 26, borderRadius: '50%' }} />
              <ChevronUp style={{ width: 11, height: 11, color: 'rgba(255,255,255,0.5)' }} strokeWidth={2} />
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>Hide</span>
              <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.10)', margin: '0 2px' }} />
              <Square style={{ width: 11, height: 11, color: 'rgba(255,255,255,0.35)' }} strokeWidth={1.8} />
            </div>

            <div
              style={{
                borderRadius: '18px',
                overflow: 'hidden',
                background: 'linear-gradient(160deg, rgba(90,90,108,0.88) 0%, rgba(55,55,70,0.93) 50%, rgba(35,35,48,0.96) 100%)',
                backdropFilter: 'blur(24px)',
                paddingTop: '14px',
              }}
            >

              {/* Blue pill suggestion */}
              <div className="flex justify-end px-4 pb-2">
                <div
                  className="relative rounded-[14px] px-4 py-2 text-[13px] font-medium text-white overflow-hidden"
                  style={{
                    background: 'linear-gradient(160deg, #5B8EF0 0%, #3B6FE8 50%, #2D5FD4 100%)',
                    boxShadow: '0 8px 24px rgba(37,99,235,0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
                  }}
                >
                  <div
                    className="absolute top-0.5 left-2 right-2 rounded-full pointer-events-none"
                    style={{
                      height: '45%',
                      background: 'linear-gradient(to bottom, rgba(255,255,255,0.70), rgba(255,255,255,0.05))',
                      filter: 'blur(0.5px)',
                    }}
                  />
                  <span className="relative" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                    What should I answer?
                  </span>
                </div>
              </div>

              {/* AI response */}
              <div className="px-4 pb-2">
                <p className="text-white/90 text-[14px] leading-relaxed font-normal whitespace-pre-wrap">
                  Based on the project requirements and current timeline, I've outlined the critical path for the next sprint.
                </p>
              </div>

              {/* Quick action chips */}
              <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                {[
                  { icon: Sparkles, label: 'What should I answer?' },
                  { icon: MessageSquare, label: 'Clarify' },
                  { icon: ArrowRight, label: 'Follow up questions' },
                  { icon: MessageSquare, label: 'Recap' },
                ].map((c) => (
                  <div
                    key={c.label}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/60 whitespace-nowrap"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.04)',
                    }}
                  >
                    <c.icon style={{ width: 10, height: 10, flexShrink: 0 }} strokeWidth={1.6} />
                    {c.label}
                  </div>
                ))}
              </div>

              {/* Chat input */}
              <div className="mx-4 mb-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.04)' }}>
                <span className="text-[11px] text-white/25">
                  Ask anything — Quietly knows your resume and this company...
                </span>
              </div>

              {/* Model selector + send */}
              <div className="flex items-center justify-between px-4 pb-3">
                <div className="px-2 py-1 rounded text-[10px] text-white/35" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  Quietly AI ▾
                </div>
                <div
                  className="flex items-center justify-center"
                  style={{ width: 24, height: 24, borderRadius: '50%', background: '#3B6FE8' }}
                >
                  <Send style={{ width: 10, height: 10, color: '#fff' }} strokeWidth={2} />
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Video card — overlaps widget via -mt-[160px] (exact Natively) ── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 1, ease: EASE }}
            className="w-[92%] rounded-[14px] overflow-hidden ring-1 ring-black/5"
            style={{
              aspectRatio: '16 / 9',
              zIndex: 1,
              marginTop: '-160px',
              boxShadow: '0 16px 40px rgba(0,0,0,0.18)',
            }}
          >
            <video
              src="hero.webm"
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-full object-cover bg-black"
            />
          </motion.div>
        </div>

        {/* Caption — exact Natively: absolute bottom-16, 36px, charcoalInk */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 1, ease: EASE }}
          className="absolute bottom-16 z-20 text-center px-12"
        >
          <h2
            className="font-medium leading-[1.25] tracking-tight"
            style={{ fontSize: '36px', color: '#18181B' }}
          >
            Real-time meeting assistant,
            <br />
            always ready to help
          </h2>
        </motion.div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/*  PERMISSIONS MODAL — white, pops up after 2 seconds              */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {permissionsVisible && (
          <>
            {/* Scrim */}
            <motion.div
              key="perm-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="fixed inset-0 z-[150]"
              style={{ background: 'rgba(0,0,0,0.10)', backdropFilter: 'blur(3px)' }}
              onClick={dismissModal}
            />

            {/* Modal card */}
            <motion.div
              key="perm-modal"
              initial={{ opacity: 0, y: 28, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              transition={{ type: 'spring', duration: 0.55, bounce: 0.12 }}
              className="fixed z-[151]"
              style={{
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '420px',
                background: '#ffffff',
                borderRadius: '20px',
                boxShadow: '0 24px 64px rgba(0,0,0,0.14), 0 8px 20px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.03)',
                overflow: 'hidden',
              }}
            >
              {/* Close X */}
              <button
                type="button"
                onClick={dismissModal}
                className="absolute top-4 right-4 w-7 h-7 rounded-full flex items-center justify-center z-10 transition-colors hover:bg-black/[0.06] active:scale-[0.92]"
                style={{ background: 'rgba(0,0,0,0.04)', border: 'none', cursor: 'pointer', color: '#8e8e93' }}
              >
                <X style={{ width: 14, height: 14 }} strokeWidth={2.5} />
              </button>

              <div className="p-7 pb-6">
                {/* Eyebrow */}
                <div className="flex items-center gap-2">
                  <img src={appIconDark} alt="" style={{ width: 24, height: 24, borderRadius: '7px' }} />
                  <span
                    className="uppercase"
                    style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: '#8e8e93' }}
                  >
                    Permissions
                  </span>
                </div>

                {/* Heading */}
                <h2
                  className="mt-4"
                  style={{ fontSize: '28px', fontWeight: 700, lineHeight: 1.14, color: '#1a1a2e', letterSpacing: '-0.02em' }}
                >
                  Let's get you set up
                </h2>
                <p className="mt-1.5" style={{ fontSize: '13.5px', lineHeight: 1.5, color: '#8e8e93' }}>
                  Quietly needs a few permissions to capture meetings and transcribe speech.
                </p>

                {/* Permission rows */}
                <div className="mt-6 flex flex-col gap-2.5">
                  {PERMISSION_ROWS.map((perm, i) => {
                    const state = status?.[perm.key];
                    const info = getStatusInfo(state);
                    const isActive = activePermission === perm.key;
                    const Icon = perm.icon;

                    return (
                      <motion.div
                        key={perm.key}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.06 + i * 0.06, duration: 0.35, ease: EASE }}
                        className="flex items-center gap-3.5 p-3.5 rounded-[14px]"
                        style={{ background: '#f7f8fa', border: '1px solid rgba(0,0,0,0.04)' }}
                      >
                        {/* Icon */}
                        <div
                          className="flex items-center justify-center shrink-0"
                          style={{
                            width: 42, height: 42, borderRadius: '12px',
                            background: info.isGranted ? 'rgba(52,199,89,0.14)' : 'rgba(52,199,89,0.08)',
                          }}
                        >
                          <Icon
                            style={{ width: 20, height: 20, color: info.isGranted ? '#34c759' : '#6ec985' }}
                            strokeWidth={1.8}
                          />
                        </div>

                        {/* Labels */}
                        <div className="flex-1 min-w-0">
                          <div style={{ fontSize: '15px', fontWeight: 600, color: '#1a1a2e' }}>{perm.label}</div>
                          <div
                            className="mt-0.5"
                            style={{
                              fontSize: '12px', fontWeight: 500,
                              color: info.isGranted ? '#34c759' : info.needsSettings ? '#ff453a' : '#8e8e93',
                            }}
                          >
                            {info.label}
                          </div>
                        </div>

                        {/* iOS Toggle */}
                        <button
                          type="button"
                          onClick={() => handlePermissionAction(perm.key)}
                          disabled={info.isGranted || isActive || isAdvancing}
                          className="shrink-0 transition-transform active:scale-[0.92]"
                          style={{ border: 'none', background: 'none', padding: 0, cursor: info.isGranted ? 'default' : 'pointer' }}
                        >
                          {isActive ? (
                            <div className="w-[51px] h-[31px] flex items-center justify-center">
                              <Loader2 style={{ width: 18, height: 18, color: '#8e8e93' }} className="animate-spin" />
                            </div>
                          ) : (
                            <div
                              className="flex items-center"
                              style={{
                                width: 51, height: 31, borderRadius: 9999,
                                background: info.isGranted ? '#34c759' : 'rgba(0,0,0,0.09)',
                                padding: 2,
                                justifyContent: info.isGranted ? 'flex-end' : 'flex-start',
                                transition: 'background 0.25s ease',
                              }}
                            >
                              <motion.div
                                layout
                                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                style={{
                                  width: 27, height: 27, borderRadius: '50%',
                                  background: '#fff',
                                  boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.06)',
                                }}
                              />
                            </div>
                          )}
                        </button>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Open Settings CTA — same Natively blue gradient */}
                <motion.button
                  type="button"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2, duration: 0.35 }}
                  onClick={() => void openSettings('screenRecording')}
                  className="relative w-full mt-5 h-[48px] rounded-[16px] text-[14px] font-semibold text-white flex items-center justify-center gap-1.5 cursor-pointer overflow-hidden transition-all active:scale-[0.97]"
                  style={{
                    background: 'linear-gradient(160deg, #5B8EF0 0%, #3B6FE8 50%, #2D5FD4 100%)',
                    boxShadow: '0 6px 20px rgba(37,99,235,0.30), inset 0 1px 0 rgba(255,255,255,0.2)',
                    border: 'none',
                  }}
                >
                  <span
                    className="absolute top-0.5 left-2 right-2 rounded-full pointer-events-none"
                    style={{
                      height: '40%',
                      background: 'linear-gradient(to bottom, rgba(255,255,255,0.50), rgba(255,255,255,0.03))',
                      filter: 'blur(0.5px)',
                    }}
                  />
                  <Settings style={{ width: 15, height: 15, opacity: 0.8 }} strokeWidth={1.8} />
                  <span className="relative z-10">Open Settings</span>
                </motion.button>

                {/* Settings path hint */}
                <p
                  className="mt-3 text-center uppercase"
                  style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(0,0,0,0.18)' }}
                >
                  System Settings → Privacy & Security
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
