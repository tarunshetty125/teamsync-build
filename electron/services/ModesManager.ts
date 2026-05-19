import Store from 'electron-store';
import { randomUUID } from 'crypto';
import { cloneModeTemplateSections, MODE_TEMPLATE_MAP } from '../../src/lib/modes/templateCatalog';
import type {
    ModeIntelligenceType,
    ModeReferenceFile,
    ModesStateSnapshot,
    ModeTemplateId,
    PublicModeTemplate,
    UserMode,
    UserModeNoteSection,
} from '../../src/lib/modes/types';
import { getBuiltInModeTemplate, getPublicModeTemplates } from './modeTemplateRegistry';

export type ModeTemplateType = ModeTemplateId;

export interface Mode {
    id: string;
    name: string;
    templateType: ModeTemplateType;
    userPrompt: string;
    customContext: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface ModeNoteSection {
    id: string;
    modeId: string;
    title: string;
    description: string;
    sortOrder: number;
    createdAt: string;
}

export interface ActiveModeSnapshot {
    activeModeId: string;
    templateType: ModeTemplateType;
    renderedModeContext: string;
    notesTemplate: Array<{ title: string; description: string }>;
    modeMetadata: {
        id: string;
        name: string;
        intelligenceType: ModeIntelligenceType;
        createdAt: string;
        updatedAt: string;
    };
}

export const MODE_TEMPLATES: Array<{
    type: ModeTemplateType;
    label: string;
    description: string;
}> = getPublicModeTemplates().map((template) => ({
    type: template.id,
    label: template.name,
    description: template.description,
}));

export const TEMPLATE_NOTE_SECTIONS: Record<ModeTemplateType, Array<{ title: string; description: string }>> =
    getPublicModeTemplates().reduce((acc, template) => {
        acc[template.id] = template.notesTemplate.map((section) => ({
            title: section.title,
            description: section.description,
        }));
        return acc;
    }, {} as Record<ModeTemplateType, Array<{ title: string; description: string }>>);

interface PersistedModesState {
    version: number;
    selectedModeId: string | null;
    activeModeId: string | null;
    userModes: UserMode[];
    legacyMigrated: boolean;
}

const STORE_VERSION = 1;
const STORE_NAME = 'teamsync-modes';
const MAX_FILE_CHARS = 12_000;
const MAX_TOTAL_CHARS = 40_000;

const LEGACY_TEMPLATE_SECTION_TITLES: Partial<Record<ModeTemplateType, string[]>> = {
    sales: ['Action Items', 'Outcome', 'Discovery', 'Objections'],
    recruiting: ['Action Items', 'Signal Summary', 'Experience and Skills', 'Role Fit'],
    'team-meet': ['Summary', 'Action Items', 'Decisions Made', 'Challenges or Blockers'],
    'looking-for-work': ['Overview', 'Questions and Responses', 'Follow-up Actions', 'Areas to Improve'],
    lecture: ['Topic', 'Key Concepts', 'Detailed Notes', 'Follow-up Work'],
    'technical-interview': ['Problems Covered', 'Concepts Tested', 'What Went Well', 'Areas to Study'],
};

function isoNow(): string {
    return new Date().toISOString();
}

function makeId(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
}

function deepFreezeSnapshot<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const nested of Object.values(value as Record<string, unknown>)) {
            deepFreezeSnapshot(nested);
        }
    }
    return value;
}

function cloneTemplateSections(templateId: ModeTemplateType): UserModeNoteSection[] {
    return cloneModeTemplateSections(templateId).map((section) => ({
        ...section,
        id: makeId('section'),
    }));
}

function sanitizeName(name: string | undefined, fallback: string): string {
    return name?.trim() ? name.trim() : fallback;
}

function matchesLegacyTemplateSections(mode: UserMode): boolean {
    const legacyTitles = LEGACY_TEMPLATE_SECTION_TITLES[mode.templateId];
    if (!legacyTitles || mode.notesTemplate.length !== legacyTitles.length) {
        return false;
    }

    return mode.notesTemplate.every((section, index) => section.title === legacyTitles[index]);
}

function toMode(mode: UserMode, activeModeId: string | null): Mode {
    return {
        id: mode.id,
        name: mode.name,
        templateType: mode.templateId,
        userPrompt: mode.userPrompt,
        customContext: mode.userPrompt,
        isActive: mode.id === activeModeId,
        createdAt: mode.createdAt,
        updatedAt: mode.updatedAt,
    };
}

