import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import {
  Check,
  ChevronRight,
  FileText,
  Grid2X2,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  SparkleIcon as PhSparkle,
  BriefcaseIcon as PhBriefcase,
  UsersThreeIcon as PhUsersThree,
  ChatCircleDotsIcon as PhChatCircleDots,
  MagnifyingGlassIcon as PhMagnifyingGlass,
  BookOpenTextIcon as PhBookOpenText,
  CodeIcon as PhCode,
} from '@phosphor-icons/react';

import { useModesStore } from './modes/useModesStore';
import { MODE_TEMPLATE_MAP } from '../../src/lib/modes/templateCatalog';
import type {
  ModeReferenceFile,
  ModeTemplateIcon,
  ModeTemplateId,
  UserMode,
  UserModeNoteSection,
} from '../../src/lib/modes/types';

interface PremiumModesProps {
  onClose: () => void;
  isPremium: boolean;
  isLoaded: boolean;
  isTrialActive: boolean;
  onOpenTeamSyncAPI?: () => void;
}

type RightPanelView = 'editor' | 'templates';
type NameDialogPurpose = 'new-mode' | 'empty-template';

interface NameDialogState {
  isOpen: boolean;
  purpose: NameDialogPurpose;
}

interface BuiltInRow {
  templateId: ModeTemplateId;
  mode: UserMode | null;
  modeId: string;
  name: string;
  isVirtual: boolean;
}

const BUILT_IN_TEMPLATE_IDS: ModeTemplateId[] = [
  'general',
  'sales',
  'recruiting',
  'team-meet',
  'looking-for-work',
  'lecture',
  'technical-interview',
];

const TEMPLATE_PICKER_IDS: ModeTemplateId[] = [
  'sales',
  'recruiting',
  'team-meet',
  'looking-for-work',
  'lecture',
  'technical-interview',
];

const TEMPLATE_COPY: Record<ModeTemplateId, string> = {
  general: 'Adaptive everyday copilot for broad conversations.',
  sales: 'Close deals with strategic discovery and objection handling.',
  recruiting: 'Evaluate candidates with structured interview insights.',
  'team-meet': 'Track action items and key decisions from meetings.',
  'looking-for-work': 'Answer interview questions with confidence and clarity.',
  lecture: 'Capture key concepts and content from lectures.',
  'technical-interview': 'Ace DSA, system design, and coding rounds with structured thinking.',
};

const TEMPLATE_COLORS: Record<ModeTemplateId, { accent: string; bg: string; border: string; activeBg: string }> = {
  general: {
    accent: '#a996ff',
    bg: 'rgba(91, 77, 132, 0.74)',
    border: 'rgba(169, 150, 255, 0.34)',
    activeBg: 'rgba(169, 150, 255, 0.16)',
  },
  sales: {
    accent: '#63d6b8',
    bg: 'rgba(46, 107, 92, 0.66)',
    border: 'rgba(99, 214, 184, 0.34)',
    activeBg: 'rgba(99, 214, 184, 0.14)',
  },
  recruiting: {
    accent: '#f0c94c',
    bg: 'rgba(105, 82, 25, 0.62)',
    border: 'rgba(240, 201, 76, 0.34)',
    activeBg: 'rgba(240, 201, 76, 0.14)',
  },
  'team-meet': {
    accent: '#ff6f94',
    bg: 'rgba(110, 55, 72, 0.66)',
    border: 'rgba(255, 111, 148, 0.34)',
    activeBg: 'rgba(255, 111, 148, 0.14)',
  },
  'looking-for-work': {
    accent: '#7cc6ff',
    bg: 'rgba(43, 91, 126, 0.66)',
    border: 'rgba(124, 198, 255, 0.34)',
    activeBg: 'rgba(124, 198, 255, 0.14)',
  },
  lecture: {
    accent: '#5bd4e7',
    bg: 'rgba(38, 96, 110, 0.66)',
    border: 'rgba(91, 212, 231, 0.34)',
    activeBg: 'rgba(91, 212, 231, 0.14)',
  },
  'technical-interview': {
    accent: '#ff6f94',
    bg: 'rgba(110, 55, 72, 0.66)',
    border: 'rgba(255, 111, 148, 0.34)',
    activeBg: 'rgba(255, 111, 148, 0.14)',
  },
};

const ICON_COMPONENTS: Record<ModeTemplateIcon, React.ComponentType<any>> = {
  sparkles: PhSparkle,
  briefcase: PhBriefcase,
  users: PhUsersThree,
  'messages-square': PhChatCircleDots,
  search: PhMagnifyingGlass,
  'book-open': PhBookOpenText,
  'code-2': PhCode,
};

const isRestricted = (isLoaded: boolean, isPremium: boolean, isTrialActive: boolean) => (
  isLoaded ? !isPremium && !isTrialActive : true
);

function truncateModeName(name: string) {
  if (name === 'Looking for Work') return 'Looking f...';
  if (name === 'Technical Interview') return 'Technical ...';
  return name;
}

function getTemplateIcon(templateId: ModeTemplateId) {
  const iconKey = MODE_TEMPLATE_MAP[templateId]?.icon ?? 'sparkles';
  return ICON_COMPONENTS[iconKey] ?? PhSparkle;
}

