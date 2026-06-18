import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  X,
  Upload,
  RefreshCw,
  Briefcase,
  Trash2,
  ArrowUpRight,
  Sparkles,
  CheckCircle,
  AlertCircle,
  Pencil,
  Check,
} from 'lucide-react';

interface ProfileIntelligencePanelProps {
  onClose: () => void;
  isPremium?: boolean;
  isLoaded?: boolean;
  isTrialActive?: boolean;
  onUnlockPro?: () => void;
}

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
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: entryEase } },
};

/* ── Stat Pill ────────────────────────────────────────────────── */
function StatPill({
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
  return (
    <div className="flex flex-col items-center justify-center flex-1">
      <span className="text-[22px] font-bold text-white tracking-tight leading-none mb-1.5">
        {value}
      </span>
      <div className="flex items-center gap-1.5">
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: dotColor, boxShadow: `0 0 10px ${glowColor}` }}
        />
        <span className="text-[9px] font-semibold text-white/40 uppercase tracking-[0.16em]">
          {label}
        </span>
      </div>
    </div>
  );
}

/* ── Main Panel ───────────────────────────────────────────────── */
const ProfileIntelligencePanel: React.FC<ProfileIntelligencePanelProps> = ({
  onClose,
  isPremium = false,
  isTrialActive = false,
  onUnlockPro,
}) => {
  const hasProfileAccess = isPremium || isTrialActive;
  const prefersReducedMotion = useReducedMotion();

  /* ── Profile State ──────────────────────────────────────────── */
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

  /* ── Data loading ───────────────────────────────────────────── */
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
        setProfileViewStatus(profile ? 'ready' : 'empty');
      } else {
        setProfileViewStatus('empty');
      }
      if (notes?.content !== undefined) {
        setCustomNotes(notes.content);
      }
    } catch (e) {
      console.warn('[ProfileIntelligencePanel] Failed to load profile state:', e);
    }
  }, []);

  useEffect(() => {
    refreshProfileState();
  }, [refreshProfileState]);

  /* ── Resume Upload ──────────────────────────────────────────── */
  const handleSelectResume = async () => {
    setProfileError('');
    try {
      const fileResult = await window.electronAPI?.profileSelectFile?.();
      if (fileResult?.cancelled || !fileResult?.fileToken) return;

      const uploadGenerationId = Date.now();
      uploadGenerationRef.current = uploadGenerationId;
      setProfileUploading(true);
      setProfileViewStatus('processing');
      setProfileData(null);
      profileGenerationRef.current = 0;

      const result = await window.electronAPI?.profileUploadResume?.(fileResult.fileToken);
      if (uploadGenerationRef.current !== uploadGenerationId) return;

      if (result?.success) {
        await refreshProfileState();
      } else if (result?.error === 'STALE_GENERATION') {
        return;
      } else {
        setProfileViewStatus('error');
        setProfileError(result?.error || 'Resume upload failed');
      }
    } catch (e: any) {
      setProfileViewStatus('error');
      setProfileError(e.message || 'Resume upload failed');
    } finally {
      setProfileUploading(false);
    }
  };

  /* ── JD Upload ──────────────────────────────────────────────── */
  const handleSelectJD = async () => {
    setJdError('');
    try {
      const fileResult = await window.electronAPI?.profileSelectFile?.();
      if (fileResult?.cancelled || !fileResult?.fileToken) return;

      const uploadGenerationId = Date.now();
      uploadGenerationRef.current = uploadGenerationId;
      setJdUploading(true);
      setProfileViewStatus('processing');
      setProfileData(null);
      profileGenerationRef.current = 0;

      const result = await window.electronAPI?.profileUploadJD?.(fileResult.fileToken);
      if (uploadGenerationRef.current !== uploadGenerationId) return;

      if (result?.success) {
        await refreshProfileState();
      } else if (result?.error === 'STALE_GENERATION') {
        return;
      } else {
        setProfileViewStatus('error');
        setJdError(result?.error || 'JD upload failed');
      }
    } catch (e: any) {
      setProfileViewStatus('error');
      setJdError(e.message || 'JD upload failed');
    } finally {
      setJdUploading(false);
    }
  };

  /* ── Profile Intelligence Toggle ────────────────────────────── */
  const handleToggleProfileMode = async () => {
    if (!canEnableProfileIntelligence) return;
    const newState = !profileStatus.profileMode;
    setProfileStatus((prev) => ({ ...prev, profileMode: newState }));
    try {
      const result = await window.electronAPI?.profileSetMode?.(newState);
      if (!result?.success) {
        setProfileStatus((prev) => ({ ...prev, profileMode: !newState }));
      }
    } catch {
      setProfileStatus((prev) => ({ ...prev, profileMode: !newState }));
    }
  };

  /* ── Delete ─────────────────────────────────────────────────── */
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
    } catch (e) {
      console.error('Delete failed:', e);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <motion.section
      initial={prefersReducedMotion ? false : 'hidden'}
      animate="show"
      variants={surfaceVariants}
      className="relative flex h-full flex-col overflow-hidden bg-[#111113] text-white"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", sans-serif' }}
    >
      {/* Subtle top gradient */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),rgba(255,255,255,0))]" />

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-5 top-5 z-20 flex h-[36px] w-[36px] items-center justify-center rounded-full border border-white/[0.035] bg-white/[0.05] text-white/45 backdrop-blur-sm transition-colors duration-200 hover:text-white/70"
      >
        <X className="h-[18px] w-[18px] stroke-[2]" />
      </button>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-5 pt-[38px]">
        <div className="mx-auto flex max-w-[640px] flex-col">
          {/* ── Header ──────────────────────────────────────────── */}
          <motion.header variants={itemVariants} className="mb-5">
            <div className="flex items-center gap-3 mb-1.5">
              <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[14px] border border-white/[0.08] bg-white/[0.04]">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-[22px] font-semibold tracking-[-0.04em] text-white">
                    Profile Intelligence
                  </h1>
                  <span className="rounded-[6px] bg-[#FACC15]/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#FACC15] border border-[#FACC15]/20">
                    Beta
                  </span>
                </div>
                <p className="text-[12.5px] tracking-[-0.02em] text-white/38 mt-0.5">
                  Manage your persona, career history, and active job description.
                </p>
              </div>
            </div>
          </motion.header>

          {/* ── Identity Card ───────────────────────────────────── */}
          <motion.div variants={itemVariants}>
            <div className="rounded-[20px] border-[2px] border-white/[0.10] bg-[#1a1a1c] overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_18px_44px_rgba(0,0,0,0.32)]">
              {/* Inner bevel ring */}
              <div className="relative">
                <div className="pointer-events-none absolute inset-[1px] rounded-[18px] border border-white/[0.05]" />

                {/* Identity header */}
                <div className="px-5 pt-5 pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className="w-11 h-11 rounded-full bg-[#2a2a2d] border border-white/[0.08] flex items-center justify-center text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                        <span className="font-bold text-[14px] tracking-tight">
                          {profileData?.identity?.name ? profileData.identity.name.charAt(0).toUpperCase() : 'U'}
                        </span>
                      </div>
                      <div>
                        <h3 className="text-[14.5px] font-semibold text-white tracking-[-0.03em]">
                          {profileData?.identity?.name || 'Identity Node Inactive'}
                        </h3>
                        <p className="text-[11.5px] text-white/38 mt-0.5 tracking-[-0.01em]">
                          {profileData?.identity?.email || 'Upload a resume to begin mapping.'}
                        </p>
                      </div>
                    </div>

                    {/* Persona Engine Toggle */}
                    <div
                      className={`flex items-center gap-2.5 rounded-full border px-3 py-1.5 ${
                        !canEnableProfileIntelligence
                          ? 'opacity-40 cursor-not-allowed border-white/[0.06] bg-white/[0.03]'
                          : 'border-white/[0.08] bg-white/[0.04] cursor-pointer'
                      }`}
                      title={
                        !hasProfileAccess
                          ? 'Requires Pro license'
                          : !profileStatus.hasProfile
                          ? 'Upload a resume to enable'
                          : ''
                      }
                    >
                      <span className="text-[11px] font-medium text-white/50">Persona Engine</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={Boolean(profileStatus.profileMode && canEnableProfileIntelligence)}
                        disabled={!canEnableProfileIntelligence}
                        onClick={handleToggleProfileMode}
                        className={`relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full transition-colors duration-200 ${
                          profileStatus.profileMode && canEnableProfileIntelligence
                            ? 'bg-emerald-500'
                            : 'bg-white/[0.12]'
                        }`}
                      >
                        <span
                          className={`inline-block h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
                            profileStatus.profileMode && canEnableProfileIntelligence ? 'translate-x-[18px]' : 'translate-x-[2px]'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Stats bar */}
                <div className="mx-5 mb-5">
                  <div className="flex items-center justify-between rounded-[14px] border border-white/[0.07] bg-[#141416] py-4 px-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <StatPill
                      value={profileData?.experienceCount || 0}
                      label="Experience"
                      dotColor="#22c55e"
                      glowColor="rgba(34,197,94,0.45)"
                    />
                    <div className="h-8 w-px bg-white/[0.06]" />
                    <StatPill
                      value={profileData?.projectCount || 0}
                      label="Projects"
                      dotColor="#3b82f6"
                      glowColor="rgba(59,130,246,0.45)"
                    />
                    <div className="h-8 w-px bg-white/[0.06]" />
                    <StatPill
                      value={profileData?.nodeCount || 0}
                      label="Nodes"
                      dotColor="#a855f7"
                      glowColor="rgba(168,85,247,0.45)"
                    />
                  </div>
                </div>

                {/* Skills */}
                {profileData?.skills && profileData.skills.length > 0 && (
                  <div className="mx-5 mb-5">
                    <div className="text-[9px] font-bold text-white/30 uppercase tracking-[0.16em] mb-2">
                      Top Skills
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {profileData.skills.slice(0, 12).map((skill: string, i: number) => (
                        <span
                          key={i}
                          className="text-[10px] font-medium text-white/45 px-2 py-1 rounded-[8px] border border-white/[0.06] bg-white/[0.03]"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* ── Upload Cards ─────────────────────────────────── */}
          <motion.div variants={itemVariants} className="mt-4 grid gap-3 grid-cols-2">
            {/* Resume upload */}
            <div
              className={`group relative rounded-[18px] border-[2px] overflow-hidden transition-all duration-200 ${
                profileUploading
                  ? 'border-emerald-500/40 bg-[#1a1a1c]'
                  : 'border-white/[0.10] bg-[#1a1a1c] hover:border-white/[0.16]'
              }`}
            >
              <div className="pointer-events-none absolute inset-[1px] rounded-[16px] border border-white/[0.04]" />
              <div className="relative z-10 p-4 flex flex-col h-full min-h-[130px]">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex h-[36px] w-[36px] items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.04]">
                    {profileUploading ? (
                      <RefreshCw size={16} className="animate-spin text-emerald-400" />
                    ) : (
                      <Upload size={16} className="text-white/50" />
                    )}
                  </div>
                  {!hasProfileAccess && (
                    <span className="text-[8px] font-bold text-[#FACC15] bg-[#FACC15]/10 px-2 py-0.5 rounded-full border border-[#FACC15]/20 uppercase tracking-[0.1em]">
                      Pro
                    </span>
                  )}
                </div>
                <h4 className="text-[13px] font-semibold text-white tracking-[-0.02em] mb-1">
                  {profileStatus.hasProfile ? 'Update Resume' : 'Initialize Knowledge Base'}
                </h4>
                <p className="text-[11px] text-white/35 leading-[1.3] mb-3 flex-1">
                  {profileUploading
                    ? 'Processing structural semantics...'
                    : 'Resume ingestion seeds the intelligence engine.'}
                </p>
                <button
                  onClick={handleSelectResume}
                  disabled={profileViewStatus === 'processing'}
                  className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-full text-[11px] font-semibold tracking-[-0.02em] transition-all duration-200 ${
                    profileViewStatus === 'processing'
                      ? 'bg-white/[0.06] text-white/30 cursor-wait border border-white/[0.06]'
                      : 'bg-white text-[#141414] hover:bg-white/90 shadow-[0_4px_16px_rgba(0,0,0,0.24)]'
                  }`}
                >
                  <Upload size={12} />
                  {profileUploading ? 'Ingesting...' : 'Select resume file'}
                  {!profileUploading && <ArrowUpRight size={11} />}
                </button>
              </div>
              {profileError && (
                <div className="px-4 pb-3">
                  <div className="px-2.5 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-1.5 text-[10px] text-red-400 font-medium">
                    <AlertCircle size={10} /> {profileError}
                  </div>
                </div>
              )}
            </div>

            {/* JD upload */}
            <div
              className={`group relative rounded-[18px] border-[2px] overflow-hidden transition-all duration-200 ${
                jdUploading
                  ? 'border-blue-500/40 bg-[#1a1a1c]'
                  : profileData?.hasActiveJD
                  ? 'border-blue-500/20 bg-[#1a1a1c]'
                  : 'border-white/[0.10] bg-[#1a1a1c] hover:border-white/[0.16]'
              }`}
            >
              <div className="pointer-events-none absolute inset-[1px] rounded-[16px] border border-white/[0.04]" />
              <div className="relative z-10 p-4 flex flex-col h-full min-h-[130px]">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex h-[36px] w-[36px] items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.04]">
                    {jdUploading ? (
                      <RefreshCw size={16} className="animate-spin text-blue-400" />
                    ) : (
                      <Briefcase size={16} className="text-white/50" />
                    )}
                  </div>
                  {!hasProfileAccess && (
                    <span className="text-[8px] font-bold text-[#FACC15] bg-[#FACC15]/10 px-2 py-0.5 rounded-full border border-[#FACC15]/20 uppercase tracking-[0.1em]">
                      Pro
                    </span>
                  )}
                </div>
                <h4 className="text-[13px] font-semibold text-white tracking-[-0.02em] mb-1">
                  {profileData?.hasActiveJD
                    ? `${profileData.activeJD?.title || 'Job'} @ ${profileData.activeJD?.company || '—'}`
                    : 'Upload Job Description'}
                </h4>
                <p className="text-[11px] text-white/35 leading-[1.3] mb-3 flex-1">
                  {jdUploading
                    ? 'Parsing JD structure...'
                    : profileData?.hasActiveJD
                    ? `${profileData.activeJD?.level || 'Mid'}-level · ${(profileData.activeJD?.technologies || []).slice(0, 3).join(', ')}`
                    : 'Upload a JD to enable persona tuning.'}
                </p>
                <div className="flex items-center gap-2">
                  {profileData?.hasActiveJD && (
                    <button
                      onClick={async () => {
                        await window.electronAPI?.profileDeleteJD?.();
                        await refreshProfileState();
                      }}
                      className="flex items-center justify-center h-[32px] w-[32px] rounded-full border border-white/[0.06] bg-white/[0.04] text-white/40 hover:text-red-400 hover:border-red-500/20 hover:bg-red-500/10 transition-all"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                  <button
                    onClick={handleSelectJD}
                    disabled={profileViewStatus === 'processing'}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-full text-[11px] font-semibold tracking-[-0.02em] transition-all duration-200 ${
                      profileViewStatus === 'processing'
                        ? 'bg-white/[0.06] text-white/30 cursor-wait border border-white/[0.06]'
                        : 'bg-blue-600 text-white hover:bg-blue-500 shadow-[0_4px_16px_rgba(59,130,246,0.2)]'
                    }`}
                  >
                    {jdUploading ? 'Parsing...' : profileData?.hasActiveJD ? 'Replace JD' : 'Upload JD'}
                    {!jdUploading && <ArrowUpRight size={11} />}
                  </button>
                </div>
              </div>
              {jdError && (
                <div className="px-4 pb-3">
                  <div className="px-2.5 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-1.5 text-[10px] text-red-400 font-medium">
                    <AlertCircle size={10} /> {jdError}
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* ── Custom Context ────────────────────────────────── */}
          {hasProfileAccess && (
            <motion.div variants={itemVariants} className="mt-4">
              <div className="rounded-[18px] border-[2px] border-white/[0.10] bg-[#1a1a1c] overflow-hidden">
                <div className="pointer-events-none absolute inset-[1px] rounded-[16px] border border-white/[0.04]" />
                <div className="relative z-10 p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-[36px] w-[36px] items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.04]">
                      <Pencil size={16} className="text-white/50" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-[13px] font-semibold text-white tracking-[-0.02em]">Custom Context</h4>
                        {customNotesSaved && (
                          <span className="text-[8px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full border border-emerald-500/20 uppercase tracking-[0.1em] flex items-center gap-0.5">
                            <Check size={7} /> Saved
                          </span>
                        )}
                      </div>
                      <p className="text-[10.5px] text-white/35 mt-0.5">
                        Saved across all sessions — the AI will always know this.
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
                        try {
                          await window.electronAPI?.profileSaveNotes?.(val);
                          setCustomNotesSaved(true);
                          setTimeout(() => setCustomNotesSaved(false), 2000);
                        } catch {}
                      }, 800);
                    }}
                    placeholder={`Examples:\n• Q4 ARR was $2.1M, grew 40% YoY\n• I prefer concise, direct answers\n• My target salary is $180k base`}
                    rows={4}
                    className="w-full resize-none rounded-[12px] border border-white/[0.07] bg-[#141416] px-3.5 py-2.5 text-[12px] text-white/70 placeholder:text-white/20 focus:outline-none focus:border-white/[0.14] transition-colors"
                  />
                  <div className="flex items-center justify-end mt-2 px-0.5">
                    <span className="text-[10px] text-white/25">{customNotes.length}/4000</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Delete Zone ───────────────────────────────────── */}
          {profileStatus.hasProfile && profileData?.hasActiveJD && (
            <motion.div variants={itemVariants} className="mt-4">
              {!deleteConfirm ? (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-[14px] border border-white/[0.06] bg-white/[0.03] text-[12px] font-medium text-white/30 hover:text-red-400 hover:border-red-500/20 hover:bg-red-500/[0.06] transition-all"
                >
                  <Trash2 size={13} />
                  Delete Profile Intelligence
                </button>
              ) : (
                <div className="rounded-[14px] border border-red-500/20 bg-red-500/[0.06] p-4">
                  <p className="text-[12px] text-red-300/80 mb-3">
                    This permanently removes Resume, Job Description, AOT results, Snapshots, Dossiers, Notes, and Profile Intelligence from this device.
                  </p>
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => setDeleteConfirm(false)}
                      className="px-3 py-1.5 rounded-full text-[11px] font-medium text-white/40 hover:text-white/60 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-all"
                    >
                      {deleting ? <RefreshCw size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      {deleting ? 'Deleting...' : 'Confirm Delete'}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </div>

      {/* ── Footer ────────────────────────────────────────────── */}
      {!hasProfileAccess ? (
        <motion.footer variants={itemVariants} className="border-t border-white/[0.07] px-6 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] tracking-[-0.025em] text-white/40">
                Resume ingestion requires Pro access.
              </p>
              <p className="mt-0.5 text-[13px] tracking-[-0.028em] text-[#ffc633]">
                Unlock Pro to access Profile Intelligence.
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
        <motion.footer variants={itemVariants} className="border-t border-white/[0.07] px-6 py-3">
          <div className="flex items-center justify-between">
            <p className="text-[12.5px] tracking-[-0.02em] text-white/35">
              {profileStatus.hasProfile
                ? `Profile intelligence ${profileStatus.profileMode ? 'active' : 'paused'} · ${profileData?.nodeCount || 0} knowledge nodes`
                : 'Upload a resume to initialize the intelligence engine.'}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-[38px] items-center rounded-full border border-white/10 bg-white/[0.06] px-4 text-[13px] font-medium tracking-[-0.03em] text-white transition-colors duration-200 hover:bg-white/[0.09]"
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