function toModeNoteSection(modeId: string, section: UserModeNoteSection, sortOrder: number): ModeNoteSection {
    return {
        id: section.id,
        modeId,
        title: section.title,
        description: section.description,
        sortOrder,
        createdAt: isoNow(),
    };
}

function sortModes(userModes: UserMode[]): UserMode[] {
    return [...userModes].sort((a, b) => {
        if (a.templateId === 'general' && b.templateId !== 'general') return -1;
        if (b.templateId === 'general' && a.templateId !== 'general') return 1;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}

function createModeInstance(templateId: ModeTemplateType, name?: string): UserMode {
    const template = getBuiltInModeTemplate(templateId);
    const now = isoNow();
    return {
        id: makeId('mode'),
        templateId,
        name: sanitizeName(name, template.name),
        userPrompt: MODE_TEMPLATE_MAP[templateId]?.defaultUserPrompt ?? '',
        referenceFiles: [],
        notesTemplate: cloneTemplateSections(templateId),
        createdAt: now,
        updatedAt: now,
    };
}

export class ModesManager {
    private static instance: ModesManager;
    private readonly store: Store<PersistedModesState>;

    private constructor() {
        this.store = new Store<PersistedModesState>({
            name: STORE_NAME,
            defaults: {
                version: STORE_VERSION,
                selectedModeId: null,
                activeModeId: null,
                userModes: [],
                legacyMigrated: false,
            },
        });

        this.migrateLegacyModesIfNeeded();
        this.ensureValidState();
    }

    public static getInstance(): ModesManager {
        if (!ModesManager.instance) {
            ModesManager.instance = new ModesManager();
        }
        return ModesManager.instance;
    }

    private migrateLegacyModesIfNeeded(): void {
        if (this.store.get('legacyMigrated')) return;
        if (this.store.get('userModes').length > 0) {
            this.store.set('legacyMigrated', true);
            return;
        }

        try {
            // Best-effort migration from the legacy sqlite-backed modes manager.
            // Keeps existing user-entered prompts/files/sections when available.
            // Failure is non-fatal: we fall back to a fresh General mode.
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { DatabaseManager } = require('../db/DatabaseManager');
            const db = DatabaseManager.getInstance();
            const legacyModes = Array.isArray(db.getModes?.()) ? db.getModes() : [];
            if (!legacyModes.length) {
                this.store.set('legacyMigrated', true);
                return;
            }

            const migratedModes: UserMode[] = legacyModes.map((legacyMode: any) => {
                const templateId = (legacyMode.template_type || 'general') as ModeTemplateType;
                const legacyFiles = Array.isArray(db.getReferenceFiles?.(legacyMode.id)) ? db.getReferenceFiles(legacyMode.id) : [];
                const legacySections = Array.isArray(db.getNoteSections?.(legacyMode.id)) ? db.getNoteSections(legacyMode.id) : [];

                return {
                    id: legacyMode.id || makeId('mode'),
                    templateId,
                    name: sanitizeName(legacyMode.name, getBuiltInModeTemplate(templateId).name),
                    userPrompt: legacyMode.custom_context || MODE_TEMPLATE_MAP[templateId]?.defaultUserPrompt || '',
                    referenceFiles: legacyFiles.map((file: any): ModeReferenceFile => ({
                        id: file.id || makeId('ref'),
                        fileName: file.file_name || 'Reference file',
                        filePath: null as string | null,
                        content: file.content ?? '',
                        createdAt: file.created_at || isoNow(),
                    })),
                    notesTemplate: legacySections.length > 0
                        ? legacySections.map((section: any) => ({
                            id: section.id || makeId('section'),
                            title: section.title || 'Section',
                            description: section.description ?? '',
                        }))
                        : cloneTemplateSections(templateId),
                    createdAt: legacyMode.created_at || isoNow(),
                    updatedAt: legacyMode.updated_at || legacyMode.created_at || isoNow(),
                };
            });

            const activeLegacyMode = db.getActiveMode?.();
            this.store.set({
                userModes: migratedModes,
                selectedModeId: activeLegacyMode?.id ?? migratedModes[0]?.id ?? null,
                activeModeId: activeLegacyMode?.id ?? migratedModes[0]?.id ?? null,
                legacyMigrated: true,
                version: STORE_VERSION,
            });
        } catch (error: any) {
            console.warn('[ModesManager] Legacy modes migration skipped:', error?.message || error);
            this.store.set('legacyMigrated', true);
        }
    }

    private ensureValidState(): PersistedModesState {
        let state = this.readState();

        if (!state.userModes.length) {
            const generalMode = createModeInstance('general');
            state = {
                ...state,
                userModes: [generalMode],
                selectedModeId: generalMode.id,
                activeModeId: generalMode.id,
            };
        }

        const modeIds = new Set(state.userModes.map((mode) => mode.id));

        if (!state.selectedModeId || !modeIds.has(state.selectedModeId)) {
            state.selectedModeId = state.activeModeId && modeIds.has(state.activeModeId)
                ? state.activeModeId
                : state.userModes[0]?.id ?? null;
        }

        if (!state.activeModeId || !modeIds.has(state.activeModeId)) {
            state.activeModeId = state.userModes[0]?.id ?? null;
        }

        const sortedModes = sortModes(state.userModes);

        // Backfill: ensure modes with empty prompts inherit the template default
        let modesPatched = false;
        const patchedModes = sortedModes.map((mode) => {
            if (!mode.userPrompt && MODE_TEMPLATE_MAP[mode.templateId]?.defaultUserPrompt) {
                modesPatched = true;
                mode = { ...mode, userPrompt: MODE_TEMPLATE_MAP[mode.templateId].defaultUserPrompt };
            }

            if (matchesLegacyTemplateSections(mode)) {
                modesPatched = true;
                mode = { ...mode, notesTemplate: cloneTemplateSections(mode.templateId) };
            }

            return mode;
        });

        if (modesPatched || JSON.stringify(sortedModes) !== JSON.stringify(state.userModes)) {
            state.userModes = patchedModes;
        }

        this.writeState(state);
        return state;
    }

    private readState(): PersistedModesState {
        return {
            version: this.store.get('version', STORE_VERSION),
            selectedModeId: this.store.get('selectedModeId', null),
            activeModeId: this.store.get('activeModeId', null),
            userModes: this.store.get('userModes', []),
            legacyMigrated: this.store.get('legacyMigrated', false),
        };
    }

    private writeState(nextState: PersistedModesState): void {
        this.store.set({
            ...nextState,
            version: STORE_VERSION,
            userModes: sortModes(nextState.userModes),
        });
    }

    private mutateState(mutator: (state: PersistedModesState) => PersistedModesState): PersistedModesState {
        const current = this.ensureValidState();
        const next = mutator({
            ...current,
            userModes: current.userModes.map((mode) => ({
                ...mode,
                referenceFiles: mode.referenceFiles.map((file) => ({ ...file })),
                notesTemplate: mode.notesTemplate.map((section) => ({ ...section })),
            })),
        });
        this.writeState(next);
        return this.ensureValidState();
    }

    private findMode(modeId: string): UserMode | undefined {
        return this.ensureValidState().userModes.find((mode) => mode.id === modeId);
    }

    public getState(): ModesStateSnapshot {
        const state = this.ensureValidState();
        return {
            templates: getPublicModeTemplates(),
            userModes: state.userModes.map((mode) => ({
                ...mode,
                referenceFiles: mode.referenceFiles.map((file) => ({ ...file })),
                notesTemplate: mode.notesTemplate.map((section) => ({ ...section })),
            })),
            selectedModeId: state.selectedModeId,
            activeModeId: state.activeModeId,
        };
    }

    public getTemplates(): PublicModeTemplate[] {
        return getPublicModeTemplates();
    }

    public getModes(): Mode[] {
        const state = this.ensureValidState();
        return state.userModes.map((mode) => toMode(mode, state.activeModeId));
    }

    public getSelectedModeId(): string | null {
        return this.ensureValidState().selectedModeId;
    }

    public setSelectedMode(id: string | null): void {
        this.mutateState((state) => ({
            ...state,
            selectedModeId: id,
        }));
    }

    public getActiveMode(): Mode | null {
        const state = this.ensureValidState();
        const activeMode = state.userModes.find((mode) => mode.id === state.activeModeId);
        return activeMode ? toMode(activeMode, state.activeModeId) : null;
    }

    public createMode(params: { name?: string; templateType?: ModeTemplateType; templateId?: ModeTemplateType }): Mode {
        const templateId = params.templateId ?? params.templateType ?? 'general';
        let createdMode: UserMode | null = null;

        const state = this.mutateState((current) => {
            createdMode = createModeInstance(templateId, params.name);
            return {
                ...current,
                userModes: [...current.userModes, createdMode],
                selectedModeId: createdMode.id,
            };
        });

        const mode = createdMode ?? state.userModes[state.userModes.length - 1];
        return toMode(mode, state.activeModeId);
    }

    public updateMode(id: string, updates: {
        name?: string;
        templateType?: ModeTemplateType;
        templateId?: ModeTemplateType;
        customContext?: string;
        userPrompt?: string;
    }): void {
        this.mutateState((state) => ({
            ...state,
            userModes: state.userModes.map((mode) => {
                if (mode.id !== id) return mode;

                const nextTemplateId = updates.templateId ?? updates.templateType ?? mode.templateId;
                const nextUserPrompt = updates.userPrompt ?? updates.customContext ?? mode.userPrompt;

                return {
                    ...mode,
                    templateId: nextTemplateId,
                    name: updates.name !== undefined ? sanitizeName(updates.name, mode.name) : mode.name,
                    userPrompt: nextUserPrompt,
                    updatedAt: isoNow(),
                };
            }),
        }));
    }

    public deleteMode(id: string): void {
        this.mutateState((state) => {
            const remainingModes = state.userModes.filter((mode) => mode.id !== id);

            if (!remainingModes.length) {
                const generalMode = createModeInstance('general');
                return {
                    ...state,
                    userModes: [generalMode],
                    selectedModeId: generalMode.id,
                    activeModeId: generalMode.id,
                };
            }

            return {
                ...state,
                userModes: remainingModes,
                selectedModeId: state.selectedModeId === id ? remainingModes[0].id : state.selectedModeId,
                activeModeId: state.activeModeId === id ? remainingModes[0].id : state.activeModeId,
            };
        });
    }

    public setActiveMode(id: string | null): void {
        this.mutateState((state) => ({
            ...state,
            activeModeId: id,
            selectedModeId: id ?? state.selectedModeId,
        }));
    }

    public getReferenceFiles(modeId: string): ModeReferenceFile[] {
        return this.findMode(modeId)?.referenceFiles.map((file) => ({ ...file })) ?? [];
    }

    public addReferenceFile(params: {
        modeId: string;
        fileName: string;
        content: string;
        filePath?: string | null;
    }): ModeReferenceFile {
        const file: ModeReferenceFile = {
            id: makeId('ref'),
            fileName: params.fileName,
            filePath: params.filePath ?? null,
            content: params.content,
            createdAt: isoNow(),
        };

        this.mutateState((state) => ({
            ...state,
            userModes: state.userModes.map((mode) => {
                if (mode.id !== params.modeId) return mode;
                return {
                    ...mode,
                    referenceFiles: [...mode.referenceFiles, file],
                    updatedAt: isoNow(),
                };
            }),
        }));

        return file;
    }

    public deleteReferenceFile(id: string): void {
        this.mutateState((state) => ({
            ...state,
            userModes: state.userModes.map((mode) => {
                const nextFiles = mode.referenceFiles.filter((file) => file.id !== id);
                if (nextFiles.length === mode.referenceFiles.length) return mode;
                return {
                    ...mode,
                    referenceFiles: nextFiles,
                    updatedAt: isoNow(),
                };
            }),
        }));
    }

    public getNoteSections(modeId: string): ModeNoteSection[] {
        const mode = this.findMode(modeId);
        if (!mode) return [];
        return mode.notesTemplate.map((section, index) => toModeNoteSection(mode.id, section, index));
    }

    public addNoteSection(params: { modeId: string; title: string; description: string }): ModeNoteSection {
        const section: UserModeNoteSection = {
            id: makeId('section'),
            title: params.title,
            description: params.description,
        };

        this.mutateState((state) => ({
            ...state,
            userModes: state.userModes.map((mode) => {
                if (mode.id !== params.modeId) return mode;
                return {
                    ...mode,
                    notesTemplate: [...mode.notesTemplate, section],
                    updatedAt: isoNow(),
                };
            }),
        }));

        const mode = this.findMode(params.modeId);
        return toModeNoteSection(params.modeId, section, mode?.notesTemplate.length ? mode.notesTemplate.length - 1 : 0);
    }

    public updateNoteSection(id: string, updates: { title?: string; description?: string }): void {
        this.mutateState((state) => ({
            ...state,
            userModes: state.userModes.map((mode) => {
                const nextSections = mode.notesTemplate.map((section) => (
                    section.id === id
                        ? {
                            ...section,
                            title: updates.title ?? section.title,
                            description: updates.description ?? section.description,
                        }
                        : section
                ));

                const changed = nextSections.some((section, index) => section !== mode.notesTemplate[index]);
                return changed
                    ? { ...mode, notesTemplate: nextSections, updatedAt: isoNow() }
                    : mode;
            }),
        }));
    }

    public deleteNoteSection(id: string): void {
        this.mutateState((state) => ({
            ...state,
            userModes: state.userModes.map((mode) => {
                const nextSections = mode.notesTemplate.filter((section) => section.id !== id);
                if (nextSections.length === mode.notesTemplate.length) return mode;
                return {
                    ...mode,
                    notesTemplate: nextSections,
                    updatedAt: isoNow(),
                };
            }),
        }));
    }

    public removeAllNoteSections(modeId: string): void {
        this.mutateState((state) => ({
            ...state,
            userModes: state.userModes.map((mode) => (
                mode.id === modeId
                    ? { ...mode, notesTemplate: [], updatedAt: isoNow() }
                    : mode
            )),
        }));
    }

    public resetNoteSections(modeId: string): void {
        this.mutateState((state) => ({
            ...state,
            userModes: state.userModes.map((mode) => (
                mode.id === modeId
                    ? { ...mode, notesTemplate: cloneTemplateSections(mode.templateId), updatedAt: isoNow() }
                    : mode
            )),
        }));
    }

    public getActiveModeDeduped(): { suffix: string; templateType: ModeTemplateType | null } {
        const activeMode = this.getActiveMode();
        if (!activeMode) return { suffix: '', templateType: null };
        return {
            suffix: getBuiltInModeTemplate(activeMode.templateType).builtInPromptSuffix,
            templateType: activeMode.templateType,
        };
    }

    public buildActiveModeContextBlock(options?: { includeCustomContext?: boolean }): string {
        const state = this.ensureValidState();
        const activeMode = state.userModes.find((mode) => mode.id === state.activeModeId);
        if (!activeMode) return '';

        const parts: string[] = [];
        const includeCustomContext = options?.includeCustomContext !== false;

        if (includeCustomContext && activeMode.userPrompt.trim()) {
            parts.push(`<user_context>\n${activeMode.userPrompt.trim()}\n</user_context>`);
        }

        let totalChars = 0;
        for (const file of activeMode.referenceFiles) {
            const raw = file.content.trim();
            if (!raw) continue;

            const remaining = MAX_TOTAL_CHARS - totalChars;
            if (remaining <= 0) break;

            const capped = raw.length > MAX_FILE_CHARS
                ? `${raw.slice(0, MAX_FILE_CHARS - 14)}\n[...truncated]`
                : raw;
            const content = capped.slice(0, remaining);

            parts.push(`<reference_file name="${file.fileName}">\n${content}\n</reference_file>`);
            totalChars += content.length;
        }

        return parts.join('\n\n');
    }

    public getActiveModeSnapshot(options?: { includeCustomContext?: boolean }): ActiveModeSnapshot | null {
        const state = this.ensureValidState();
        const activeMode = state.userModes.find((mode) => mode.id === state.activeModeId);
        if (!activeMode) return null;

        const template = getBuiltInModeTemplate(activeMode.templateId);
        const notesTemplate = activeMode.notesTemplate.map((section) => ({
            title: section.title,
            description: section.description,
        }));

        return deepFreezeSnapshot({
            activeModeId: activeMode.id,
            templateType: activeMode.templateId,
            renderedModeContext: this.buildActiveModeContextBlock(options),
            notesTemplate,
            modeMetadata: {
                id: activeMode.id,
                name: activeMode.name,
                intelligenceType: template.intelligenceType,
                createdAt: activeMode.createdAt,
                updatedAt: activeMode.updatedAt,
            },
        });
    }

}