function ModeIcon({ templateId, className }: { templateId: ModeTemplateId; className?: string }) {
  const Icon = getTemplateIcon(templateId);
  const colors = TEMPLATE_COLORS[templateId];

  return (
    <span
      className={clsx('flex shrink-0 items-center justify-center rounded-[10px] border', className)}
      style={{ backgroundColor: colors.bg, borderColor: colors.border, color: colors.accent }}
    >
      <Icon size={25} weight="duotone" />
    </span>
  );
}

function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'active' | 'beta';
}) {
  return (
    <span
      className={clsx(
        'inline-flex h-[18px] shrink-0 items-center rounded-full px-[8px] text-[10px] font-[800] uppercase leading-none tracking-[0.12em]',
        tone === 'neutral' && 'bg-white/[0.075] text-white/36',
        tone === 'active' && 'bg-[#22c55e]/18 text-[#8df2ad]',
        tone === 'beta' && 'bg-white/[0.08] text-white/32',
      )}
    >
      {children}
    </span>
  );
}

function findCanonicalBuiltInModes(userModes: UserMode[]) {
  const usedIds = new Set<string>();

  const rows: BuiltInRow[] = BUILT_IN_TEMPLATE_IDS.flatMap((templateId) => {
    const template = MODE_TEMPLATE_MAP[templateId];
    const matches = userModes.filter((mode) => mode.templateId === templateId);
    const exactNameMatch = matches.find((mode) => mode.name === template.name && !usedIds.has(mode.id));
    const fallbackGeneral = templateId === 'general'
      ? matches.find((mode) => !usedIds.has(mode.id))
      : null;
    const mode = exactNameMatch ?? fallbackGeneral ?? null;

    if (templateId !== 'general' && !mode) {
      return [];
    }

    if (mode) usedIds.add(mode.id);

    return [{
      templateId,
      mode,
      modeId: mode?.id ?? `builtin-template-${templateId}`,
      name: template.name,
      isVirtual: !mode,
    }];
  });

  return { rows, usedIds };
}

