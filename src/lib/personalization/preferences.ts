import type { UiProviderId } from '../providers/providerModelMetadata';

export const PERSONALIZATION_VERSION = 1;

export type PreferredCodingLanguage =
    | 'javascript'
    | 'typescript'
    | 'python'
    | 'java'
    | 'cpp'
    | 'go';

export type PreferredProvider = Exclude<UiProviderId, 'unknown'> | 'auto';
export type ResponseStylePreference = 'concise' | 'balanced' | 'detailed';
export type InterviewFocusPreference = 'coding' | 'system_design' | 'behavioral' | 'mixed';

export interface PersonalizationPreferences {
    personalizationVersion: number;
    preferredCodingLanguage: PreferredCodingLanguage | null;
    preferredProvider: PreferredProvider;
    responseStyle: ResponseStylePreference;
    interviewFocus: InterviewFocusPreference;
}

export interface ResolvedPersonalizationSnapshot {
    personalizationVersion: number;
    resolvedCodingLanguage?: string;
    providerPreference?: PreferredProvider;
    responseStyle: ResponseStylePreference;
    interviewFocus: InterviewFocusPreference;
    /** The interview focus value that was applied to prompt/classification. */
    interviewFocusApplied?: InterviewFocusPreference;
    /** Whether the interview focus bias actually influenced classification or prompts. */
    focusBiasApplied?: boolean;
}

export const DEFAULT_PERSONALIZATION_PREFERENCES: PersonalizationPreferences = {
    personalizationVersion: PERSONALIZATION_VERSION,
    preferredCodingLanguage: null,
    preferredProvider: 'auto',
    responseStyle: 'balanced',
    interviewFocus: 'mixed',
};

export const SUPPORTED_CODING_LANGUAGES: Record<PreferredCodingLanguage, { label: string; fence: string }> = {
    javascript: { label: 'JavaScript', fence: 'javascript' },
    typescript: { label: 'TypeScript', fence: 'typescript' },
    python: { label: 'Python', fence: 'python' },
    java: { label: 'Java', fence: 'java' },
    cpp: { label: 'C++', fence: 'cpp' },
    go: { label: 'Go', fence: 'go' },
};

const CODING_LANGUAGE_ALIASES: Record<string, PreferredCodingLanguage> = {
    javascript: 'javascript',
    'java script': 'javascript',
    js: 'javascript',
    node: 'javascript',
    nodejs: 'javascript',
    'node.js': 'javascript',
    typescript: 'typescript',
    'type script': 'typescript',
    ts: 'typescript',
    python: 'python',
    python3: 'python',
    py: 'python',
    java: 'java',
    'c++': 'cpp',
    cpp: 'cpp',
    go: 'go',
    golang: 'go',
};

const PROVIDERS = new Set<PreferredProvider>([
    'auto',
    'teamsync',
    'gemini',
    'groq',
    'openai',
    'claude',
    'bedrock',
    'custom',
    'ollama',
]);

const RESPONSE_STYLES = new Set<ResponseStylePreference>(['concise', 'balanced', 'detailed']);
const INTERVIEW_FOCUS = new Set<InterviewFocusPreference>(['coding', 'system_design', 'behavioral', 'mixed']);

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizePreferredCodingLanguage(value: unknown): PreferredCodingLanguage | null {
    const raw = readString(value);
    if (!raw || raw.toLowerCase() === 'auto' || raw.toLowerCase() === 'default') return null;
    return CODING_LANGUAGE_ALIASES[raw.toLowerCase()] ?? null;
}

export function formatPreferredCodingLanguage(language: PreferredCodingLanguage | null): string | null {
    return language ? SUPPORTED_CODING_LANGUAGES[language].label : null;
}

export function normalizePreferredProvider(value: unknown): PreferredProvider {
    const raw = readString(value)?.toLowerCase();
    if (!raw) return DEFAULT_PERSONALIZATION_PREFERENCES.preferredProvider;
    if (raw === 'aws' || raw === 'amazon' || raw === 'amazon-bedrock') return 'bedrock';
    if (raw === 'local') return 'ollama';
    return PROVIDERS.has(raw as PreferredProvider)
        ? raw as PreferredProvider
        : DEFAULT_PERSONALIZATION_PREFERENCES.preferredProvider;
}

export function normalizeResponseStyle(value: unknown): ResponseStylePreference {
    const raw = readString(value)?.toLowerCase();
    return RESPONSE_STYLES.has(raw as ResponseStylePreference)
        ? raw as ResponseStylePreference
        : DEFAULT_PERSONALIZATION_PREFERENCES.responseStyle;
}

export function normalizeInterviewFocus(value: unknown): InterviewFocusPreference {
    const raw = readString(value)?.toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_');
    if (raw === 'systemdesign') return 'system_design';
    return INTERVIEW_FOCUS.has(raw as InterviewFocusPreference)
        ? raw as InterviewFocusPreference
        : DEFAULT_PERSONALIZATION_PREFERENCES.interviewFocus;
}

export function normalizePersonalizationPreferences(value: unknown): PersonalizationPreferences {
    const input = typeof value === 'object' && value !== null
        ? value as Partial<Record<keyof PersonalizationPreferences, unknown>>
        : {};

    return {
        personalizationVersion: PERSONALIZATION_VERSION,
        preferredCodingLanguage: normalizePreferredCodingLanguage(input.preferredCodingLanguage),
        preferredProvider: normalizePreferredProvider(input.preferredProvider),
        responseStyle: normalizeResponseStyle(input.responseStyle),
        interviewFocus: normalizeInterviewFocus(input.interviewFocus),
    };
}

export function mergePersonalizationPreferences(
    current: unknown,
    patch: unknown,
): PersonalizationPreferences {
    const base = normalizePersonalizationPreferences(current);
    const input = typeof patch === 'object' && patch !== null
        ? patch as Partial<Record<keyof PersonalizationPreferences, unknown>>
        : {};

    return normalizePersonalizationPreferences({
        ...base,
        ...input,
        preferredCodingLanguage: Object.prototype.hasOwnProperty.call(input, 'preferredCodingLanguage')
            ? normalizePreferredCodingLanguage(input.preferredCodingLanguage)
            : base.preferredCodingLanguage,
    });
}
