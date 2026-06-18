import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
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
  Sparkles,
} from 'lucide-react';

/* ── Types ──────────────────────────────────────────────────────── */
interface ProfileIntelligencePanelProps {
  onClose: () => void;
  isPremium?: boolean;
  isLoaded?: boolean;
  isTrialActive?: boolean;
  onUnlockPro?: () => void;
}

/* ── Motion presets ─────────────────────────────────────────────── */
const entryEase: [number, number, number, number] = [0.23, 1, 0.32, 1];
const surfaceVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { delayChildren: 0.06, staggerChildren: 0.05 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 14, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.44, ease: entryEase } },
};

/* ── Shimmer sweep (re-used per card) ───────────────────────────── */
function ShimmerSweep({ color = 'white' }: { color?: string }) {
  const prefersReducedMotion = useReducedMotion();
  if (prefersReducedMotion) return null;
  return (
    <motion.div
      className="pointer-events-none absolute -left-24 top-0 h-full w-24 rotate-12 blur-xl"
      style={{ background: `${color === 'white' ? 'rgba(255,255,255,0.08)' : color}` }}
      animate={{ x: [-80, 500], opacity: [0, 0.3, 0] }}
      transition={{ duration: 5.2, repeat: Infinity, repeatDelay: 3.6, ease: 'easeInOut' }}
    />
  );
}

