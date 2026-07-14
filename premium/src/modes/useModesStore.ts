import { create } from 'zustand';
import type {
  ModeReferenceFile,
  ModesStateSnapshot,
  ModeTemplateId,
  PublicModeTemplate,
  UserMode,
} from '../../../src/lib/modes/types';

interface ModesStore extends ModesStateSnapshot {
  isLoading: boolean;
  isSaving: boolean;
  isTemplateLibraryOpen: boolean;
  error: string | null;
  initialized: boolean;
  initialize: () => Promise<() => void>;
  hydrate: (snapshot: ModesStateSnapshot) => void;
  openTemplateLibrary: () => void;
  closeTemplateLibrary: () => void;
  selectMode: (modeId: string | null) => Promise<void>;
  createModeFromTemplate: (templateId: ModeTemplateId, name?: string) => Promise<void>;
  createEmptyMode: (name: string) => Promise<void>;
  setActiveMode: (modeId: string | null) => Promise<void>;
  updateMode: (modeId: string, updates: { name?: string; userPrompt?: string }) => Promise<void>;
  deleteMode: (modeId: string) => Promise<void>;
  uploadReferenceFile: (modeId: string) => Promise<ModeReferenceFile | null>;
  deleteReferenceFile: (fileId: string) => Promise<void>;
  addNoteSection: (modeId: string, title: string, description: string) => Promise<void>;
  updateNoteSection: (sectionId: string, updates: { title?: string; description?: string }) => Promise<void>;
  deleteNoteSection: (sectionId: string) => Promise<void>;
  clearNoteSections: (modeId: string) => Promise<void>;
  resetNoteSections: (modeId: string) => Promise<void>;
}

const EMPTY_SNAPSHOT: ModesStateSnapshot = {
  templates: [],
  userModes: [],
  selectedModeId: null,
  activeModeId: null,
};

function ensureSnapshot(snapshot?: ModesStateSnapshot | null): ModesStateSnapshot {
  return snapshot ?? EMPTY_SNAPSHOT;
}

async function withMutation<T>(
  set: (fn: (state: ModesStore) => Partial<ModesStore>) => void,
  run: () => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string } & T>,
  onSuccess?: (result: { success: boolean; state?: ModesStateSnapshot; error?: string } & T) => void
): Promise<void> {
  set(() => ({ isSaving: true, error: null }));
  try {
    const result = await run();
    if (!result.success) {
      set(() => ({ isSaving: false, error: result.error ?? 'Unable to save mode changes.' }));
      return;
    }

    if (result.state) {
      set(() => ({
        ...ensureSnapshot(result.state),
        isSaving: false,
        error: null,
      }));
    } else {
      set(() => ({ isSaving: false, error: null }));
    }

    onSuccess?.(result);
  } catch (error: any) {
    set(() => ({
      isSaving: false,
      error: error?.message ?? 'Unable to save mode changes.',
    }));
  }
}

export const useModesStore = create<ModesStore>((set, get) => ({
  ...EMPTY_SNAPSHOT,
  isLoading: true,
  isSaving: false,
  isTemplateLibraryOpen: false,
  error: null,
  initialized: false,

  hydrate: (snapshot) => {
    set(() => ({
      ...ensureSnapshot(snapshot),
      isLoading: false,
      error: null,
      initialized: true,
    }));
  },

  initialize: async () => {
    const snapshot = await window.electronAPI.modesGetState();
    get().hydrate(snapshot);

    const unsubscribe = window.electronAPI.onModesStateChanged((nextSnapshot) => {
      set((state) => ({
        ...ensureSnapshot(nextSnapshot),
        isLoading: false,
        isSaving: false,
        error: state.error && nextSnapshot ? null : state.error,
        initialized: true,
      }));
    });

    return unsubscribe;
  },

  openTemplateLibrary: () => set(() => ({ isTemplateLibraryOpen: true })),
  closeTemplateLibrary: () => set(() => ({ isTemplateLibraryOpen: false })),

  selectMode: async (modeId) => {
    await withMutation(set, () => window.electronAPI.modesSetSelected(modeId));
  },

  createModeFromTemplate: async (templateId, name) => {
    await withMutation(
      set,
      () => window.electronAPI.modesCreate({ templateId, name }),
      () => set(() => ({ isTemplateLibraryOpen: false }))
    );
  },

  createEmptyMode: async (name) => {
    await withMutation(
      set,
      () => window.electronAPI.modesCreate({ templateId: 'general', name }),
      () => set(() => ({ isTemplateLibraryOpen: false }))
    );
  },

  setActiveMode: async (modeId) => {
    await withMutation(set, () => window.electronAPI.modesSetActive(modeId));
  },

  updateMode: async (modeId, updates) => {
    await withMutation(set, () => window.electronAPI.modesUpdate(modeId, updates));
  },

  deleteMode: async (modeId) => {
    await withMutation(set, () => window.electronAPI.modesDelete(modeId));
  },

  uploadReferenceFile: async (modeId) => {
    let uploadedFile: ModeReferenceFile | null = null;
    await withMutation(
      set,
      () => window.electronAPI.modesUploadReferenceFile(modeId),
      (result) => {
        uploadedFile = result.file ?? null;
      }
    );
    return uploadedFile;
  },

  deleteReferenceFile: async (fileId) => {
    await withMutation(set, () => window.electronAPI.modesDeleteReferenceFile(fileId));
  },

  addNoteSection: async (modeId, title, description) => {
    await withMutation(set, () => window.electronAPI.modesAddNoteSection(modeId, title, description));
  },

  updateNoteSection: async (sectionId, updates) => {
    await withMutation(set, () => window.electronAPI.modesUpdateNoteSection(sectionId, updates));
  },

  deleteNoteSection: async (sectionId) => {
    await withMutation(set, () => window.electronAPI.modesDeleteNoteSection(sectionId));
  },

  clearNoteSections: async (modeId) => {
    await withMutation(set, () => window.electronAPI.modesRemoveAllNoteSections(modeId));
  },

  resetNoteSections: async (modeId) => {
    await withMutation(set, () => window.electronAPI.modesResetNoteSections(modeId));
  },
}));

export function getSelectedMode(modes: UserMode[], selectedModeId: string | null): UserMode | null {
  return modes.find((mode) => mode.id === selectedModeId) ?? modes[0] ?? null;
}

export function getTemplateById(templates: PublicModeTemplate[], templateId: ModeTemplateId): PublicModeTemplate | null {
  return templates.find((template) => template.id === templateId) ?? null;
}
