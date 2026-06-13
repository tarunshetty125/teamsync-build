import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import {
    mergePersonalizationPreferences,
    normalizePersonalizationPreferences,
    type PersonalizationPreferences,
} from '../../src/lib/personalization/preferences';

export interface AppSettings {
    // Only boot-critical or non-encrypted settings should live here.
    // In the future, other non-secret data like 'language' or 'theme'
    // can be moved here from CredentialsManager to allow early boot access.
    isUndetectable?: boolean;
    disguiseMode?: 'terminal' | 'settings' | 'activity' | 'none';
    verboseLogging?: boolean;
    actionButtonMode?: 'recap' | 'brainstorm';
    groqFastTextMode?: boolean;
    knowledgeMode?: boolean;
    personalization?: Partial<PersonalizationPreferences>;
    /** Overlay glass opacity (0.2 – 1.0). Persisted so it survives restarts. */
    overlayOpacity?: number;
    /** Whether overlay mouse passthrough is enabled. Persisted so it survives restarts. */
    overlayMousePassthrough?: boolean;
    /** Whether custom notes injection is enabled. Persisted so it survives restarts. */
    customNotesEnabled?: boolean;
    /** Whether the pro V2 overlay layout is active. Persisted so it survives restarts. */
    overlayV2Layout?: boolean;
    /** One-shot flag: true after .env keys have been imported into the Groq vault */
    groqVaultMigrated?: boolean;
    advancedStealth?: {
        level?: 'off' | 'basic' | 'advanced';
        processName?: string;
        scrubEnvironment?: boolean;
        blockAppleEvents?: boolean;
        suppressCrashReporter?: boolean;
        watchdogIntervalMs?: number;
        hideFromScreenCapture?: boolean;
        excludeFromMissionControl?: boolean;
    };
    advancedStealthRuntime?: {
        engaged?: boolean;
        pid?: number;
        platform?: NodeJS.Platform;
        updatedAt?: number;
    };
}

export type FirstSuccessActionId =
    | 'upload_resume_jd'
    | 'connect_calendar'
    | 'open_technical_interview_mode'
    | 'open_coding_mode'
    | 'start_first_session';

export interface OnboardingV2State {
    tourComplete: boolean;
    firstSuccess: {
        completed: boolean;
        action: FirstSuccessActionId | null;
        completedAt: string | null;
    };
}

export type OnboardingV2StatePatch = Partial<{
    tourComplete: boolean;
    firstSuccess: Partial<OnboardingV2State['firstSuccess']>;
}>;

const FIRST_SUCCESS_ACTIONS = new Set<FirstSuccessActionId>([
    'upload_resume_jd',
    'connect_calendar',
    'open_technical_interview_mode',
    'open_coding_mode',
    'start_first_session',
]);

const ONBOARDING_V2_KEY_PREFIX = 'teamsync_onboarding_v2:';

function createDefaultOnboardingV2State(): OnboardingV2State {
    return {
        tourComplete: false,
        firstSuccess: {
            completed: false,
            action: null,
            completedAt: null,
        },
    };
}