/* ── Animated stat counter ──────────────────────────────────────── */
function AnimatedStat({
  value,
  label,
  dotColor,
  glowColor,
}: {
  value: number;
  label: string;
  dotColor: string;
  glowColor: string;
}) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <div className="flex flex-col items-center justify-center flex-1 py-1">
      <motion.span
        className="text-[26px] font-bold text-white tracking-[-0.04em] leading-none mb-2"
        initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.3 }}
      >
        {value}
      </motion.span>
      <div className="flex items-center gap-1.5">
        <motion.div
          className="w-[5px] h-[5px] rounded-full"
          style={{ background: dotColor, boxShadow: `0 0 12px ${glowColor}` }}
          animate={prefersReducedMotion ? undefined : { scale: [1, 1.4, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <span className="text-[8px] font-semibold text-white/30 uppercase tracking-[0.2em]">
          {label}
        </span>
      </div>
    </div>
  );
}

/* ── Upload Card ────────────────────────────────────────────────── */
function UploadCard({
  title,
  subtitle,
  description,
  isUploading,
  error,
  buttonLabel,
  buttonColor,
  accentColor,
  glowGradient,
  icon: Icon,
  proBadge,
  actionButtons,
  onUpload,
  disabled,
}: {
  title: string;
  subtitle?: string;
  description: string;
  isUploading: boolean;
  error: string;
  buttonLabel: string;
  buttonColor: string;
  accentColor: string;
  glowGradient: string;
  icon: any;
  proBadge?: boolean;
  actionButtons?: React.ReactNode;
  onUpload: () => void;
  disabled: boolean;
}) {
  return (
    <div className="group relative overflow-hidden rounded-[22px] border-[2px] border-white/[0.12] bg-[#1a1a1d] shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_18px_44px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)] transition-all duration-300 hover:border-white/[0.18]">
      {/* Radial glow */}
      <div className={`pointer-events-none absolute inset-0 opacity-100 transition-opacity duration-300 ${glowGradient}`} />
      {/* Inner bevel */}
      <div className="pointer-events-none absolute inset-[1px] rounded-[20px] border border-white/[0.05]" />
      <div className="pointer-events-none absolute inset-[5px] rounded-[16px] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" />
      <ShimmerSweep color={accentColor + '22'} />

      <div className="relative z-10 p-5 flex flex-col min-h-[155px]">
        <div className="flex items-start justify-between mb-4">
          <div className={`flex h-[40px] w-[40px] items-center justify-center rounded-[14px] border backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]`}
            style={{ borderColor: `${accentColor}55`, background: `${accentColor}18` }}>
            {isUploading ? (
              <RefreshCw size={17} className="animate-spin" style={{ color: accentColor }} />
            ) : (
              <Icon size={17} style={{ color: accentColor }} />
            )}
          </div>
          {proBadge && (
            <span className="text-[7px] font-bold text-[#FACC15] bg-[#FACC15]/10 px-2 py-0.5 rounded-full border border-[#FACC15]/20 uppercase tracking-[0.14em]">
              Pro
            </span>
          )}
        </div>

        <h4 className="text-[14px] font-semibold text-white tracking-[-0.03em] mb-0.5">{title}</h4>
        {subtitle && (
          <p className="text-[10px] font-medium mb-1.5" style={{ color: accentColor }}>
            {subtitle}
          </p>
        )}
        <p className="text-[11px] text-white/30 leading-[1.4] mb-auto">
          {description}
        </p>

        <div className="flex items-center gap-2 mt-4">
          {actionButtons}
          <button
            onClick={onUpload}
            disabled={disabled}
            className={`flex-1 group/btn relative flex items-center justify-between rounded-full pl-4 pr-1.5 py-[7px] text-[11px] font-semibold tracking-[-0.02em] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] ${
              disabled
                ? 'bg-white/[0.06] text-white/25 cursor-wait border border-white/[0.06]'
                : `text-white shadow-[0_6px_24px_rgba(0,0,0,0.3)]`
            }`}
            style={!disabled ? { background: buttonColor } : undefined}
          >
            <span>{buttonLabel}</span>
            {!disabled && (
              <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-black/15 transition-transform duration-300 group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-[1px] group-hover/btn:scale-105">
                <ArrowUpRight size={12} className="stroke-[2.5]" />
              </span>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-5 pb-4 relative z-10">
          <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-[12px] flex items-center gap-2 text-[10px] text-red-400 font-medium">
            <AlertCircle size={11} /> {error}
          </div>
        </div>
      )}
    </div>
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
      if (profile) {
        setProfileData(profile);
        setProfileViewStatus('ready');
      } else {
        setProfileViewStatus('empty');
      }
      if (notes?.content !== undefined) setCustomNotes(notes.content);
    } catch (e) {
      console.warn('[ProfileKnowledgePanel] Failed to load:', e);
    }
  }, []);

  useEffect(() => { refreshProfileState(); }, [refreshProfileState]);

  /* ── Resume Upload ──────────────────────────────────────── */
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

  /* ── JD Upload ──────────────────────────────────────────── */
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

  /* ── Profile toggle ─────────────────────────────────────── */
  const handleToggleProfileMode = async () => {
    if (!canEnableProfileIntelligence) return;
    const newState = !profileStatus.profileMode;
    setProfileStatus((prev) => ({ ...prev, profileMode: newState }));
    try {
      const result = await window.electronAPI?.profileSetMode?.(newState);
      if (!result?.success) setProfileStatus((prev) => ({ ...prev, profileMode: !newState }));
    } catch { setProfileStatus((prev) => ({ ...prev, profileMode: !newState })); }
  };

  /* ── Delete ─────────────────────────────────────────────── */
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

  const isActive = profileStatus.profileMode && canEnableProfileIntelligence;

  return (
    <motion.section
      initial={prefersReducedMotion ? false : 'hidden'}
      animate="show"
      variants={surfaceVariants}
      className="relative flex h-full flex-col overflow-hidden"
      style={{ fontFamily: '"SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#0c0e14' }}
    >
      {/* ── Ambient mesh gradients (barely-there) ──────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full opacity-[0.025]"
          style={{ background: 'radial-gradient(circle, #a855f7, transparent 70%)' }} />
        <div className="absolute -bottom-32 -left-32 h-[400px] w-[400px] rounded-full opacity-[0.015]"
          style={{ background: 'radial-gradient(circle, #22c55e, transparent 70%)' }} />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 h-[300px] w-[600px] rounded-full opacity-[0.012]"
          style={{ background: 'radial-gradient(ellipse, #3b82f6, transparent 70%)' }} />
      </div>

      {/* ── Noise overlay ──────────────────────────────────── */}
      <div className="pointer-events-none fixed inset-0 z-[60] opacity-[0.025]"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`, backgroundRepeat: 'repeat' }} />

      {/* ── Close button ───────────────────────────────────── */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-5 top-5 z-20 flex h-[34px] w-[34px] items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.04] text-white/35 backdrop-blur-sm transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white/60 hover:bg-white/[0.08] hover:scale-105 active:scale-95"
      >
        <X className="h-[15px] w-[15px] stroke-[2.2]" />
      </button>

      {/* ── Scrollable Content ─────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-7 pb-6 pt-[42px]">
        <div className="mx-auto flex max-w-[620px] flex-col">
          {/* ── Header ─────────────────────────────────────── */}
          <motion.header variants={itemVariants} className="mb-7">
            <div className="flex items-center gap-2 mb-3">
              <span className="rounded-full px-3 py-1 text-[9px] uppercase tracking-[0.2em] font-semibold border border-violet-500/20 bg-violet-500/[0.08] text-violet-400">
                Beta
              </span>
              {isActive && (
                <span className="rounded-full px-3 py-1 text-[9px] uppercase tracking-[0.2em] font-semibold border border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                  Active
                </span>
              )}
            </div>
            <h1 className="text-[32px] font-bold tracking-[-0.055em] text-white leading-[1.05] mb-2">
              Profile Knowledge
            </h1>
            <p className="text-[14px] tracking-[-0.02em] text-white/32 max-w-[420px] leading-[1.5]">
              Your career graph — resume, skills, and job context engine for personalized AI responses.
            </p>
          </motion.header>

          {/* ── Identity Hero Card ─────────────────────────── */}
          <motion.div variants={itemVariants} className="mb-5">
            <div className="group relative overflow-hidden rounded-[26px] border-[2px] border-white/[0.14] bg-[#1a1a1d] shadow-[0_0_0_1px_rgba(255,255,255,0.055),0_24px_56px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.10)]">
              {/* Radial glow */}
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(132,109,206,0.08),transparent_50%),radial-gradient(circle_at_80%_85%,rgba(34,197,94,0.04),transparent_50%)]" />
              {/* Inner bevels */}
              <div className="pointer-events-none absolute inset-[1px] rounded-[24px] border border-white/[0.05] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" />
              <div className="pointer-events-none absolute inset-[5px] rounded-[20px] border border-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.14),inset_0_-1px_0_rgba(255,255,255,0.03)]" />
              <ShimmerSweep />

              <div className="relative z-10">
                {/* Identity header row */}
                <div className="px-6 pt-6 pb-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {/* Avatar */}
                      <div className="relative">
                        <div className="w-[52px] h-[52px] rounded-full bg-gradient-to-br from-violet-500/15 to-violet-600/5 border-[2px] border-white/[0.10] flex items-center justify-center text-white shadow-[inset_0_2px_4px_rgba(255,255,255,0.06),0_0_16px_rgba(139,92,246,0.06)]">
                          <span className="font-bold text-[18px] tracking-tight">
                            {profileData?.identity?.name ? profileData.identity.name.charAt(0).toUpperCase() : 'U'}
                          </span>
                        </div>
                        {/* Online dot */}
                        {isActive && (
                          <motion.div
                            className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-[2px] border-[#1a1a1d]"
                            style={{ boxShadow: '0 0 12px rgba(52,211,153,0.5)' }}
                            animate={prefersReducedMotion ? undefined : { scale: [1, 1.15, 1] }}
                            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                          />
                        )}
                      </div>
                      <div>
                        <h3 className="text-[16px] font-semibold text-white tracking-[-0.035em]">
                          {profileData?.identity?.name || 'Identity Node Inactive'}
                        </h3>
                        <p className="text-[12px] text-white/30 mt-0.5 tracking-[-0.01em]">
                          {profileData?.identity?.email || 'Upload a resume to begin mapping.'}
                        </p>
                      </div>
                    </div>

                    {/* Persona Engine Toggle */}
                    <div
                      className={`flex items-center gap-3 rounded-full border px-3.5 py-2 transition-all duration-300 ${
                        !canEnableProfileIntelligence
                          ? 'opacity-35 cursor-not-allowed border-white/[0.05] bg-white/[0.02]'
                          : 'border-white/[0.10] bg-white/[0.04] cursor-pointer hover:bg-white/[0.06]'
                      }`}
                    >
                      <span className="text-[11px] font-medium text-white/40 tracking-[-0.01em]">Persona Engine</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isActive}
                        disabled={!canEnableProfileIntelligence}
                        onClick={handleToggleProfileMode}
                        className={`relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                          isActive ? 'bg-emerald-500 shadow-[0_0_16px_rgba(52,211,153,0.3)]' : 'bg-white/[0.10]'
                        }`}
                      >
                        <motion.span
                          layout
                          className="inline-block h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.2)]"
                          animate={{ x: isActive ? 20 : 2 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Stats bar */}
                <div className="mx-6 mb-6">
                  <div className="flex items-center justify-between rounded-[18px] border-[2px] border-white/[0.08] bg-[#12131a] py-5 px-3 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.05)]">
                    <AnimatedStat value={profileData?.experienceCount || 0} label="Experience" dotColor="#22c55e" glowColor="rgba(34,197,94,0.5)" />
                    <div className="h-10 w-px bg-white/[0.06]" />
                    <AnimatedStat value={profileData?.projectCount || 0} label="Projects" dotColor="#3b82f6" glowColor="rgba(59,130,246,0.5)" />
                    <div className="h-10 w-px bg-white/[0.06]" />
                    <AnimatedStat value={profileData?.nodeCount || 0} label="Nodes" dotColor="#a855f7" glowColor="rgba(168,85,247,0.5)" />
                  </div>
                </div>

                {/* Skills */}
                {profileData?.skills && profileData.skills.length > 0 && (
                  <div className="mx-6 mb-6">
                    <div className="text-[8px] font-bold text-white/20 uppercase tracking-[0.2em] mb-2.5">
                      Extracted Skills
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {profileData.skills.slice(0, 14).map((skill: string, i: number) => (
                        <motion.span
                          key={i}
                          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.4 + i * 0.03, duration: 0.2 }}
                          className="text-[10px] font-medium text-white/35 px-2.5 py-[5px] rounded-full border border-white/[0.07] bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                        >
                          {skill}
                        </motion.span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* ── Upload Cards (Bento grid) ──────────────────── */}
          <motion.div variants={itemVariants} className="grid gap-4 grid-cols-2 mb-5">
            <UploadCard
              title={profileStatus.hasProfile ? 'Update Resume' : 'Initialize Knowledge'}
              description={profileUploading ? 'Processing structural semantics...' : 'Seed the intelligence engine with your career data.'}
              isUploading={profileUploading}
              error={profileError}
              buttonLabel={profileUploading ? 'Ingesting...' : 'Select File'}
              buttonColor="linear-gradient(135deg, #7c3aed, #a855f7)"
              accentColor="#a855f7"
              glowGradient="bg-[radial-gradient(circle_at_16%_20%,rgba(168,85,247,0.08),transparent_50%)]"
              icon={Upload}
              proBadge={!hasProfileAccess}
              onUpload={handleSelectResume}
              disabled={profileViewStatus === 'processing'}
            />
            <UploadCard
              title={profileData?.hasActiveJD
                ? `${profileData.activeJD?.title || 'Job'} @ ${profileData.activeJD?.company || '—'}`
                : 'Job Description'}
              subtitle={profileData?.hasActiveJD
                ? `${profileData.activeJD?.level || 'Mid'}-level · ${(profileData.activeJD?.technologies || []).slice(0, 3).join(', ')}`
                : undefined}
              description={jdUploading ? 'Parsing JD structure...' : 'Upload a JD for persona tuning and company research.'}
              isUploading={jdUploading}
              error={jdError}
              buttonLabel={jdUploading ? 'Parsing...' : profileData?.hasActiveJD ? 'Replace JD' : 'Upload JD'}
              buttonColor="linear-gradient(135deg, #2563eb, #3b82f6)"
              accentColor="#3b82f6"
              glowGradient="bg-[radial-gradient(circle_at_84%_22%,rgba(59,130,246,0.08),transparent_50%)]"
              icon={Briefcase}
              proBadge={!hasProfileAccess}
              onUpload={handleSelectJD}
              disabled={profileViewStatus === 'processing'}
              actionButtons={profileData?.hasActiveJD ? (
                <button
                  onClick={async () => { await window.electronAPI?.profileDeleteJD?.(); await refreshProfileState(); }}
                  className="flex items-center justify-center h-[34px] w-[34px] rounded-full border border-white/[0.06] bg-white/[0.04] text-white/30 hover:text-red-400 hover:border-red-500/20 hover:bg-red-500/10 transition-all duration-300 active:scale-95"
                >
                  <Trash2 size={13} />
                </button>
              ) : undefined}
            />
          </motion.div>

          {/* ── Custom Context Card ────────────────────────── */}
          {hasProfileAccess && (
            <motion.div variants={itemVariants} className="mb-5">
              <div className="group relative overflow-hidden rounded-[22px] border-[2px] border-white/[0.12] bg-[#1a1a1d] shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_18px_44px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)]">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(250,204,21,0.06),transparent_50%)]" />
                <div className="pointer-events-none absolute inset-[1px] rounded-[20px] border border-white/[0.05]" />
                <div className="pointer-events-none absolute inset-[5px] rounded-[16px] border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" />

                <div className="relative z-10 p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex h-[40px] w-[40px] items-center justify-center rounded-[14px] border border-[#FACC15]/30 bg-[#FACC15]/[0.08] backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]">
                      <Pencil size={17} className="text-[#FACC15]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-[14px] font-semibold text-white tracking-[-0.03em]">Custom Context</h4>
                        <AnimatePresence>
                          {customNotesSaved && (
                            <motion.span
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.8 }}
                              className="text-[7px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 uppercase tracking-[0.14em] flex items-center gap-1"
                            >
                              <Check size={7} /> Saved
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>
                      <p className="text-[10.5px] text-white/28 mt-0.5">
                        Persistent context — the AI always knows this about you.
                      </p>
                    </div>
                  </div>
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
                    placeholder={`Examples:\n• Q4 ARR was $2.1M, grew 40% YoY\n• My target salary is $180k base\n• I prefer concise, direct answers`}
                    rows={4}
                    className="w-full resize-none rounded-[14px] border-[2px] border-white/[0.07] bg-[#12131a] px-4 py-3 text-[12px] text-white/60 placeholder:text-white/15 focus:outline-none focus:border-white/[0.14] transition-all duration-300 shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]"
                  />
                  <div className="flex items-center justify-end mt-2 px-1">
                    <span className="text-[9px] text-white/18 tracking-wide">{customNotes.length}/4000</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Delete Zone ────────────────────────────────── */}
          {profileStatus.hasProfile && profileData?.hasActiveJD && (
            <motion.div variants={itemVariants} className="mb-4">
              <AnimatePresence mode="wait">
                {!deleteConfirm ? (
                  <motion.button
                    key="delete-trigger"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setDeleteConfirm(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-[16px] border border-white/[0.05] bg-white/[0.02] text-[12px] font-medium text-white/22 hover:text-red-400 hover:border-red-500/15 hover:bg-red-500/[0.04] transition-all duration-300"
                  >
                    <Trash2 size={13} />
                    Delete Profile Knowledge
                  </motion.button>
                ) : (
                  <motion.div
                    key="delete-confirm"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="rounded-[16px] border border-red-500/20 bg-red-500/[0.04] p-5 overflow-hidden"
                  >
                    <p className="text-[12px] text-red-300/60 mb-4 leading-relaxed">
                      Permanently removes Resume, Job Description, AOT results, Snapshots, Dossiers, Notes, and Profile Knowledge from this device.
                    </p>
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => setDeleteConfirm(false)} className="px-4 py-2 rounded-full text-[11px] font-medium text-white/35 hover:text-white/55 transition-all">
                        Cancel
                      </button>
                      <button
                        onClick={handleDelete}
                        disabled={deleting}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[11px] font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/25 transition-all active:scale-[0.97]"
                      >
                        {deleting ? <RefreshCw size={11} className="animate-spin" /> : <Trash2 size={11} />}
                        {deleting ? 'Deleting...' : 'Confirm Delete'}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────── */}
      {!hasProfileAccess ? (
        <motion.footer variants={itemVariants} className="relative border-t border-white/[0.06] px-7 py-4">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(0deg,rgba(250,204,21,0.02),transparent)]" />
          <div className="relative flex items-center justify-between">
            <div>
              <p className="text-[13px] tracking-[-0.025em] text-white/35">
                Resume ingestion requires Pro.
              </p>
              <p className="mt-0.5 text-[14px] tracking-[-0.03em] font-medium bg-gradient-to-r from-[#FACC15] to-[#f97316] bg-clip-text text-transparent">
                Unlock Pro for Profile Knowledge.
              </p>
            </div>
            <button
              type="button"
              onClick={onUnlockPro}
              className="group/btn inline-flex h-[44px] items-center justify-between rounded-full bg-white pl-5 pr-2 text-[14px] font-semibold tracking-[-0.035em] text-[#141414] shadow-[0_18px_42px_rgba(0,0,0,0.24),0_0_0_1px_rgba(255,255,255,0.1)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:scale-[1.02] active:scale-[0.98]"
            >
              <span className="min-w-[86px]">Unlock Pro</span>
              <span className="ml-2.5 flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[#ececec] text-[#161616] transition-transform duration-300 group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-[1px] group-hover/btn:scale-105">
                <ArrowUpRight className="h-[14px] w-[14px] stroke-[2.5]" />
              </span>
            </button>
          </div>
        </motion.footer>
      ) : (
        <motion.footer variants={itemVariants} className="border-t border-white/[0.06] px-7 py-3.5">
          <div className="flex items-center justify-between">
            <p className="text-[12px] tracking-[-0.02em] text-white/28">
              {profileStatus.hasProfile
                ? <>Persona engine {isActive ? <span className="text-emerald-400/70">active</span> : <span className="text-white/40">paused</span>} · {profileData?.nodeCount || 0} nodes</>
                : 'Upload a resume to initialize the engine.'}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-[36px] items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-5 text-[12px] font-medium tracking-[-0.02em] text-white/50 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/[0.08] hover:text-white/70 active:scale-[0.97]"
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
