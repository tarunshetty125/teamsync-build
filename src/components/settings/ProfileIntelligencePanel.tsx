import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import {
  X,
  Upload,
  RefreshCw,
  Briefcase,
  Trash2,
  ArrowUpRight,
  AlertCircle,
  Pencil,
  Check,
  ChevronRight,
  Brain,
  FileText,
  Layers,
  Zap,
} from 'lucide-react';

/* ── Types ──────────────────────────────────────────────────────── */
interface ProfileIntelligencePanelProps {
  onClose: () => void;
  isPremium?: boolean;
  isLoaded?: boolean;
  isTrialActive?: boolean;
  onUnlockPro?: () => void;
}

/* ── Color System (onboarding aurora palette) ───────────────────── */
const TONES = {
  indigo: {
    glow: 'bg-[radial-gradient(circle_at_16%_18%,rgba(109,94,194,0.24),transparent_46%),linear-gradient(135deg,rgba(255,255,255,0.015),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_18%_18%,rgba(109,94,194,0.32),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.025),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#3d3466]/[0.55] border-[#6d5ec2]/60',
    icon: 'text-[#e8e4fa]',
    accent: '#8b7fdb',
  },
  teal: {
    glow: 'bg-[radial-gradient(circle_at_84%_22%,rgba(61,188,156,0.22),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.015),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_82%_24%,rgba(61,188,156,0.30),transparent_50%),linear-gradient(135deg,rgba(255,255,255,0.025),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#1e453a]/[0.60] border-[#3dbc9c]/60',
    icon: 'text-[#e6f9f3]',
    accent: '#42dba9',
  },
  amber: {
    glow: 'bg-[radial-gradient(circle_at_28%_76%,rgba(218,137,64,0.22),transparent_50%),linear-gradient(135deg,rgba(255,255,255,0.015),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_28%_76%,rgba(218,137,64,0.30),transparent_52%),linear-gradient(135deg,rgba(255,255,255,0.025),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#4a2e14]/[0.60] border-[#da8940]/60',
    icon: 'text-[#ffecd6]',
    accent: '#da8940',
  },
  cyan: {
    glow: 'bg-[radial-gradient(circle_at_80%_76%,rgba(58,213,224,0.18),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.015),rgba(255,255,255,0))]',
    hoverGlow: 'group-hover:bg-[radial-gradient(circle_at_80%_76%,rgba(58,213,224,0.26),transparent_50%),linear-gradient(135deg,rgba(255,255,255,0.025),rgba(255,255,255,0))]',
    iconWrap: 'bg-[#14373d]/[0.60] border-[#3ad5e0]/55',
    icon: 'text-[#e2fafd]',
    accent: '#3ad5e0',
  },
} as const;

type ToneName = keyof typeof TONES;

/* ── Motion presets (Emil: custom cubic-bezier, <300ms for UI) ─── */
const entryEase: [number, number, number, number] = [0.23, 1, 0.32, 1];

const surfaceVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { delayChildren: 0.04, staggerChildren: 0.035 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.24, ease: entryEase },
  },
};

/* ── Micro-detail skeleton bars (like Modes' MicroDetail) ──────── */
function MicroSkeleton({ accent, lines = 2 }: { accent: string; lines?: number }) {
  return (
    <div className="space-y-[5px] rounded-[11px] border border-white/[0.08] bg-black/18 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-[4px] rounded-full"
          style={{
            width: i === 0 ? '78%' : i === 1 ? '54%' : '40%',
            background: i === 1 ? `${accent}55` : 'rgba(255,255,255,0.12)',
          }}
        />
      ))}
    </div>
  );
}

/* ── Stat chip (compact inline stat) ───────────────────────────── */
function StatChip({ value, label, accent }: { value: number; label: string; accent: string }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-black/20 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <span className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/30">{label}</span>
      <span className="text-[11px] font-bold tabular-nums" style={{ color: accent }}>{value}</span>
    </div>
  );
}

