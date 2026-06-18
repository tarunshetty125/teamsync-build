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
  User,
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

/* ── Motion (Emil: custom curves, <300ms, stagger 35ms) ────────── */
const entryEase: [number, number, number, number] = [0.23, 1, 0.32, 1];
const surfaceVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { delayChildren: 0.04, staggerChildren: 0.035 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: entryEase } },
};

/* ── Main Panel ─────────────────────────────────────────────────── */
const ProfileIntelligencePanel: React.FC<ProfileIntelligencePanelProps> = ({
  onClose,
  isPremium = false,
  isTrialActive = false,
  onUnlockPro,
}) => {
  const hasProfileAccess = isPremium || isTrialActive;
  const prefersReducedMotion = useReducedMotion();

  /* ── State ──────────────────────────────────────────────── */
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
      {/* Top gradient wash */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0))]" />

      {/* ── Header bar ─────────────────────────────────────── */}
      <motion.div variants={itemVariants} className="relative z-10 flex items-center justify-between px-6 pt-6 pb-2">
        <div className="flex items-center gap-3">
          <div className="flex h-[40px] w-[40px] items-center justify-center rounded-[12px] border border-white/[0.08] bg-white/[0.04] text-white/50">
            <User className="h-[18px] w-[18px] stroke-[1.8]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[16px] font-semibold tracking-[-0.03em] text-white">Profile Intelligence</h1>
              <span className="relative overflow-hidden rounded-[4px] bg-[#FACC15] px-[6px] py-[1.5px] text-[8px] font-black uppercase tracking-[0.06em] text-black shadow-[0_0_12px_rgba(250,204,21,0.35)]">
                Beta
                <span className="pointer-events-none absolute inset-0 animate-shimmer-sweep bg-gradient-to-r from-transparent via-white/40 to-transparent" />
              </span>
            </div>
            <p className="text-[12px] tracking-[-0.01em] text-white/40 mt-0.5">
              Manage your persona, career history, and active job description
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-white/[0.04] bg-white/[0.04] text-white/40 transition-colors duration-200 hover:text-white/70"
          >
            <X className="h-[16px] w-[16px] stroke-[2]" />
          </button>
        </div>
      </motion.div>

      {/* ── Scrollable Content ─────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 pb-5 pt-3">
        <div className="mx-auto max-w-[680px] space-y-6">

          {/* ── Professional Identity Section ───────────────── */}
          <motion.div variants={itemVariants}>
            <h3 className="text-[13px] font-bold text-white/90 tracking-[-0.02em] mb-1">Intelligence Graph</h3>
            <p className="text-[12px] text-white/38 mb-4">
              Your career, skills, and context — mapped into a knowledge layer for every conversation.
            </p>

            {/* Identity Card */}
            <div className="rounded-[16px] border-2 border-white/[0.12] bg-[#1c1c1e]/80 backdrop-blur-xl overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_32px_rgba(0,0,0,0.2)]">
              {/* Identity header */}
              <div className="p-5 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3.5">
                    <div className="relative">
                      <div className="w-[42px] h-[42px] rounded-full bg-[#252528] border border-white/[0.08] flex items-center justify-center text-white/80 shadow-sm">
                        <span className="font-bold text-[14px] tracking-tight">
                          {profileData?.identity?.name ? profileData.identity.name.charAt(0).toUpperCase() : 'U'}
                        </span>
                      </div>
                      {isActive && (
                        <motion.div
                          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-[2px] border-[#1c1c1e]"
                          style={{ boxShadow: '0 0 8px rgba(52,211,153,0.5)' }}
                          animate={prefersReducedMotion ? undefined : { scale: [1, 1.15, 1] }}
                          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                        />
                      )}
                    </div>
                    <div>
                      <h4 className="text-[14px] font-bold text-white tracking-[-0.02em]">
                        {profileData?.identity?.name || 'Identity Node Inactive'}
                      </h4>
                      <p className="text-[12px] text-white/35 mt-0.5 tracking-wide">
                        {profileData?.identity?.email || 'Upload a resume to begin mapping.'}
                      </p>
                    </div>
                  </div>

                  {/* Persona Engine toggle */}
                  <div
                    className={clsx(
                      'flex items-center gap-2 rounded-full border px-3 py-1.5',
                      !canEnableProfileIntelligence
                        ? 'opacity-40 cursor-not-allowed border-white/[0.04] bg-white/[0.02]'
                        : 'border-white/[0.08] bg-[#252528]'
                    )}
                  >
                    <span className="text-[11px] font-medium text-white/40">Persona Engine</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isActive}
                      disabled={!canEnableProfileIntelligence}
                      onClick={handleToggleProfileMode}
                      className={clsx(
                        'relative inline-flex h-[20px] w-[36px] shrink-0 items-center rounded-full transition-all duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
                        isActive ? 'bg-emerald-500 shadow-[0_0_12px_rgba(52,211,153,0.25)]' : 'bg-white/[0.10]'
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
                </div>
              </div>

              {/* Stats bar */}
              <div className="px-5 pb-5">
                <div className="flex items-center justify-between rounded-[14px] border border-white/[0.06] bg-[#252528] py-4 px-6">
                  <div className="flex flex-col items-center justify-center flex-1">
                    <span className="text-[20px] font-bold text-white tracking-tight leading-none mb-1">{profileData?.experienceCount || 0}</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                      <span className="text-[10px] font-semibold text-white/35 uppercase tracking-widest">Experience</span>
                    </div>
                  </div>
                  <div className="h-8 w-px bg-white/[0.06]" />
                  <div className="flex flex-col items-center justify-center flex-1">
                    <span className="text-[20px] font-bold text-white tracking-tight leading-none mb-1">{profileData?.projectCount || 0}</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]" />
                      <span className="text-[10px] font-semibold text-white/35 uppercase tracking-widest">Projects</span>
                    </div>
                  </div>
                  <div className="h-8 w-px bg-white/[0.06]" />
                  <div className="flex flex-col items-center justify-center flex-1">
                    <span className="text-[20px] font-bold text-white tracking-tight leading-none mb-1">{profileData?.nodeCount || 0}</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]" />
                      <span className="text-[10px] font-semibold text-white/35 uppercase tracking-widest">Nodes</span>
                    </div>
                  </div>
                </div>

                {/* Skills */}
                {profileData?.skills && profileData.skills.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[10px] font-bold text-white/50 uppercase tracking-wide mb-2">Top Skills</div>
                    <div className="flex flex-wrap gap-1.5">
                      {profileData.skills.slice(0, 15).map((skill: string, i: number) => (
                        <span key={i} className="text-[10px] font-medium text-white/35 px-2 py-1 rounded-md border border-white/[0.06] bg-[#252528]">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* ── Upload Cards (side by side) ─────────────────── */}
          <motion.div variants={itemVariants} className="grid gap-3 grid-cols-2">
            {/* Resume Upload */}
            <div className="rounded-[16px] border-2 border-white/[0.12] bg-[#1c1c1e]/80 backdrop-blur-xl overflow-hidden min-h-[190px] flex flex-col shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_32px_rgba(0,0,0,0.2)]">
              <div className="p-6 flex-1 flex flex-col">
                <div className="flex items-start gap-3.5 mb-4">
                  <div className="w-[42px] h-[42px] rounded-[12px] bg-[#252528] border border-white/[0.06] flex items-center justify-center text-white/40 shrink-0">
                    {profileUploading ? <RefreshCw size={18} className="animate-spin text-white/60" /> : <Upload size={18} />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-[13px] font-bold text-white tracking-[-0.02em] truncate">
                        {profileStatus.hasProfile ? 'Update Resume' : 'Initialize Knowledge Base'}
                      </h4>
                      {!hasProfileAccess && (
                        <span className="relative overflow-hidden text-[7px] font-black text-[#FACC15] bg-[#FACC15]/12 px-1.5 py-0.5 rounded-[3px] border border-[#FACC15]/20 uppercase tracking-[0.08em] shrink-0 animate-glow-pulse">
                          Pro
                          <span className="pointer-events-none absolute inset-0 animate-shimmer-sweep bg-gradient-to-r from-transparent via-[#FACC15]/30 to-transparent" />
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-white/30 mt-0.5 leading-[1.3]">
                      {profileUploading
                        ? 'Processing structural semantics...'
                        : !hasProfileAccess
                          ? 'Resume ingestion is a Quietly Pro feature. The Custom Context box below stays free.'
                          : 'Provide a resume file to seed the intelligence engine.'}
                    </p>
                  </div>
                </div>

                <div className="flex-1" />
                <button
                  onClick={handleSelectResume}
                  disabled={profileViewStatus === 'processing'}
                  className={clsx(
                    'w-full flex items-center justify-between rounded-full px-4 py-[8px] text-[12px] font-semibold tracking-[-0.02em] transition-all duration-200 active:scale-[0.97]',
                    profileViewStatus === 'processing'
                      ? 'bg-[#252528] text-white/25 cursor-wait border border-white/[0.04]'
                      : 'bg-white text-[#141414] shadow-[0_4px_16px_rgba(0,0,0,0.2)]'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Upload size={13} className="stroke-[2.2]" />
                    <span>{profileUploading ? 'Ingesting...' : 'Select resume file'}</span>
                  </div>
                  <ArrowUpRight size={13} className="stroke-[2.2]" />
                </button>
              </div>

              {profileError && (
                <div className="px-5 pb-4">
                  <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-[10px] flex items-center gap-2 text-[10px] text-red-400 font-medium">
                    <AlertCircle size={10} /> {profileError}
                  </div>
                </div>
              )}
            </div>

            {/* JD Upload */}
            <div className={clsx(
              'rounded-[16px] border-2 overflow-hidden transition-colors duration-200 min-h-[190px] flex flex-col backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_32px_rgba(0,0,0,0.2)]',
              profileData?.hasActiveJD ? 'border-blue-500/25 bg-blue-500/[0.03]' : 'border-white/[0.12] bg-[#1c1c1e]/80'
            )}>
              <div className="p-6 flex-1 flex flex-col">
                <div className="flex items-start gap-3.5 mb-4">
                  <div className="w-[42px] h-[42px] rounded-[12px] bg-[#252528] border border-white/[0.06] flex items-center justify-center text-white/40 shrink-0">
                    {jdUploading ? <RefreshCw size={18} className="animate-spin text-blue-400" /> : <Briefcase size={18} />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-[13px] font-bold text-white tracking-[-0.02em] truncate">
                        {profileData?.hasActiveJD
                          ? `${profileData.activeJD?.title || 'Job'} @ ${profileData.activeJD?.company || '—'}`
                          : 'Upload Job Description'}
                      </h4>
                      {!hasProfileAccess && (
                        <span className="relative overflow-hidden text-[7px] font-black text-[#FACC15] bg-[#FACC15]/12 px-1.5 py-0.5 rounded-[3px] border border-[#FACC15]/20 uppercase tracking-[0.08em] shrink-0 animate-glow-pulse">
                          Pro
                          <span className="pointer-events-none absolute inset-0 animate-shimmer-sweep bg-gradient-to-r from-transparent via-[#FACC15]/30 to-transparent" />
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-white/30 mt-0.5 leading-[1.3]">
                      {jdUploading
                        ? 'Parsing JD structure...'
                        : !hasProfileAccess
                          ? 'Job description parsing is a Quietly Pro feature. The Custom Context box below stays free.'
                          : profileData?.hasActiveJD
                            ? `${profileData.activeJD?.level || 'Mid'}-level · ${(profileData.activeJD?.technologies || []).slice(0, 3).join(', ')}`
                            : 'Upload a JD to enable persona tuning and company research.'}
                    </p>
                  </div>
                </div>

                <div className="flex-1" />
                <div className="flex items-center gap-2">
                  {profileData?.hasActiveJD && (
                    <button
                      onClick={async () => { await window.electronAPI?.profileDeleteJD?.(); await refreshProfileState(); }}
                      className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-white/[0.04] bg-[#252528] text-white/30 hover:text-red-400 hover:border-red-500/15 transition-colors duration-200 active:scale-[0.97] shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  <button
                    onClick={handleSelectJD}
                    disabled={profileViewStatus === 'processing'}
                    className={clsx(
                      'flex-1 flex items-center justify-between rounded-full px-4 py-[8px] text-[12px] font-semibold tracking-[-0.02em] transition-all duration-200 active:scale-[0.97]',
                      profileViewStatus === 'processing'
                        ? 'bg-[#252528] text-white/25 cursor-wait border border-white/[0.04]'
                        : 'bg-white text-[#141414] shadow-[0_4px_16px_rgba(0,0,0,0.2)]'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Briefcase size={13} className="stroke-[2.2]" />
                      <span>{jdUploading ? 'Parsing...' : profileData?.hasActiveJD ? 'Replace JD' : 'Upload job description'}</span>
                    </div>
                    <ArrowUpRight size={13} className="stroke-[2.2]" />
                  </button>
                </div>
              </div>

              {jdError && (
                <div className="px-5 pb-4">
                  <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-[10px] flex items-center gap-2 text-[10px] text-red-400 font-medium">
                    <AlertCircle size={10} /> {jdError}
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          {/* ── Custom Context ──────────────────────────────── */}
          <motion.div variants={itemVariants}>
            <div className="rounded-[16px] border-2 border-white/[0.12] bg-[#1c1c1e]/80 backdrop-blur-xl p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_8px_32px_rgba(0,0,0,0.2)]">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-[38px] h-[38px] rounded-[10px] bg-[#252528] border border-white/[0.06] flex items-center justify-center text-white/40 shrink-0">
                  <Pencil size={17} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[13px] font-bold text-white tracking-[-0.02em]">Custom Context</h4>
                    <AnimatePresence>
                      {customNotesSaved && (
                        <motion.span
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          className="text-[7px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-[3px] border border-emerald-500/20 uppercase tracking-[0.08em] flex items-center gap-0.5"
                        >
                          <Check size={6} /> Saved
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  <p className="text-[11px] text-white/30 mt-0.5">Persistent context — the AI always knows this about you.</p>
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
                rows={3}
                className="w-full resize-none rounded-[12px] border border-white/[0.06] bg-[#252528] px-4 py-3 text-[12px] text-white/55 placeholder:text-white/16 focus:outline-none focus:border-white/[0.12] transition-colors duration-200"
              />
              <div className="flex items-center justify-end mt-1.5">
                <span className="text-[9px] text-white/18 tracking-wide">{customNotes.length}/4000</span>
              </div>
            </div>
          </motion.div>

          {/* ── Delete Zone ─────────────────────────────────── */}
          {profileStatus.hasProfile && (
            <motion.div variants={itemVariants}>
              <AnimatePresence mode="wait">
                {!deleteConfirm ? (
                  <motion.button
                    key="del-trigger"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setDeleteConfirm(true)}
                    className="w-full flex items-center justify-center gap-2 rounded-[12px] border border-white/[0.04] bg-white/[0.015] px-4 py-2.5 text-[12px] font-medium text-white/20 hover:text-red-400 hover:border-red-500/12 hover:bg-red-500/[0.03] transition-all duration-200"
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
                    className="rounded-[12px] border border-red-500/15 bg-red-500/[0.03] p-4 overflow-hidden"
                  >
                    <p className="text-[11px] text-red-300/50 mb-3 leading-relaxed">
                      Permanently removes Resume, Job Description, AOT results, Snapshots, Dossiers, Notes, and Profile Knowledge.
                    </p>
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => setDeleteConfirm(false)} className="px-3 py-1.5 rounded-full text-[11px] font-medium text-white/30 hover:text-white/50 transition-colors duration-200">Cancel</button>
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
            </motion.div>
          )}
        </div>
      </div>

      {/* ── Footer (Unlock Pro from bottom) ─────────────────── */}
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
                Currently in free mode.
              </p>
              <p className="mt-0.5 text-[14px] tracking-[-0.028em] text-[#ffc633] md:text-[15px]">
                Unlock Pro for full Profile Knowledge.
              </p>
            </div>

            <button
              type="button"
              onClick={onUnlockPro}
              className="relative overflow-hidden inline-flex h-[44px] items-center justify-between rounded-full bg-white pl-5 pr-2.5 text-[14px] font-semibold tracking-[-0.035em] text-[#141414] shadow-[0_18px_42px_rgba(0,0,0,0.24)] transition-transform duration-200 hover:scale-[1.01] active:scale-[0.99]"
            >
              <span className="pointer-events-none absolute inset-0 animate-shimmer-sweep bg-gradient-to-r from-transparent via-black/[0.07] to-transparent" />
              <span className="relative min-w-[94px] text-left">Unlock Pro</span>
              <span className="relative ml-2.5 flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[#ececec] text-[#161616]">
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
                  ? <>Persona engine {isActive ? <span className="text-emerald-400/80">active</span> : 'paused'} · {profileData?.nodeCount || 0} nodes</>
                  : 'Upload a resume to initialize the persona engine.'}
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