function normalizeOnboardingEmail(email: unknown): string {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function getOnboardingV2Key(email: unknown): string {
    const normalizedEmail = normalizeOnboardingEmail(email);
    if (!normalizedEmail) {
        throw new Error('A valid email is required for onboarding V2 state');
    }
    return `${ONBOARDING_V2_KEY_PREFIX}${normalizedEmail}`;
}

function sanitizeOnboardingV2State(input: unknown): OnboardingV2State {
    const fallback = createDefaultOnboardingV2State();
    if (!input || typeof input !== 'object') return fallback;

    const record = input as Record<string, unknown>;
    const firstSuccess = record.firstSuccess && typeof record.firstSuccess === 'object'
        ? record.firstSuccess as Record<string, unknown>
        : {};
    const action = typeof firstSuccess.action === 'string' && FIRST_SUCCESS_ACTIONS.has(firstSuccess.action as FirstSuccessActionId)
        ? firstSuccess.action as FirstSuccessActionId
        : null;
    const completedAt = typeof firstSuccess.completedAt === 'string' && firstSuccess.completedAt.trim()
        ? firstSuccess.completedAt.trim()
        : null;

    return {
        tourComplete: record.tourComplete === true,
        firstSuccess: {
            completed: firstSuccess.completed === true,
            action,
            completedAt,
        },
    };
}

function sanitizeOnboardingV2Patch(patch: unknown): OnboardingV2StatePatch {
    if (!patch || typeof patch !== 'object') return {};
    const record = patch as Record<string, unknown>;
    const next: OnboardingV2StatePatch = {};

    if (typeof record.tourComplete === 'boolean') {
        next.tourComplete = record.tourComplete;
    }

    if (record.firstSuccess && typeof record.firstSuccess === 'object') {
        const firstSuccessPatch = record.firstSuccess as Record<string, unknown>;
        next.firstSuccess = {};
        if (typeof firstSuccessPatch.completed === 'boolean') {
            next.firstSuccess.completed = firstSuccessPatch.completed;
        }
        if (firstSuccessPatch.action === null) {
            next.firstSuccess.action = null;
        } else if (
            typeof firstSuccessPatch.action === 'string' &&
            FIRST_SUCCESS_ACTIONS.has(firstSuccessPatch.action as FirstSuccessActionId)
        ) {
            next.firstSuccess.action = firstSuccessPatch.action as FirstSuccessActionId;
        }
        if (firstSuccessPatch.completedAt === null) {
            next.firstSuccess.completedAt = null;
        } else if (typeof firstSuccessPatch.completedAt === 'string') {
            next.firstSuccess.completedAt = firstSuccessPatch.completedAt.trim() || null;
        }
    }

    return next;
}

export class SettingsManager {
    private static instance: SettingsManager;
    private settings: AppSettings = {};
    private settingsPath: string;

    private constructor() {
        if (!app.isReady()) {
            throw new Error('[SettingsManager] Cannot initialize before app.whenReady()');
        }
        this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
        this.loadSettings();
    }

    public static getInstance(): SettingsManager {
        if (!SettingsManager.instance) {
            SettingsManager.instance = new SettingsManager();
        }
        return SettingsManager.instance;
    }

    public get<K extends keyof AppSettings>(key: K): AppSettings[K] {
        return this.settings[key];
    }

    public set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
        this.settings[key] = value;
        this.saveSettings();
    }

    public unset<K extends keyof AppSettings>(key: K): void {
        if (key in this.settings) {
            delete this.settings[key];
            this.saveSettings();
        }
    }

    public clearProfileSettings(): void {
        let changed = false;
        if ('knowledgeMode' in this.settings) {
            delete this.settings.knowledgeMode;
            changed = true;
        }
        if (changed) {
            this.saveSettings();
        }
    }

    public getPersonalizationPreferences(): PersonalizationPreferences {
        return normalizePersonalizationPreferences(this.settings.personalization);
    }

    public setPersonalizationPreferences(patch: Partial<PersonalizationPreferences>): PersonalizationPreferences {
        const next = mergePersonalizationPreferences(this.settings.personalization, patch);
        this.settings.personalization = next;
        this.saveSettings();
        return next;
    }

    public getOnboardingV2State(email: string): OnboardingV2State {
        const key = getOnboardingV2Key(email);
        const raw = (this.settings as Record<string, unknown>)[key];
        return sanitizeOnboardingV2State(raw);
    }

    public updateOnboardingV2State(email: string, patch: unknown): OnboardingV2State {
        const key = getOnboardingV2Key(email);
        const current = this.getOnboardingV2State(email);
        const cleanPatch = sanitizeOnboardingV2Patch(patch);
        const next: OnboardingV2State = {
            ...current,
            ...(typeof cleanPatch.tourComplete === 'boolean' ? { tourComplete: cleanPatch.tourComplete } : {}),
            firstSuccess: {
                ...current.firstSuccess,
                ...(cleanPatch.firstSuccess ?? {}),
            },
        };
        (this.settings as Record<string, unknown>)[key] = next;
        this.saveSettings();
        return next;
    }

    private loadSettings(): void {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const data = fs.readFileSync(this.settingsPath, 'utf8');
                try {
                    const parsed = JSON.parse(data);
                    // Minimal validation to ensure it's an object before assigning
                    if (typeof parsed === 'object' && parsed !== null) {
                        this.settings = parsed;
                        console.log('[SettingsManager] Settings loaded successfully:', JSON.stringify(this.settings));
                    } else {
                        throw new Error('Settings JSON is not a valid object');
                    }
                } catch (parseError) {
                    console.error('[SettingsManager] Failed to parse settings.json. Continuing with empty settings. Error:', parseError);
                    this.settings = {};
                }
                console.log('[SettingsManager] Settings loaded');
            }
        } catch (e) {
            console.error('[SettingsManager] Failed to read settings file:', e);
            this.settings = {};
        }
    }

    private saveSettings(): void {
        try {
            const tmpPath = this.settingsPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(this.settings, null, 2));
            fs.renameSync(tmpPath, this.settingsPath);
        } catch (e) {
            console.error('[SettingsManager] Failed to save settings:', e);
        }
    }
}