/* ── Bento Card (matches Modes ModeCard architecture exactly) ─── */
function BentoCard({
  title,
  description,
  tone,
  icon: Icon,
  children,
  className,
  onClick,
  disabled,
}: {
  title: string;
  description?: string;
  tone: ToneName;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const t = TONES[tone];
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.article
      whileHover={prefersReducedMotion ? undefined : { y: -2, scale: 1.008 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      onClick={disabled ? undefined : onClick}
      className={clsx(
        'group relative overflow-hidden rounded-[24px] border-[2px] border-white/[0.12] bg-[#1c1c1d] shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_18px_44px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]',
        onClick && !disabled && 'cursor-pointer',
        disabled && 'opacity-60',
        className,
      )}
    >
      {/* Radial glow */}
      <div className={clsx('pointer-events-none absolute inset-0 opacity-100 transition-all duration-200', t.glow, t.hoverGlow)} />
      {/* Inner bevel — outer */}
      <div className="pointer-events-none absolute inset-[1px] rounded-[23px] border border-white/[0.05] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_-40px_80px_rgba(0,0,0,0.12)]" />
      {/* Inner bevel — inner (double-bezel) */}
      <div
        className="pointer-events-none absolute inset-[5px] rounded-[18px] border-2 border-white/[0.08]"
        style={{
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(255,255,255,0.03), inset 0 0 0 1px ${t.accent}18`,
        }}
      />
      {/* Shimmer sweep */}
      {!prefersReducedMotion && (
        <motion.div
          className="pointer-events-none absolute -left-24 top-0 h-full w-24 rotate-12 bg-white/[0.06] blur-xl"
          animate={{ x: [-80, 430], opacity: [0, 0.3, 0] }}
          transition={{ duration: 4.8, repeat: Infinity, repeatDelay: 2.2, ease: 'easeInOut' }}
        />
      )}

      <div className="relative z-10 h-full rounded-[23px] p-4 md:p-5">
        <div className="flex items-start gap-3">
          <div
            className={clsx(
              'flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[14px] border backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]',
              t.iconWrap,
            )}
          >
            <Icon className={clsx('h-[17px] w-[17px] stroke-[2]', t.icon)} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold tracking-[-0.04em] text-white truncate">{title}</h3>
            {description && (
              <p className="mt-0.5 text-[11.5px] leading-[1.3] tracking-[-0.02em] text-white/40">{description}</p>
            )}
          </div>
        </div>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </motion.article>
  );
}

/* ── Main Panel ─────────────────────────────────────────────────── */
const ProfileIntelligencePanel: React.FC<ProfileIntelligencePanelProps> = ({
  onClose,
  isPremium = false,
  isTrialActive = false,
  onUnlockPro,
}) => {
  const hasProfileAccess = isPremium || isTrialActive;
  const prefersReducedMotion = useReducedMotion();

  /* ── Profile State ──────────────────────────────────────── */
  const [profileStatus, setProfileStatus] = useState<{
    hasProfile: boolean;
    profileMode: boolean;
    isReady: boolean;
  }>({ hasProfile: false, profileMode: false, isReady: false });
  const [profileData, setProfileData] = useState<any>(null);
  const [profileUploading, setProfileUploading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [jdUploading, setJdUploading] = useState(false);
  const [jdError, setJdError] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [customNotesSaved, setCustomNotesSaved] = useState(false);
  const customNotesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadGenerationRef = useRef(0);
  const profileGenerationRef = useRef(0);
  const [profileViewStatus, setProfileViewStatus] = useState<'idle' | 'processing' | 'ready' | 'empty' | 'error'>('idle');

  const canEnableProfileIntelligence = hasProfileAccess && profileStatus.hasProfile;
  const isActive = profileStatus.profileMode && canEnableProfileIntelligence;

  /* ── Data loading ───────────────────────────────────────── */
  const refreshProfileState = useCallback(async () => {
    try {
      const [status, profile, notes] = await Promise.all([
        window.electronAPI?.profileGetStatus?.(),
        window.electronAPI?.profileGetProfile?.(),
        window.electronAPI?.profileGetNotes?.(),
      ]);
      if (status) {
        setProfileStatus({
          hasProfile: status.hasProfile ?? false,
          profileMode: status.profileMode ?? false,
          isReady: status.isReady ?? false,
        });
      }
      if (profile) { setProfileData(profile); setProfileViewStatus('ready'); }
      else { setProfileViewStatus('empty'); }
      if (notes?.content !== undefined) setCustomNotes(notes.content);
    } catch (e) { console.warn('[ProfileKnowledgePanel] Failed to load:', e); }
  }, []);

  useEffect(() => { refreshProfileState(); }, [refreshProfileState]);

  /* ── Handlers ───────────────────────────────────────────── */
  const handleSelectResume = async () => {
    setProfileError('');
    try {
      const fileResult = await window.electronAPI?.profileSelectFile?.();
      if (fileResult?.cancelled || !fileResult?.fileToken) return;
      const genId = Date.now();
      uploadGenerationRef.current = genId;
      setProfileUploading(true);
      setProfileViewStatus('processing');
      setProfileData(null);
      profileGenerationRef.current = 0;
      const result = await window.electronAPI?.profileUploadResume?.(fileResult.fileToken);
      if (uploadGenerationRef.current !== genId) return;
      if (result?.success) { await refreshProfileState(); }
      else if (result?.error === 'STALE_GENERATION') { return; }
      else { setProfileViewStatus('error'); setProfileError(result?.error || 'Resume upload failed'); }
    } catch (e: any) { setProfileViewStatus('error'); setProfileError(e.message || 'Resume upload failed'); }
    finally { setProfileUploading(false); }
  };

  const handleSelectJD = async () => {
    setJdError('');
    try {
      const fileResult = await window.electronAPI?.profileSelectFile?.();
      if (fileResult?.cancelled || !fileResult?.fileToken) return;
      const genId = Date.now();
      uploadGenerationRef.current = genId;
      setJdUploading(true);
      setProfileViewStatus('processing');
      setProfileData(null);
      profileGenerationRef.current = 0;
      const result = await window.electronAPI?.profileUploadJD?.(fileResult.fileToken);
      if (uploadGenerationRef.current !== genId) return;
      if (result?.success) { await refreshProfileState(); }
      else if (result?.error === 'STALE_GENERATION') { return; }
      else { setProfileViewStatus('error'); setJdError(result?.error || 'JD upload failed'); }
    } catch (e: any) { setProfileViewStatus('error'); setJdError(e.message || 'JD upload failed'); }
    finally { setJdUploading(false); }
  };

  const handleToggleProfileMode = async () => {
    if (!canEnableProfileIntelligence) return;
    const newState = !profileStatus.profileMode;
    setProfileStatus((prev) => ({ ...prev, profileMode: newState }));
    try {
      const result = await window.electronAPI?.profileSetMode?.(newState);
      if (!result?.success) setProfileStatus((prev) => ({ ...prev, profileMode: !newState }));
    } catch { setProfileStatus((prev) => ({ ...prev, profileMode: !newState })); }
  };

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await window.electronAPI?.profileHardDeleteAll?.('launcher-panel');
      setProfileStatus({ hasProfile: false, profileMode: false, isReady: false });
      setProfileData(null);
      setCustomNotes('');
      setProfileViewStatus('empty');
      setDeleteConfirm(false);
    } catch {} finally { setDeleting(false); }
  };

  return (
    <motion.section
      initial={prefersReducedMotion ? false : 'hidden'}
      animate="show"
      variants={surfaceVariants}
      className="relative flex h-full flex-col overflow-hidden bg-[#151515] text-white"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", sans-serif' }}
    >
      {/* Top gradient wash — same as Modes */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0))]" />

      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-5 top-5 z-20 flex h-[36px] w-[36px] items-center justify-center rounded-full border border-white/[0.035] bg-white/[0.05] text-white/45 backdrop-blur-sm transition-colors duration-200 hover:text-white/70"
      >
        <X className="h-[18px] w-[18px] stroke-[2]" />
      </button>

      {/* ── Scrollable Content ─────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 pb-3 pt-[38px] md:px-6">
        <div className="mx-auto flex max-w-[720px] flex-col">
          {/* ── Header (Modes-style centered) ───────────────── */}
          <motion.header variants={itemVariants} className="mx-auto max-w-[560px] text-center">
            <h1 className="text-[30px] font-semibold leading-[0.94] tracking-[-0.06em] text-white md:text-[34px]">
              <span className="block">Your knowledge.</span>
              <span className="mt-1 block">Always in context.</span>
            </h1>
            <p className="mx-auto mt-3 max-w-[500px] text-[12.5px] leading-[1.34] tracking-[-0.03em] text-white/38 md:text-[13.5px]">
              Career graph, resume intelligence, and job context — a persistent persona engine for every conversation.
            </p>
          </motion.header>

          {/* ── Bento Grid ──────────────────────────────────── */}
          <motion.div variants={itemVariants} className="mx-auto mt-4 w-full max-w-[720px]">
            <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[auto_auto_auto]">

              {/* ── Card 1: Persona Engine (tall, left, spans 2 rows) */}
              <BentoCard
                title={profileData?.identity?.name || 'Identity Engine'}
                description={profileData?.identity?.email || 'Upload a resume to initialize your persona.'}
                tone="indigo"
                icon={Brain}
                className="lg:row-span-2 min-h-[180px]"
              >
                <div className="flex flex-col gap-3">
                  {/* Toggle */}
                  <div className={clsx(
                    'flex items-center justify-between rounded-[12px] border px-3 py-2 transition-all duration-200',
                    !canEnableProfileIntelligence
                      ? 'opacity-40 cursor-not-allowed border-white/[0.04] bg-white/[0.02]'
                      : 'border-white/[0.08] bg-black/20'
                  )}>
                    <div className="flex items-center gap-2">
                      <Zap className="h-3.5 w-3.5 text-white/30" />
                      <span className="text-[11px] font-medium text-white/45 tracking-[-0.01em]">Persona Engine</span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isActive}
                      disabled={!canEnableProfileIntelligence}
                      onClick={handleToggleProfileMode}
                      className={clsx(
                        'relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
                        isActive ? 'bg-emerald-500 shadow-[0_0_14px_rgba(52,211,153,0.25)]' : 'bg-white/[0.10]'
                      )}
                    >
                      <motion.span
                        layout
                        className="inline-block h-[16px] w-[16px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)]"
                        animate={{ x: isActive ? 18 : 2 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    </button>
                  </div>

                  {/* Inline stats row */}
                  <div className="flex flex-wrap gap-1.5">
                    <StatChip value={profileData?.experienceCount || 0} label="exp" accent={TONES.indigo.accent} />
                    <StatChip value={profileData?.projectCount || 0} label="proj" accent={TONES.teal.accent} />
                    <StatChip value={profileData?.nodeCount || 0} label="nodes" accent={TONES.amber.accent} />
                  </div>

                  {/* Skills */}
                  {profileData?.skills && profileData.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {profileData.skills.slice(0, 8).map((skill: string, i: number) => (
                        <motion.span
                          key={i}
                          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.3 + i * 0.03, duration: 0.2, ease: entryEase }}
                          className="text-[9px] font-medium text-white/30 px-2 py-[3px] rounded-full border border-white/[0.06] bg-white/[0.025]"
                        >
                          {skill}
                        </motion.span>
                      ))}
                    </div>
                  )}

                  {/* Micro detail */}
                  <div className="mt-auto">
                    <MicroSkeleton accent={TONES.indigo.accent} lines={3} />
                  </div>
                </div>
              </BentoCard>

              {/* ── Card 2: Resume Upload (top-right) ─────────── */}
              <BentoCard
                title={profileStatus.hasProfile ? 'Update Resume' : 'Initialize Knowledge'}
                description={profileUploading ? 'Processing structural semantics...' : 'Seed the engine with your career data.'}
                tone="teal"
                icon={profileUploading ? RefreshCw : Upload}
                onClick={profileViewStatus === 'processing' ? undefined : handleSelectResume}
                disabled={profileViewStatus === 'processing'}
                className="min-h-[86px]"
              >
                <div className="flex items-center justify-between gap-3">
                  <MicroSkeleton accent={TONES.teal.accent} />
                  <div className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-black/20 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                    <span className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/30">
                      {profileUploading ? 'ingesting' : 'upload'}
                    </span>
                    <span style={{ color: TONES.teal.accent }} className="text-[8px] font-bold uppercase tracking-[0.14em]">
                      {profileUploading ? '...' : 'PDF'}
                    </span>
                  </div>
                </div>
                {profileError && (
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-400 font-medium">
                    <AlertCircle size={10} /> {profileError}
                  </div>
                )}
              </BentoCard>

              {/* ── Card 3 & 4: JD + Custom Context (bottom-right row) */}
              <div className="grid gap-2.5 sm:grid-cols-2">
                {/* JD Card */}
                <BentoCard
                  title={profileData?.hasActiveJD
                    ? `${profileData.activeJD?.title || 'Job'}` : 'Job Description'}
                  description={jdUploading ? 'Parsing JD...' : profileData?.hasActiveJD
                    ? `${profileData.activeJD?.company || '—'}` : 'Persona tuning.'}
                  tone="amber"
                  icon={jdUploading ? RefreshCw : Briefcase}
                  onClick={profileViewStatus === 'processing' ? undefined : handleSelectJD}
                  disabled={profileViewStatus === 'processing'}
                >
                  {jdError && (
                    <div className="flex items-center gap-1.5 text-[10px] text-red-400 font-medium">
                      <AlertCircle size={10} /> {jdError}
                    </div>
                  )}
                </BentoCard>

                {/* Custom Context Card */}
                <BentoCard
                  title="Custom Context"
                  description="Persistent memory."
                  tone="cyan"
                  icon={Pencil}
                >
                  {hasProfileAccess && (
                    <div className="relative">
                      <textarea
                        value={customNotes}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val.length > 4000) return;
                          setCustomNotes(val);
                          setCustomNotesSaved(false);
                          if (customNotesDebounceRef.current) clearTimeout(customNotesDebounceRef.current);
                          customNotesDebounceRef.current = setTimeout(async () => {
                            try { await window.electronAPI?.profileSaveNotes?.(val); setCustomNotesSaved(true); setTimeout(() => setCustomNotesSaved(false), 2000); } catch {}
                          }, 800);
                        }}
                        placeholder="e.g. My target salary is $180k base"
                        rows={2}
                        className="w-full resize-none rounded-[10px] border border-white/[0.06] bg-black/20 px-3 py-2 text-[10.5px] text-white/50 placeholder:text-white/16 focus:outline-none focus:border-white/[0.12] transition-colors duration-200 shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]"
                      />
                      <AnimatePresence>
                        {customNotesSaved && (
                          <motion.span
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            className="absolute -top-1 right-0 text-[7px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full border border-emerald-500/20 uppercase tracking-[0.12em] flex items-center gap-0.5"
                          >
                            <Check size={6} /> Saved
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </BentoCard>
              </div>

              {/* ── Card 5: Delete (full-width bottom, conditional) */}
              {profileStatus.hasProfile && (
                <div className="lg:col-span-2">
                  <AnimatePresence mode="wait">
                    {!deleteConfirm ? (
                      <motion.button
                        key="del-trigger"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setDeleteConfirm(true)}
                        className="w-full flex items-center justify-center gap-2 rounded-[14px] border border-white/[0.04] bg-white/[0.02] px-4 py-2.5 text-[12px] font-medium text-white/20 hover:text-red-400 hover:border-red-500/12 hover:bg-red-500/[0.03] transition-all duration-200"
                      >
                        <Trash2 size={12} />
                        Reset Profile Knowledge
                      </motion.button>
                    ) : (
                      <motion.div
                        key="del-confirm"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="rounded-[14px] border border-red-500/15 bg-red-500/[0.03] p-4 overflow-hidden"
                      >
                        <p className="text-[11px] text-red-300/50 mb-3 leading-relaxed">
                          This permanently removes all profile data from this device.
                        </p>
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => setDeleteConfirm(false)}
                            className="px-3 py-1.5 rounded-full text-[11px] font-medium text-white/30 hover:text-white/50 transition-colors duration-200"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleDelete}
                            disabled={deleting}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-red-500/12 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all duration-200 active:scale-[0.97]"
                          >
                            {deleting ? <RefreshCw size={10} className="animate-spin" /> : <Trash2 size={10} />}
                            {deleting ? 'Deleting...' : 'Confirm'}
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────── */}
      {!hasProfileAccess ? (
        <motion.footer variants={itemVariants} className="border-t border-white/[0.07] px-5 py-2.5 md:px-6 md:py-3">
          <div className="grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-center">
            <button
              type="button"
              onClick={onUnlockPro}
              className="inline-flex items-center gap-1.5 text-[13px] tracking-[-0.02em] text-white/42 transition-colors duration-200 hover:text-white/72"
            >
              <span>I have a license</span>
              <ChevronRight className="h-4 w-4 stroke-[2.2]" />
            </button>

            <div className="text-center md:px-5">
              <p className="text-[13px] tracking-[-0.025em] text-white/40 md:text-[14px]">
                Resume ingestion requires Pro.
              </p>
              <p className="mt-0.5 text-[14px] tracking-[-0.028em] text-[#ffc633] md:text-[15px]">
                Unlock Pro for Profile Knowledge.
              </p>
            </div>

            <button
              type="button"
              onClick={onUnlockPro}
              className="inline-flex h-[44px] items-center justify-between rounded-full bg-white pl-5 pr-2.5 text-[14px] font-semibold tracking-[-0.035em] text-[#141414] shadow-[0_18px_42px_rgba(0,0,0,0.24)] transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99]"
            >
              <span className="min-w-[94px] text-left">Unlock Pro</span>
              <span className="ml-2.5 flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[#ececec] text-[#161616]">
                <ArrowUpRight className="h-[16px] w-[16px] stroke-[2.3]" />
              </span>
            </button>
          </div>
        </motion.footer>
      ) : (
        <motion.footer variants={itemVariants} className="border-t border-white/[0.07] px-5 py-3 md:px-6 md:py-4">
          <div className="flex flex-col items-center justify-between gap-3 text-center md:flex-row md:text-left">
            <div>
              <p className="text-[13px] tracking-[-0.025em] text-white/70 md:text-[14px]">
                {profileStatus.hasProfile
                  ? <>Persona engine {isActive ? <span className="text-emerald-400/80">active</span> : 'paused'} · {profileData?.nodeCount || 0} knowledge nodes</>
                  : 'Upload a resume to initialize your persona engine.'}
              </p>
              <p className="mt-0.5 text-[13px] tracking-[-0.02em] text-white/42">
                Your data never leaves this device.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-[44px] items-center rounded-full border border-white/10 bg-white/[0.06] px-5 text-[14px] font-medium tracking-[-0.03em] text-white transition-colors duration-200 hover:bg-white/[0.09]"
            >
              Close
            </button>
          </div>
        </motion.footer>
      )}
    </motion.section>
  );
};

export default ProfileIntelligencePanel;