function ReferenceFileRow({
  file,
  isRemoving,
  onRemove,
}: {
  file: ModeReferenceFile;
  isRemoving: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-[13px] border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 transition-colors hover:border-white/[0.13] hover:bg-white/[0.045]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-white/[0.045] text-white/42">
        <FileText className="h-[18px] w-[18px] stroke-[1.9]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-white/78">{file.fileName}</span>
        <span className="block truncate text-[11px] text-white/32">{file.filePath ?? 'Uploaded file'}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={isRemoving}
        aria-label={`Remove ${file.fileName}`}
        className="flex h-8 w-8 items-center justify-center rounded-[9px] text-white/30 opacity-0 transition-all hover:bg-[#ff6f94]/12 hover:text-[#ff7a9d] disabled:opacity-50 group-hover:opacity-100"
      >
        {isRemoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
    </div>
  );
}

function EmptyReferenceDropzone() {
  return (
    <div className="flex min-h-[110px] flex-col items-center justify-center rounded-[16px] border border-dashed border-white/[0.08] bg-black/[0.05] text-center">
      <Paperclip className="mb-2 h-6 w-6 text-white/18" />
      <p className="text-[14px] font-medium text-white/36">Add files as real-time context.</p>
    </div>
  );
}

export const PremiumModes: React.FC<PremiumModesProps> = ({
  onClose,
  isPremium,
  isLoaded,
  isTrialActive,
  onOpenTeamSyncAPI,
}) => {
  const restricted = isRestricted(isLoaded, isPremium, isTrialActive);
  const {
    userModes,
    selectedModeId,
    activeModeId,
    isLoading,
    isSaving,
    error,
    initialize,
    hydrate,
    selectMode,
    createModeFromTemplate,
    setActiveMode,
    updateMode,
    deleteMode,
    uploadReferenceFile,
    deleteReferenceFile,
    addNoteSection,
    updateNoteSection,
    deleteNoteSection,
    clearNoteSections,
  } = useModesStore();

  const [initialized, setInitialized] = useState(false);
  const [panelView, setPanelView] = useState<RightPanelView>('editor');
  const [pendingModeName, setPendingModeName] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState>({ isOpen: false, purpose: 'new-mode' });
  const [nameValue, setNameValue] = useState('');
  const [nameError, setNameError] = useState('');
  const [promptDraft, setPromptDraft] = useState('');
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [removingFileId, setRemovingFileId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [sectionTitleDraft, setSectionTitleDraft] = useState('');
  const [sectionDescriptionDraft, setSectionDescriptionDraft] = useState('');
  const [removingSectionId, setRemovingSectionId] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const modeNameInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialized) return;

    let mounted = true;
    initialize().then((unsubscribe) => {
      if (mounted) {
        setInitialized(true);
      } else {
        unsubscribe?.();
      }
    });

    return () => {
      mounted = false;
    };
  }, [initialize, initialized]);

  const { rows: builtInRows, usedIds: builtInModeIds } = useMemo(
    () => findCanonicalBuiltInModes(userModes),
    [userModes],
  );

  const customModes = useMemo(
    () => userModes.filter((mode) => !builtInModeIds.has(mode.id)),
    [builtInModeIds, userModes],
  );

  const generalModeId = builtInRows.find((row) => row.templateId === 'general')?.mode?.id ?? null;
  const selectedMode = useMemo(() => {
    const validSelected = selectedModeId
      ? userModes.find((mode) => mode.id === selectedModeId) ?? null
      : null;
    return validSelected ?? (generalModeId ? userModes.find((mode) => mode.id === generalModeId) ?? null : null);
  }, [generalModeId, selectedModeId, userModes]);

  const selectedIsBuiltIn = selectedMode ? builtInModeIds.has(selectedMode.id) : false;
  const selectedCanDelete = Boolean(selectedMode && selectedMode.id !== generalModeId);
  const selectedTemplateId = selectedMode?.templateId ?? 'general';
  const selectedTemplate = MODE_TEMPLATE_MAP[selectedTemplateId] ?? MODE_TEMPLATE_MAP.general;
  const isActiveMode = Boolean(selectedMode && activeModeId === selectedMode.id);

  useEffect(() => {
    if (!initialized || selectedModeId || !generalModeId) return;
    selectMode(generalModeId).catch((err) => console.error('Failed to select General mode:', err));
  }, [generalModeId, initialized, selectMode, selectedModeId]);

  useEffect(() => {
    setPromptDraft(selectedMode?.userPrompt ?? '');
    setNameDraft(selectedMode?.name ?? '');
    setEditingName(false);
    setMenuOpen(false);
    setEditingSectionId(null);
  }, [selectedMode?.id, selectedMode?.name, selectedMode?.userPrompt]);

  useEffect(() => {
    if (!nameDialog.isOpen) return;
    const focusTimer = window.setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 40);
    return () => window.clearTimeout(focusTimer);
  }, [nameDialog.isOpen]);

  useEffect(() => {
    if (!editingName) return;
    const focusTimer = window.setTimeout(() => {
      modeNameInputRef.current?.focus();
      modeNameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [editingName]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current || menuRef.current.contains(event.target as Node)) return;
      setMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const selectBuiltInTemplate = useCallback(async (templateId: ModeTemplateId) => {
    setPanelView('editor');
    setPendingModeName(null);

    const existing = findCanonicalBuiltInModes(useModesStore.getState().userModes)
      .rows.find((row) => row.templateId === templateId)?.mode;

    if (existing) {
      await selectMode(existing.id);
      return;
    }

    await createModeFromTemplate(templateId, MODE_TEMPLATE_MAP[templateId].name);
  }, [createModeFromTemplate, selectMode]);

  const handleSelectMode = useCallback(async (modeId: string) => {
    setPanelView('editor');
    setPendingModeName(null);
    await selectMode(modeId);
  }, [selectMode]);

  const openNameDialog = useCallback((purpose: NameDialogPurpose) => {
    setNameDialog({ isOpen: true, purpose });
    setNameValue('');
    setNameError('');
  }, []);

  const closeNameDialog = useCallback(() => {
    setNameDialog((current) => ({ ...current, isOpen: false }));
    setNameValue('');
    setNameError('');
  }, []);

  const createEmptyModeWithName = useCallback(async (name: string) => {
    const created = await window.electronAPI.modesCreate({ templateId: 'general', name });
    if (!created?.success) {
      throw new Error(created?.error ?? 'Unable to create empty mode.');
    }

    if (created.state) hydrate(created.state);
    const createdId = created.mode?.id ?? created.state?.selectedModeId;
    if (!createdId) return;

    const promptResult = await window.electronAPI.modesUpdate(createdId, { userPrompt: '' });
    if (promptResult?.state) hydrate(promptResult.state);

    const sectionsResult = await window.electronAPI.modesRemoveAllNoteSections(createdId);
    if (sectionsResult?.state) hydrate(sectionsResult.state);
  }, [hydrate]);

  const handleNameConfirm = useCallback(async () => {
    const trimmedName = nameValue.trim();
    if (!trimmedName) {
      setNameError('Enter a mode name.');
      return;
    }
    if (trimmedName.length > 50) {
      setNameError('Keep the name under 50 characters.');
      return;
    }

    try {
      await createEmptyModeWithName(trimmedName);
      setPendingModeName(null);
      setPanelView('editor');
      closeNameDialog();
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Unable to create mode.');
    }
  }, [closeNameDialog, createEmptyModeWithName, nameValue]);

  const handleTemplateClick = useCallback(async (templateId: ModeTemplateId | 'empty') => {
    if (templateId === 'empty') {
      if (pendingModeName) {
        try {
          await createEmptyModeWithName(pendingModeName);
          setPendingModeName(null);
          setPanelView('editor');
        } catch (err) {
          console.error('Failed to create empty mode:', err);
        }
        return;
      }

      openNameDialog('empty-template');
      return;
    }

    if (pendingModeName) {
      try {
        await createModeFromTemplate(templateId, pendingModeName);
        setPendingModeName(null);
        setPanelView('editor');
      } catch (err) {
        console.error('Failed to create mode from template:', err);
      }
      return;
    }

    await selectBuiltInTemplate(templateId);
  }, [createEmptyModeWithName, createModeFromTemplate, openNameDialog, pendingModeName, selectBuiltInTemplate]);

  const handleSavePrompt = useCallback(async () => {
    if (!selectedMode || promptDraft === selectedMode.userPrompt) return;

    setIsSavingPrompt(true);
    try {
      await updateMode(selectedMode.id, { userPrompt: promptDraft });
    } finally {
      setIsSavingPrompt(false);
    }
  }, [promptDraft, selectedMode, updateMode]);

  const handlePromptKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      handleSavePrompt();
    }
  }, [handleSavePrompt]);

  const handleSetActive = useCallback(async () => {
    if (!selectedMode || activeModeId === selectedMode.id) return;
    await setActiveMode(selectedMode.id);
  }, [activeModeId, selectedMode, setActiveMode]);

  const handleSaveName = useCallback(async () => {
    if (!selectedMode || selectedIsBuiltIn) {
      setEditingName(false);
      return;
    }

    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== selectedMode.name) {
      await updateMode(selectedMode.id, { name: trimmed });
    }
    setEditingName(false);
  }, [nameDraft, selectedIsBuiltIn, selectedMode, updateMode]);

  const handleUploadFile = useCallback(async () => {
    if (!selectedMode) return;
    setIsUploadingFile(true);
    try {
      await uploadReferenceFile(selectedMode.id);
    } finally {
      setIsUploadingFile(false);
    }
  }, [selectedMode, uploadReferenceFile]);

  const handleRemoveFile = useCallback(async (fileId: string) => {
    setRemovingFileId(fileId);
    try {
      await deleteReferenceFile(fileId);
    } finally {
      setRemovingFileId(null);
    }
  }, [deleteReferenceFile]);

  const startEditingSection = useCallback((section: UserModeNoteSection) => {
    setEditingSectionId(section.id);
    setSectionTitleDraft(section.title);
    setSectionDescriptionDraft(section.description);
  }, []);

  const saveEditingSection = useCallback(async () => {
    if (!editingSectionId || !sectionTitleDraft.trim()) return;
    await updateNoteSection(editingSectionId, {
      title: sectionTitleDraft.trim(),
      description: sectionDescriptionDraft.trim(),
    });
    setEditingSectionId(null);
    setSectionTitleDraft('');
    setSectionDescriptionDraft('');
  }, [editingSectionId, sectionDescriptionDraft, sectionTitleDraft, updateNoteSection]);

  const addSection = useCallback(async () => {
    if (!selectedMode) return;
    await addNoteSection(selectedMode.id, 'New Section', '');
  }, [addNoteSection, selectedMode]);

  const removeSection = useCallback(async (sectionId: string) => {
    setRemovingSectionId(sectionId);
    try {
      await deleteNoteSection(sectionId);
    } finally {
      setRemovingSectionId(null);
    }
  }, [deleteNoteSection]);

  const removeTemplate = useCallback(async () => {
    if (!selectedMode) return;
    await clearNoteSections(selectedMode.id);
  }, [clearNoteSections, selectedMode]);

  const handleDeleteMode = useCallback(async () => {
    if (!selectedMode || selectedMode.id === generalModeId) return;
    await deleteMode(selectedMode.id);
    setDeleteConfirmOpen(false);
    setMenuOpen(false);
  }, [deleteMode, generalModeId, selectedMode]);

  const handleDeleteSidebarMode = useCallback(async (mode: UserMode | null) => {
    if (!mode || mode.id === generalModeId) return;
    await deleteMode(mode.id);
  }, [deleteMode, generalModeId]);

  if (restricted) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative flex h-full flex-col overflow-hidden bg-[#151515] text-white"
        style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", sans-serif' }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close modes"
          className="absolute right-5 top-5 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.04] text-white/45 transition-colors hover:text-white/75"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-1 items-center justify-center px-10 text-center">
          <div className="max-w-[520px]">
            <h1 className="text-[32px] font-semibold leading-[1.02] tracking-[-0.04em] text-white">
              Every conversation. A different expert.
            </h1>
            <p className="mx-auto mt-4 max-w-[460px] text-[14px] leading-[1.5] text-white/45">
              Unlock Pro to access advanced modes and unlimited custom modes.
            </p>
            <button
              type="button"
              onClick={() => {
                onOpenTeamSyncAPI?.();
                onClose();
              }}
              className="mt-7 h-11 rounded-full bg-white px-6 text-[14px] font-semibold text-[#161616] transition-transform hover:scale-[1.01] active:scale-[0.99]"
            >
              Unlock Pro
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative flex h-full overflow-hidden bg-[#171717] text-white"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", sans-serif' }}
    >
      <aside className="flex h-full w-[292px] shrink-0 flex-col border-r border-white/[0.075] bg-[#181818]">
        <div className="flex h-[68px] shrink-0 items-center gap-[10px] border-b border-white/[0.07] px-[16px]">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modes"
            className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-white/[0.075] bg-white/[0.025] text-white/36 transition-colors hover:border-white/[0.13] hover:bg-white/[0.05] hover:text-white/68"
          >
            <X className="h-[21px] w-[21px] stroke-[1.8]" />
          </button>
          <h1 className="text-[18px] font-[780] leading-none tracking-[-0.045em] text-white/88">MODES</h1>
          <Badge tone="beta">Beta</Badge>
        </div>

        <div className="shrink-0 px-[14px] py-[12px]">
          <button
            type="button"
            onClick={() => openNameDialog('new-mode')}
            className="flex h-[48px] w-full items-center justify-center gap-[10px] rounded-[14px] border-2 border-dashed border-white/[0.095] bg-white/[0.012] text-[15px] font-[650] tracking-[-0.03em] text-white/43 transition-all hover:border-white/[0.17] hover:bg-white/[0.035] hover:text-white/68 active:scale-[0.99]"
          >
            <Plus className="h-[21px] w-[21px] stroke-[2]" />
            New Mode
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-[14px] pb-[10px]">
          <div className="space-y-[8px]">
            {builtInRows.map((row) => {
              const isSelected = panelView === 'editor' && selectedMode?.id === row.mode?.id;
              const isActive = Boolean(row.mode && activeModeId === row.mode.id);

              return (
                <motion.div
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  key={row.templateId}
                  className="group relative"
                >
                  <button
                    type="button"
                    onClick={() => selectBuiltInTemplate(row.templateId)}
                    className={clsx(
                      'relative flex h-[52px] w-full items-center gap-[10px] rounded-[13px] px-[12px] pr-[38px] text-left transition-all active:scale-[0.985]',
                      isSelected ? 'bg-white/[0.075] text-white' : 'text-white/68 hover:bg-white/[0.04] hover:text-white/86',
                    )}
                  >
                    {isSelected && <span className="absolute inset-y-0 left-0 w-[3px] rounded-l-[13px] bg-white/82" />}
                    <ModeIcon templateId={row.templateId} className="h-[34px] w-[34px]" />
                    <span className="flex min-w-0 flex-1 items-center gap-[7px]">
                      <span className="min-w-0 truncate text-[14px] font-[650] tracking-[-0.035em]">
                        {truncateModeName(row.name)}
                      </span>
                      {isActive && <Badge tone="active">Active</Badge>}
                    </span>
                  </button>
                  {row.templateId !== 'general' && row.mode && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDeleteSidebarMode(row.mode);
                      }}
                      aria-label={`Remove ${row.name} from sidebar`}
                      title="Remove from sidebar"
                      className="absolute right-[7px] top-1/2 flex h-[28px] w-[28px] -translate-y-1/2 items-center justify-center rounded-[8px] text-white/24 opacity-0 transition-all hover:bg-[#ff6f94]/12 hover:text-[#ff86a4] group-hover:opacity-100"
                    >
                      <Trash2 className="h-[14px] w-[14px]" />
                    </button>
                  )}
                </motion.div>
              );
            })}

            {customModes.map((mode) => {
              const isSelected = panelView === 'editor' && selectedMode?.id === mode.id;
              const isActive = activeModeId === mode.id;

              return (
                <motion.div
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  key={mode.id}
                  className="group relative"
                >
                  <button
                    type="button"
                    onClick={() => handleSelectMode(mode.id)}
                    className={clsx(
                      'relative flex h-[52px] w-full items-center gap-[10px] rounded-[13px] px-[12px] pr-[38px] text-left transition-all active:scale-[0.985]',
                      isSelected ? 'bg-white/[0.075] text-white' : 'text-white/68 hover:bg-white/[0.04] hover:text-white/86',
                    )}
                  >
                    {isSelected && <span className="absolute inset-y-0 left-0 w-[3px] rounded-l-[13px] bg-white/82" />}
                    <ModeIcon templateId={mode.templateId} className="h-[34px] w-[34px]" />
                    <span className="flex min-w-0 flex-1 items-center gap-[7px]">
                      <span className="min-w-0 truncate text-[14px] font-[650] tracking-[-0.035em]">{mode.name}</span>
                      {isActive && <Badge tone="active">Active</Badge>}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteSidebarMode(mode);
                    }}
                    aria-label={`Remove ${mode.name} from sidebar`}
                    title="Remove from sidebar"
                    className="absolute right-[7px] top-1/2 flex h-[28px] w-[28px] -translate-y-1/2 items-center justify-center rounded-[8px] text-white/24 opacity-0 transition-all hover:bg-[#ff6f94]/12 hover:text-[#ff86a4] group-hover:opacity-100"
                  >
                    <Trash2 className="h-[14px] w-[14px]" />
                  </button>
                </motion.div>
              );
            })}
          </div>
        </nav>

        <div className="shrink-0 border-t border-white/[0.075] px-[14px] py-[12px]">
          <motion.button
            type="button"
            onClick={() => {
              setPanelView('templates');
              setPendingModeName(null);
            }}
            whileTap={{ scale: 0.985 }}
            className={clsx(
              'flex h-[52px] w-full items-center gap-[10px] rounded-[13px] px-[12px] text-left transition-all',
              panelView === 'templates' ? 'bg-white/[0.07] text-white/72' : 'bg-white/[0.025] text-white/48 hover:bg-white/[0.05] hover:text-white/72',
            )}
          >
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-white/[0.045] text-white/45">
              <Grid2X2 className="h-[21px] w-[21px] stroke-[2]" />
            </span>
            <span className="text-[15px] font-[650] tracking-[-0.035em]">Quietly Templates</span>
            <ChevronRight className={clsx('ml-auto h-5 w-5 text-white/30 transition-transform duration-200', panelView === 'templates' && 'translate-x-1')} />
          </motion.button>
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 overflow-hidden bg-[#171717]">
        {isLoading && !initialized ? (
          <div className="flex h-full items-center justify-center text-white/38">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading modes
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {panelView === 'templates' ? (
              <motion.div
                key="templates"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -18 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="h-full overflow-y-auto px-[26px] pb-[28px] pt-[26px]"
              >
                <div className="max-w-[485px]">
                  <h2 className="text-[27px] font-[760] leading-none tracking-[-0.055em] text-white/92">Templates</h2>
                  <p className="mt-[12px] text-[13.5px] font-[450] leading-[1.45] tracking-[-0.018em] text-white/45">
                    Get started by selecting a template or start from an empty mode.
                  </p>

                  {pendingModeName && (
                    <div className="mt-5 inline-flex rounded-full border border-white/[0.08] bg-white/[0.035] px-4 py-2 text-[13px] font-medium text-white/48">
                      Creating: <span className="ml-1 text-white/70">{pendingModeName}</span>
                    </div>
                  )}

                  <div className="mt-[22px] space-y-[8px]">
                    {TEMPLATE_PICKER_IDS.map((templateId) => {
                      const template = MODE_TEMPLATE_MAP[templateId];
                      const Icon = getTemplateIcon(templateId);
                      const colors = TEMPLATE_COLORS[templateId];

                      return (
                        <motion.button
                          layout
                          key={templateId}
                          type="button"
                          onClick={() => handleTemplateClick(templateId)}
                          whileTap={{ scale: 0.985 }}
                          className="group flex min-h-[62px] w-full items-center gap-[14px] rounded-[14px] px-[14px] text-left transition-all hover:bg-white/[0.055]"
                        >
                          <span
                            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[12px] border"
                            style={{ backgroundColor: colors.bg, borderColor: colors.border, color: colors.accent }}
                          >
                            <Icon size={21} weight="duotone" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 text-[16px] font-[720] leading-tight tracking-[-0.04em] text-white/82">
                              {template.name}
                              <ChevronRight className="h-5 w-5 text-white/35 transition-transform group-hover:translate-x-1" />
                            </span>
                            <span className="mt-[4px] block text-[12.5px] font-[440] leading-[1.35] tracking-[-0.018em] text-white/45">
                              {TEMPLATE_COPY[templateId]}
                            </span>
                          </span>
                        </motion.button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => handleTemplateClick('empty')}
                      className="group mt-[14px] flex h-[38px] items-center gap-2 rounded-[12px] text-[13.5px] font-[500] tracking-[-0.02em] text-white/38 transition-colors hover:text-white/62"
                    >
                      <Plus className="h-5 w-5" />
                      Start from empty mode
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : selectedMode ? (
              <motion.div
                key={`editor-${selectedMode.id}`}
                initial={{ opacity: 0, x: -18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 18 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="h-full overflow-y-auto px-[22px] pb-[28px] pt-[22px]"
              >
                <div className="mx-auto max-w-[470px]">
                  <header className="mb-[18px] flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {editingName ? (
                        <input
                          ref={modeNameInputRef}
                          value={nameDraft}
                          onChange={(event) => setNameDraft(event.target.value)}
                          onBlur={handleSaveName}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') handleSaveName();
                            if (event.key === 'Escape') {
                              setNameDraft(selectedMode.name);
                              setEditingName(false);
                            }
                          }}
                          className="w-full rounded-[12px] border border-white/[0.16] bg-white/[0.045] px-3 py-2 text-[27px] font-[760] leading-none tracking-[-0.055em] text-white outline-none focus:border-white/[0.28]"
                        />
                      ) : (
                        <h2
                          onDoubleClick={() => {
                            if (!selectedIsBuiltIn) setEditingName(true);
                          }}
                          className={clsx(
                            'truncate text-[28px] font-[780] leading-none tracking-[-0.06em] text-white/94',
                            !selectedIsBuiltIn && 'cursor-text',
                          )}
                        >
                          {selectedIsBuiltIn ? selectedTemplate.name : selectedMode.name}
                        </h2>
                      )}
                      <p className="mt-[9px] text-[13px] font-[500] tracking-[-0.015em] text-white/36">
                        {selectedIsBuiltIn
                          ? `Powered by Natively's built-in ${selectedTemplate.name} intelligence.`
                          : `${selectedTemplate.name} template`}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-[8px]">
                      <button
                        type="button"
                        onClick={handleSetActive}
                        disabled={isActiveMode || isSaving}
                        className={clsx(
                          'inline-flex h-[38px] items-center gap-[8px] rounded-full border-none px-[14px] text-[12.5px] font-[700] tracking-[-0.02em] transition-all',
                          isActiveMode
                            ? 'bg-[#22c55e] text-white'
                            : 'bg-[#3b82f6] text-white hover:bg-[#2563eb] active:scale-[0.98]',
                        )}
                      >
                        <Check className="h-[16px] w-[16px] stroke-[2.4]" />
                        {isActiveMode ? 'Active' : 'Set active'}
                      </button>

                      <div ref={menuRef} className="relative">
                        <button
                          type="button"
                          onClick={() => setMenuOpen((open) => !open)}
                          aria-label="Mode options"
                          className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-white/[0.055] text-white/40 transition-colors hover:bg-white/[0.09] hover:text-white/68"
                        >
                          <MoreHorizontal className="h-[20px] w-[20px]" />
                        </button>

                        <AnimatePresence>
                          {menuOpen && (
                            <motion.div
                              initial={{ opacity: 0, y: -6, scale: 0.98 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: -4, scale: 0.98 }}
                              transition={{ duration: 0.12 }}
                              className="absolute right-0 top-[50px] z-20 w-[168px] overflow-hidden rounded-[14px] border border-white/[0.1] bg-[#222] py-1.5 shadow-[0_20px_46px_rgba(0,0,0,0.42)]"
                            >
                              {!selectedCanDelete ? (
                                <div className="px-3 py-2.5 text-[13px] font-medium text-white/38">General stays pinned</div>
                              ) : (
                                <>
                                  {!selectedIsBuiltIn && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingName(true);
                                        setMenuOpen(false);
                                      }}
                                      className="w-full px-3 py-2.5 text-left text-[13px] font-medium text-white/68 transition-colors hover:bg-white/[0.055] hover:text-white"
                                    >
                                      Rename
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeleteConfirmOpen(true);
                                      setMenuOpen(false);
                                    }}
                                    className="w-full px-3 py-2.5 text-left text-[13px] font-medium text-[#ff7899] transition-colors hover:bg-[#ff6f94]/12"
                                  >
                                    Delete
                                  </button>
                                </>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </header>

                  {error && (
                    <div className="mb-4 rounded-[12px] border border-[#ff6f94]/25 bg-[#ff6f94]/10 px-4 py-3 text-[13px] text-[#ff9ab2]">
                      {error}
                    </div>
                  )}

                  <section className="mb-[22px]">
                    <h3 className="mb-[12px] text-[17px] font-[730] tracking-[-0.04em] text-white/88">Realtime Prompt</h3>
                    <div className="overflow-hidden rounded-[18px] border border-white/[0.13] bg-[#202020]">
                      <div className="relative">
                        <textarea
                          value={promptDraft}
                          onChange={(event) => setPromptDraft(event.target.value)}
                          onKeyDown={handlePromptKeyDown}
                          placeholder="Tell Natively how to respond during the conversation."
                          spellCheck={false}
                          className="h-[210px] w-full resize-none bg-transparent px-[18px] py-[16px] text-[14px] font-[450] leading-[1.52] tracking-[-0.02em] text-white/82 outline-none placeholder:text-white/30"
                        />
                        <div className="pointer-events-none absolute bottom-[13px] right-[18px] flex items-center gap-[7px] text-[12px] font-medium text-white/25">
                          <span>{promptDraft.length}</span>
                          <span className="h-[14px] w-px bg-white/[0.12]" />
                          <span>chars</span>
                        </div>
                      </div>
                      <div className="flex h-[52px] items-center justify-between border-t border-white/[0.09] px-[16px]">
                        <p className="text-[12px] font-medium text-white/30">
                          Press <kbd className="rounded-[6px] border border-white/[0.09] bg-white/[0.045] px-[8px] py-[3px] font-mono text-[11px] text-white/36">Cmd+Enter</kbd> to save
                        </p>
                        <button
                          type="button"
                          onClick={handleSavePrompt}
                          disabled={isSavingPrompt || promptDraft === selectedMode.userPrompt}
                          className={clsx(
                            'inline-flex h-[39px] items-center gap-[8px] rounded-[12px] px-[16px] text-[13px] font-[700] tracking-[-0.025em] transition-all',
                            promptDraft === selectedMode.userPrompt
                              ? 'bg-white/[0.045] text-white/22'
                              : 'bg-white/[0.1] text-white/72 hover:bg-white/[0.14] hover:text-white active:scale-[0.98]',
                          )}
                        >
                          {isSavingPrompt ? <Loader2 className="h-[16px] w-[16px] animate-spin" /> : <Save className="h-[16px] w-[16px]" />}
                          Save Prompt
                        </button>
                      </div>
                    </div>
                  </section>

                  <section className="mb-[22px] rounded-[16px] border border-white/[0.1] bg-white/[0.025] p-[16px]">
                    <div className="mb-[14px] flex items-center justify-between gap-4">
                      <h3 className="text-[12px] font-[780] uppercase tracking-[0.16em] text-white/36">Reference Files</h3>
                      <button
                        type="button"
                        onClick={handleUploadFile}
                        disabled={isUploadingFile}
                        className="inline-flex h-[39px] items-center gap-[8px] rounded-[12px] border border-white/[0.13] bg-white/[0.035] px-[14px] text-[13px] font-[700] tracking-[-0.02em] text-white/62 transition-colors hover:bg-white/[0.065] hover:text-white/82 disabled:opacity-45"
                      >
                        {isUploadingFile ? <Loader2 className="h-[16px] w-[16px] animate-spin" /> : <Upload className="h-[16px] w-[16px]" />}
                        Upload
                      </button>
                    </div>

                    {selectedMode.referenceFiles.length ? (
                      <div className="space-y-2.5">
                        {selectedMode.referenceFiles.map((file) => (
                          <ReferenceFileRow
                            key={file.id}
                            file={file}
                            isRemoving={removingFileId === file.id}
                            onRemove={() => handleRemoveFile(file.id)}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyReferenceDropzone />
                    )}
                  </section>

                  <section className="pb-4">
                    <div className="mb-[14px] flex items-center justify-between gap-4">
                      <h3 className="text-[17px] font-[730] tracking-[-0.04em] text-white/88">Notes Template</h3>
                      <button
                        type="button"
                        onClick={removeTemplate}
                        className="text-[13px] font-[500] tracking-[-0.02em] text-white/32 transition-colors hover:text-white/58"
                      >
                        Remove template
                      </button>
                    </div>

                    <div className="space-y-[12px]">
                      {selectedMode.notesTemplate.map((section) => {
                        const isEditing = editingSectionId === section.id;

                        return (
                          <div
                            key={section.id}
                            className="group rounded-[14px] border border-white/[0.1] bg-white/[0.022] p-[14px] transition-colors hover:border-white/[0.16] hover:bg-white/[0.038]"
                          >
                            {isEditing ? (
                              <div className="space-y-3">
                                <input
                                  value={sectionTitleDraft}
                                  onChange={(event) => setSectionTitleDraft(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') saveEditingSection();
                                    if (event.key === 'Escape') setEditingSectionId(null);
                                  }}
                                  className="w-full rounded-[11px] border border-white/[0.12] bg-white/[0.04] px-3 py-2.5 text-[16px] font-semibold text-white outline-none focus:border-white/[0.24]"
                                  placeholder="Section title"
                                />
                                <textarea
                                  value={sectionDescriptionDraft}
                                  onChange={(event) => setSectionDescriptionDraft(event.target.value)}
                                  className="h-[76px] w-full resize-none rounded-[11px] border border-white/[0.12] bg-white/[0.04] px-3 py-2.5 text-[14px] leading-[1.4] text-white/72 outline-none focus:border-white/[0.24]"
                                  placeholder="Section description"
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setEditingSectionId(null)}
                                    className="h-9 rounded-[10px] px-4 text-[13px] font-semibold text-white/45 transition-colors hover:bg-white/[0.05] hover:text-white/68"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={saveEditingSection}
                                    disabled={!sectionTitleDraft.trim()}
                                    className="h-9 rounded-[10px] bg-white/[0.1] px-4 text-[13px] font-semibold text-white/72 transition-colors hover:bg-white/[0.14] hover:text-white disabled:opacity-35"
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-start gap-3">
                                <div className="min-w-0 flex-1">
                                  <h4 className="text-[16px] font-[730] tracking-[-0.04em] text-white/88">{section.title}</h4>
                                  <p className="mt-[7px] text-[13.5px] font-[430] leading-[1.38] tracking-[-0.02em] text-white/42">
                                    {section.description || 'No description.'}
                                  </p>
                                </div>
                                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                  <button
                                    type="button"
                                    onClick={() => startEditingSection(section)}
                                    className="flex h-8 w-8 items-center justify-center rounded-[9px] text-white/32 transition-colors hover:bg-white/[0.06] hover:text-white/68"
                                    aria-label={`Edit ${section.title}`}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeSection(section.id)}
                                    disabled={removingSectionId === section.id}
                                    className="flex h-8 w-8 items-center justify-center rounded-[9px] text-white/28 transition-colors hover:bg-[#ff6f94]/12 hover:text-[#ff7899] disabled:opacity-50"
                                    aria-label={`Delete ${section.title}`}
                                  >
                                    {removingSectionId === section.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {!selectedMode.notesTemplate.length && (
                        <div className="rounded-[17px] border border-dashed border-white/[0.1] bg-white/[0.018] px-5 py-8 text-center text-[14px] text-white/34">
                          No note sections yet
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={addSection}
                        className="inline-flex h-[39px] items-center gap-[8px] rounded-full border border-white/[0.09] bg-white/[0.018] px-[17px] text-[13.5px] font-[600] tracking-[-0.025em] text-white/42 transition-colors hover:border-white/[0.16] hover:bg-white/[0.04] hover:text-white/68"
                      >
                        <Plus className="h-[19px] w-[19px]" />
                        Add Section
                      </button>
                    </div>
                  </section>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="flex h-full items-center justify-center text-white/34"
              >
                Select a mode
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </main>

      <AnimatePresence>
        {nameDialog.isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/62 backdrop-blur-sm"
            onClick={closeNameDialog}
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="w-[410px] rounded-[22px] border border-white/[0.12] bg-[#202020] p-[24px] shadow-[0_28px_80px_rgba(0,0,0,0.5)]"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 className="text-[23px] font-[760] tracking-[-0.045em] text-white/92">Mode Name</h2>
              <p className="mt-2 text-[14px] leading-[1.45] text-white/42">
                Name the mode before choosing how it starts.
              </p>
              <input
                ref={nameInputRef}
                value={nameValue}
                onChange={(event) => {
                  setNameValue(event.target.value);
                  setNameError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleNameConfirm();
                  if (event.key === 'Escape') closeNameDialog();
                }}
                placeholder="Mode Name"
                maxLength={50}
                className={clsx(
                  'mt-5 h-[48px] w-full rounded-[13px] border bg-white/[0.035] px-4 text-[16px] font-medium text-white outline-none placeholder:text-white/26 focus:border-white/[0.25]',
                  nameError ? 'border-[#ff6f94]/45' : 'border-white/[0.11]',
                )}
              />
              {nameError && <p className="mt-2 text-[12px] font-medium text-[#ff86a4]">{nameError}</p>}
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeNameDialog}
                  className="h-10 rounded-[11px] px-4 text-[14px] font-semibold text-white/46 transition-colors hover:bg-white/[0.055] hover:text-white/72"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleNameConfirm}
                  disabled={!nameValue.trim()}
                  className="h-10 rounded-[11px] bg-white/[0.12] px-5 text-[14px] font-semibold text-white/78 transition-colors hover:bg-white/[0.17] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                >
                  Continue
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteConfirmOpen && selectedMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/62 backdrop-blur-sm"
            onClick={() => setDeleteConfirmOpen(false)}
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="w-[420px] rounded-[22px] border border-white/[0.12] bg-[#202020] p-[24px] shadow-[0_28px_80px_rgba(0,0,0,0.5)]"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 className="text-[22px] font-[760] tracking-[-0.045em] text-white/92">Delete {selectedMode.name}?</h2>
              <p className="mt-3 text-[14px] leading-[1.45] text-white/42">
                This removes the custom mode, prompt, reference files, and notes template.
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmOpen(false)}
                  className="h-10 rounded-[11px] px-4 text-[14px] font-semibold text-white/46 transition-colors hover:bg-white/[0.055] hover:text-white/72"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteMode}
                  className="h-10 rounded-[11px] bg-[#ff6f94]/18 px-5 text-[14px] font-semibold text-[#ff86a4] transition-colors hover:bg-[#ff6f94]/25"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default PremiumModes;
