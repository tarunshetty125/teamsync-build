import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Edit2, AlertCircle, CheckCircle, Save, ChevronDown, Check, RefreshCw, ExternalLink, Loader2 } from 'lucide-react';
import { STANDARD_CLOUD_MODELS, prettifyModelId } from '../../utils/modelUtils';
import { validateCurl } from '../../lib/curl-validator';
import { buildProviderHealthReadModel } from '../../lib/providers/providerHealthReadModel';
import { buildProviderDiagnosticsReadModel } from '../../lib/providers/providerDiagnosticsReadModel';
import { buildProviderRoutingReadModel } from '../../lib/providers/providerRoutingReadModel';
import { buildProviderFallbackReadModel } from '../../lib/providers/providerFallbackReadModel';
import { buildProviderTelemetryReadModel } from '../../lib/providers/providerTelemetryReadModel';
import { buildProviderPersonalizationReadModel } from '../../lib/providers/providerPersonalizationReadModel';
import { ProviderCard } from './ProviderCard';
import { GroqKeyVault } from './GroqKeyVault';
import { ProviderHealthStatusSurface } from './ProviderHealthStatusSurface';
import { ProviderDiagnosticsSurface } from './ProviderDiagnosticsSurface';
import { ProviderRoutingTransparencySurface } from './ProviderRoutingTransparencySurface';
import { ProviderFallbackAnalyticsSurface } from './ProviderFallbackAnalyticsSurface';
import { ProviderTelemetrySurface } from './ProviderTelemetrySurface';
import { ProviderPersonalizationImpactSurface } from './ProviderPersonalizationImpactSurface';
import { ProviderResponseDrilldownSurface } from './ProviderResponseDrilldownSurface';

interface CustomProvider {
    id: string;
    name: string;
    curlCommand: string;
    responsePath: string;
}

interface ModelOption {
    id: string;
    name: string;
    provider?: string;
}

type BedrockAuthMode = 'aws_cli' | 'access_keys';

interface BedrockCredentials {
    authMode: BedrockAuthMode;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    profileName?: string;
    region: string;
    preferredModel?: string;
}

interface BedrockFetchedModel {
    id: string;
    label: string;
    inputModalities?: string[];
}

interface ModelSelectProps {
    value: string;
    options: ModelOption[];
    onChange: (value: string) => void;
    placeholder?: string;
}

const ModelSelect: React.FC<ModelSelectProps> = ({ value, options, onChange, placeholder = "Select model" }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedOption = options.find(o => o.id === value);
    const showProviderSections = options.some(option => option.provider);
    const providerLabels: Record<string, string> = {
        teamsync: 'TeamSync',
        gemini: 'Gemini',
        groq: 'Groq',
        openai: 'OpenAI',
        claude: 'Claude',
        bedrock: 'Amazon Bedrock',
        custom: 'Custom Providers',
        ollama: 'Ollama / Local',
    };
    const providerAccents: Record<string, { dot: string; header: string; rule: string }> = {
        teamsync: { dot: 'bg-cyan-400', header: 'text-cyan-300', rule: 'bg-cyan-400/30' },
        gemini: { dot: 'bg-sky-400', header: 'text-sky-300', rule: 'bg-sky-400/30' },
        groq: { dot: 'bg-amber-400', header: 'text-amber-300', rule: 'bg-amber-400/30' },
        openai: { dot: 'bg-emerald-400', header: 'text-emerald-300', rule: 'bg-emerald-400/30' },
        claude: { dot: 'bg-orange-300', header: 'text-orange-200', rule: 'bg-orange-300/30' },
        bedrock: { dot: 'bg-rose-400', header: 'text-rose-300', rule: 'bg-rose-400/30' },
        custom: { dot: 'bg-violet-400', header: 'text-violet-300', rule: 'bg-violet-400/30' },
        ollama: { dot: 'bg-lime-400', header: 'text-lime-300', rule: 'bg-lime-400/30' },
    };
    let lastProvider = '';

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-72 max-w-[52vw] bg-bg-input border border-border-subtle rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary flex items-center justify-between hover:bg-bg-elevated transition-colors"
                type="button"
                title={selectedOption ? selectedOption.name : placeholder}
            >
                <span className="truncate pr-2">{selectedOption ? selectedOption.name : placeholder}</span>
                <ChevronDown size={14} className={`text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full right-0 mt-1 w-[min(560px,80vw)] bg-bg-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-72 overflow-y-auto animated fadeIn">
                    <div className="p-1 space-y-0.5">
                        {options.map((option) => {
                            const provider = option.provider || '';
                            const shouldRenderHeader = showProviderSections && provider && provider !== lastProvider;
                            if (shouldRenderHeader) lastProvider = provider;
                            return (
                                <React.Fragment key={option.id}>
                                    {shouldRenderHeader && (
                                        <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                                            <span className={`h-px w-4 ${providerAccents[provider]?.rule || 'bg-border-subtle'}`} />
                                            <span className={`text-[10px] font-semibold uppercase tracking-wide ${providerAccents[provider]?.header || 'text-text-tertiary'}`}>
                                                {providerLabels[provider] || provider}
                                            </span>
                                        </div>
                                    )}
                                    <button
                                        onClick={() => {
                                            onChange(option.id);
                                            setIsOpen(false);
                                        }}
                                        className={`w-full text-left px-3 py-2 text-xs rounded-md flex items-center justify-between group transition-colors ${value === option.id ? 'bg-bg-input hover:bg-bg-elevated text-text-primary' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                        type="button"
                                        title={option.name}
                                    >
                                        <span className="flex min-w-0 items-start gap-2 whitespace-normal break-words leading-snug pr-2">
                                            {provider && <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${providerAccents[provider]?.dot || 'bg-text-tertiary'}`} />}
                                            <span className="min-w-0 flex-1">{option.name}</span>
                                        </span>
                                        {value === option.id && <Check size={14} className="text-accent-primary shrink-0 ml-2" />}
                                    </button>
                                </React.Fragment>
                            );
                        })}
                        {options.length === 0 && (
                            <div className="px-3 py-2 text-xs text-gray-500 italic">No models available</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const BEDROCK_VISION_WARNING = 'Image analysis needs a Bedrock multimodal model. Enable Claude Sonnet or Amazon Nova Pro/Lite model access in AWS Bedrock for this region. Text-only Bedrock models will still work.';

function isBedrockVisionCandidate(model: BedrockFetchedModel): boolean {
    const normalized = model.id.toLowerCase().replace(/^bedrock:/, '').replace(/\//g, '.').replace(/^(us|eu|apac)\./, '');
    const isPreferredVisionFamily =
        (normalized.includes('anthropic.claude') && normalized.includes('sonnet')) ||
        normalized.includes('amazon.nova-pro') ||
        normalized.includes('amazon.nova-lite');
    if (!isPreferredVisionFamily) return false;
    if (!model.inputModalities?.length) return true;
    return model.inputModalities.some(modality => modality.toUpperCase() === 'IMAGE');
}

function getBedrockVisionWarning(models?: BedrockFetchedModel[]): string {
    if (!models?.length) return '';
    return models.some(isBedrockVisionCandidate) ? '' : BEDROCK_VISION_WARNING;
}

export const AIProvidersSettings: React.FC = () => {
    // --- Standard Providers ---
    const [apiKey, setApiKey] = useState('');
    const [groqApiKey, setGroqApiKey] = useState('');
    const [openaiApiKey, setOpenaiApiKey] = useState('');
    const [claudeApiKey, setClaudeApiKey] = useState('');
    const [bedrockCredentials, setBedrockCredentials] = useState<BedrockCredentials>({
        authMode: 'aws_cli',
        region: 'us-east-1',
    });

    // Status
    const [savedStatus, setSavedStatus] = useState<Record<string, boolean>>({});
    const [savingStatus, setSavingStatus] = useState<Record<string, boolean>>({});
    const [hasStoredKey, setHasStoredKey] = useState<Record<string, boolean>>({});
    const [bedrockVisionWarning, setBedrockVisionWarning] = useState('');
    // Fast mode is available with a local Groq key OR via the TeamSync API (server-side Groq pool)
    const canUseFastMode = !!(hasStoredKey.groq || hasStoredKey.teamsync);
    const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
    const [testError, setTestError] = useState<Record<string, string>>({});

    // --- Custom Providers ---
    const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
    const [isEditingCustom, setIsEditingCustom] = useState(false);
    const [editingProvider, setEditingProvider] = useState<CustomProvider | null>(null);
    const [customName, setCustomName] = useState('');
    const [customCurl, setCustomCurl] = useState('');
    const [customResponsePath, setCustomResponsePath] = useState('');
    const [curlError, setCurlError] = useState<string | null>(null);

    // --- Local (Ollama) ---
    const [ollamaModels, setOllamaModels] = useState<string[]>([]);
    const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'detected' | 'not-found' | 'fixing'>('checking');
    const [ollamaRestarted, setOllamaRestarted] = useState(false);
    const [isRefreshingOllama, setIsRefreshingOllama] = useState(false);

    // --- Default Model ---
    const [defaultModel, setDefaultModel] = useState<string>('gemini-3.1-flash-lite-preview');
    const [fastResponseMode, setFastResponseMode] = useState(false);
    const [credentialsLoaded, setCredentialsLoaded] = useState(false);

    // --- Dynamic Model Discovery ---
    const [preferredModels, setPreferredModels] = useState<Record<string, string>>({});
    const [dynamicModels, setDynamicModels] = useState<Record<string, { id: string, name: string }[]>>({});
    const providerHealthReadModel = useMemo(() => {
        const connectionSignal = (provider: 'gemini' | 'openai' | 'claude' | 'bedrock') => {
            if (testStatus[provider] === 'success') {
                return {
                    success: true,
                    source: provider === 'bedrock' ? 'test-bedrock-connection' : 'test-llm-connection',
                };
            }

            if (testStatus[provider] === 'error') {
                return {
                    success: false,
                    error: testError[provider] || 'Connection failed',
                    source: provider === 'bedrock' ? 'test-bedrock-connection' : 'test-llm-connection',
                };
            }

            return undefined;
        };

        return buildProviderHealthReadModel({
            credentials: {
                hasBedrockCredentials: !!hasStoredKey.bedrock,
                hasGroqKey: !!hasStoredKey.groq,
                hasGeminiKey: !!hasStoredKey.gemini,
                hasOpenaiKey: !!hasStoredKey.openai,
                hasClaudeKey: !!hasStoredKey.claude,
            },
            connectionTests: {
                bedrock: connectionSignal('bedrock'),
                gemini: connectionSignal('gemini'),
                openai: connectionSignal('openai'),
                claude: connectionSignal('claude'),
            },
            modelFetches: {
                bedrock: dynamicModels.bedrock ? { modelCount: dynamicModels.bedrock.length, source: 'fetch-bedrock-models' } : undefined,
                groq: dynamicModels.groq ? { modelCount: dynamicModels.groq.length, source: 'groq-vault:get-models' } : undefined,
                gemini: dynamicModels.gemini ? { modelCount: dynamicModels.gemini.length, source: 'fetch-provider-models' } : undefined,
                openai: dynamicModels.openai ? { modelCount: dynamicModels.openai.length, source: 'fetch-provider-models' } : undefined,
                claude: dynamicModels.claude ? { modelCount: dynamicModels.claude.length, source: 'fetch-provider-models' } : undefined,
            },
            ollama: {
                configured: ollamaStatus !== 'not-found' || ollamaModels.length > 0,
                reachable: ollamaStatus === 'detected',
                status: ollamaStatus,
                models: ollamaModels,
            },
        });
    }, [dynamicModels, hasStoredKey, ollamaModels, ollamaStatus, testError, testStatus]);
    const providerDiagnosticsReadModel = useMemo(
        () => buildProviderDiagnosticsReadModel({ health: providerHealthReadModel }),
        [providerHealthReadModel],
    );
    const providerRoutingReadModel = useMemo(
        () => buildProviderRoutingReadModel({ responses: [] }),
        [],
    );
    const providerFallbackReadModel = useMemo(
        () => buildProviderFallbackReadModel({ responses: [] }),
        [],
    );
    const providerTelemetryReadModel = useMemo(
        () => buildProviderTelemetryReadModel({ responses: [] }),
        [],
    );
    const providerPersonalizationReadModel = useMemo(
        () => buildProviderPersonalizationReadModel({ responses: [] }),
        [],
    );

    // Load Initial Data
    useEffect(() => {
        const loadCredentials = async () => {
            try {
                // Load credentials FIRST so canUseFastMode is correct before we set fastResponseMode.
                // If we set fastResponseMode before hasStoredKey is populated, the enforcement
                // effect below fires with canUseFastMode=false and immediately resets fast mode
                // to false — writing that reset back to SettingsManager on every startup.
                // @ts-ignore
                const creds = await window.electronAPI?.getStoredCredentials?.();
                if (creds) {
                    setHasStoredKey({
                        gemini: creds.hasGeminiKey,
                        groq: creds.hasGroqKey,
                        openai: creds.hasOpenaiKey,
                        claude: creds.hasClaudeKey,
                        bedrock: creds.hasBedrockCredentials || false,
                        teamsync: creds.hasTeamSyncKey || false
                    });
                    // Load preferred models
                    const pm: Record<string, string> = {};
                    if (creds.geminiPreferredModel) pm.gemini = creds.geminiPreferredModel;
                    if (creds.groqPreferredModel) pm.groq = creds.groqPreferredModel;
                    if (creds.openaiPreferredModel) pm.openai = creds.openaiPreferredModel;
                    if (creds.claudePreferredModel) pm.claude = creds.claudePreferredModel;
                    if (creds.bedrockPreferredModel) pm.bedrock = creds.bedrockPreferredModel;
                    setPreferredModels(pm);

                    if (creds.bedrockCredentials) {
                        setBedrockCredentials({
                            authMode: creds.bedrockCredentials.authMode || 'aws_cli',
                            region: creds.bedrockCredentials.region || 'us-east-1',
                            accessKeyId: creds.bedrockCredentials.accessKeyId || '',
                            secretAccessKey: creds.bedrockCredentials.secretAccessKey || '',
                            sessionToken: creds.bedrockCredentials.sessionToken || '',
                            profileName: creds.bedrockCredentials.profileName || '',
                            preferredModel: creds.bedrockCredentials.preferredModel || creds.bedrockPreferredModel || '',
                        });
                    }

                    // Pre-populate Groq dynamic models from persisted catalog (no API call needed)
                    const groqModels = creds.groqFetchedModels;
                    if (groqModels && groqModels.length > 0) {
                        const providerModels = groqModels.map((m: any) => ({
                            id: m.id,
                            name: `Groq ${prettifyModelId(m.label || m.id)}`
                        }));
                        setDynamicModels(prev => ({ ...prev, groq: providerModels }));
                    }

                    const bedrockModels = creds.bedrockFetchedModels;
                    if (bedrockModels && bedrockModels.length > 0) {
                        setBedrockVisionWarning(getBedrockVisionWarning(bedrockModels));
                        setDynamicModels(prev => ({
                            ...prev,
                            bedrock: bedrockModels.map((m: any) => ({
                                id: m.id,
                                name: `Bedrock ${prettifyModelId(m.label || m.id)}`
                            }))
                        }));
                    }
                }

                // Now it's safe to read fast mode — hasStoredKey is already set so
                // canUseFastMode will be correct when the enforcement effect runs.
                // @ts-ignore
                const fastMode = await window.electronAPI?.getGroqFastTextMode();
                if (fastMode) setFastResponseMode(fastMode.enabled);

                // Mark credentials as fully loaded so the enforcement effect can fire
                setCredentialsLoaded(true);

                // @ts-ignore
                const custom = await window.electronAPI?.getCustomProviders();
                if (custom) {
                    setCustomProviders(custom);
                }

                // Load persisted default model
                // @ts-ignore
                const result = await window.electronAPI?.getDefaultModel();
                if (result && result.model) {
                    setDefaultModel(result.model);
                }

                // Check Ollama
                checkOllama();

            } catch (e) {
                console.error("Failed to load settings:", e);
                setCredentialsLoaded(true); // Unblock even on error
            }
        };
        loadCredentials();

        // Listen for changes from other windows (2-way sync)
        if (window.electronAPI?.onGroqFastTextChanged) {
            // @ts-ignore
            const unsubscribe = window.electronAPI.onGroqFastTextChanged((enabled: boolean) => {
                setFastResponseMode(enabled);
                localStorage.setItem('teamsync_groq_fast_text', String(enabled));
            });
            return () => unsubscribe();
        }
    }, []);

    // Effect to enforce fast mode disabled if neither Groq key nor TeamSync API is configured.
    // Guard with credentialsLoaded so this never fires during the initial async load phase
    // (when hasStoredKey is still empty and canUseFastMode is incorrectly false).
    useEffect(() => {
        if (!credentialsLoaded) return;
        if (!canUseFastMode && fastResponseMode) {
            setFastResponseMode(false);
            localStorage.setItem('teamsync_groq_fast_text', 'false');
            // @ts-ignore
            window.electronAPI?.setGroqFastTextMode(false);
        }
    }, [credentialsLoaded, canUseFastMode, fastResponseMode]);

    // Fetch dynamic models for providers that have stored keys
    useEffect(() => {
        if (!credentialsLoaded) return;
        
        const providers: ('gemini' | 'openai' | 'claude')[] = ['gemini', 'openai', 'claude'];
        
        providers.forEach(async (prov) => {
            if (hasStoredKey[prov] && !dynamicModels[prov]) {
                try {
                    // @ts-ignore
                    const result = await window.electronAPI?.fetchProviderModels(prov, '');
                    if (result?.success && result.models) {
                        const providerName = prov === 'openai' ? 'OpenAI' : prov === 'claude' ? 'Claude' : 'Gemini';
                        setDynamicModels(prev => ({
                            ...prev,
                            [prov]: result.models!.map((m: any) => ({
                                id: m.id,
                                name: `${providerName} ${prettifyModelId(m.label || m.id)}`
                            }))
                        }));
                    }
                } catch (e) {
                    console.error(`Failed to fetch models for ${prov}:`, e);
                }
            }
        });

        if (hasStoredKey.bedrock && !dynamicModels.bedrock) {
            window.electronAPI?.fetchBedrockModels?.()
                .then((result) => {
                    if (result?.success && result.models) {
                        setBedrockVisionWarning(getBedrockVisionWarning(result.models));
                        setDynamicModels(prev => ({
                            ...prev,
                            bedrock: result.models!.map((m: any) => ({
                                id: m.id,
                                name: `Bedrock ${prettifyModelId(m.label || m.id)}`
                            }))
                        }));
                    }
                })
                .catch((e) => console.error('Failed to fetch Bedrock models:', e));
        }
    }, [hasStoredKey, credentialsLoaded]);

    // Poll for Ollama status every 3 seconds requesting smart start on mount
    useEffect(() => {
        // Immediate "Smart Start" check
        ensureOllamaStartup();

        // Background polling for maintenance
        const interval = setInterval(() => {
            checkOllama(false);
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    const ensureOllamaStartup = async () => {
        setOllamaStatus('checking');
        try {
            // @ts-ignore
            const result = await window.electronAPI?.invoke?.('ensure-ollama-running');
            if (result && result.success) {
                // It's running (or just started), now fetch models
                checkOllama(true);
            } else {
                setOllamaStatus('not-found');
            }
        } catch (e) {
            console.warn("Ollama ensure startup failed:", e);
            setOllamaStatus('not-found');
        }
    };

    const checkOllama = async (_isInitial = true) => {
        // Don't override 'checking' if we are already in smart-start mode
        // if (isInitial) setOllamaStatus('checking'); 

        try {
            // @ts-ignore
            const models = await window.electronAPI?.getAvailableOllamaModels?.();
            if (models && models.length > 0) {
                setOllamaModels(models);
                setOllamaStatus('detected');
            } else {
                // Silent failure on background checks
                // Only set not-found if we haven't detected it yet
                if (ollamaStatus !== 'detected') {
                    setOllamaStatus('not-found');
                }
            }
        } catch (e) {
            // console.warn(`Ollama check failed:`, e);
            if (ollamaStatus !== 'detected') {
                setOllamaStatus('not-found');
            }
        }
    };

    const handleFixOllama = async () => {
        setOllamaStatus('fixing');
        try {
            // @ts-ignore
            const result = await window.electronAPI?.invoke?.('force-restart-ollama');
            if (result && result.success) {
                setOllamaRestarted(true);
                // Wait for server to be ready
                setTimeout(() => checkOllama(false), 2000);
            } else {
                setOllamaStatus('not-found');
            }
        } catch (e) {
            console.error("Fix failed", e);
            setOllamaStatus('not-found');
        }
    };

    const handleSaveKey = async (provider: string, key: string, setter: (val: string) => void) => {
        if (!key.trim()) return;
        setSavingStatus(prev => ({ ...prev, [provider]: true }));
        try {
            let result;
            // @ts-ignore
            if (provider === 'gemini') result = await window.electronAPI.setGeminiApiKey(key);
            // @ts-ignore
            if (provider === 'groq') result = await window.electronAPI.setGroqApiKey(key);
            // @ts-ignore
            if (provider === 'openai') result = await window.electronAPI.setOpenaiApiKey(key);
            // @ts-ignore
            if (provider === 'claude') result = await window.electronAPI.setClaudeApiKey(key);

            if (result && result.success) {
                setSavedStatus(prev => ({ ...prev, [provider]: true }));
                setHasStoredKey(prev => ({ ...prev, [provider]: true }));
                setter('');
                setTimeout(() => setSavedStatus(prev => ({ ...prev, [provider]: false })), 2000);
            }
        } catch (e) {
            console.error(`Failed to save ${provider} key:`, e);
        } finally {
            setSavingStatus(prev => ({ ...prev, [provider]: false }));
        }
    };

    const handleRemoveKey = async (provider: string, setter: (val: string) => void) => {
        if (!confirm(`Are you sure you want to remove the ${provider} API key?`)) return;
        try {
            let result;
            // @ts-ignore
            if (provider === 'gemini') result = await window.electronAPI.setGeminiApiKey('');
            // @ts-ignore
            if (provider === 'groq') result = await window.electronAPI.setGroqApiKey('');
            // @ts-ignore
            if (provider === 'openai') result = await window.electronAPI.setOpenaiApiKey('');
            // @ts-ignore
            if (provider === 'claude') result = await window.electronAPI.setClaudeApiKey('');

            if (result && result.success) {
                setHasStoredKey(prev => ({ ...prev, [provider]: false }));
                setter('');
            }
        } catch (e) {
            console.error(`Failed to remove ${provider} key:`, e);
        }
    };

    const handleTestConnection = async (provider: string, key: string) => {
        // Allow testing if key is provided OR if we have a stored key
        if (!key.trim() && !hasStoredKey[provider]) {
            return;
        }
        setTestStatus(prev => ({ ...prev, [provider]: 'testing' }));
        setTestError(prev => ({ ...prev, [provider]: '' }));

        try {
            // @ts-ignore
            const result = await window.electronAPI.testLlmConnection(provider, key);
            if (result.success) {
                setTestStatus(prev => ({ ...prev, [provider]: 'success' }));
                setTimeout(() => setTestStatus(prev => ({ ...prev, [provider]: 'idle' })), 3000);
            } else {
                setTestStatus(prev => ({ ...prev, [provider]: 'error' }));
                setTestError(prev => ({ ...prev, [provider]: result.error || 'Connection failed' }));
            }
        } catch (e: any) {
            setTestStatus(prev => ({ ...prev, [provider]: 'error' }));
            setTestError(prev => ({ ...prev, [provider]: e.message || 'Connection failed' }));
        }
    };

    // ── Groq Vault Callbacks ────────────────────────────────────

    const handleGroqModelsFetched = (models: { id: string; name: string }[]) => {
        setDynamicModels(prev => ({
            ...prev,
            groq: models
        }));
    };

    const handleGroqModelsCleared = () => {
        setDynamicModels(prev => {
            const next = { ...prev };
            delete next.groq;
            return next;
        });
        // Clear persisted catalog so overlay/window no longer show stale Groq models
        // @ts-ignore
        window.electronAPI?.clearGroqFetchedModels?.();
    };

    const handleGroqPreferredModelChange = (modelId: string) => {
        setPreferredModels(prev => ({ ...prev, groq: modelId }));
    };

    const applyBedrockConnectionResult = async (result: { success: boolean; models?: BedrockFetchedModel[]; credentials?: BedrockCredentials; error?: string }) => {
        if (!result.success) {
            setTestStatus(prev => ({ ...prev, bedrock: 'error' }));
            setTestError(prev => ({ ...prev, bedrock: result.error || 'Connection failed' }));
            return;
        }

        const models = result.models || [];
        setBedrockVisionWarning(getBedrockVisionWarning(models));
        const selectedModel = result.credentials?.preferredModel || bedrockCredentials.preferredModel || models[0]?.id || '';
        setBedrockCredentials(prev => ({
            ...prev,
            ...(result.credentials || {}),
            preferredModel: selectedModel || result.credentials?.preferredModel || prev.preferredModel,
        }));
        setPreferredModels(prev => selectedModel ? ({ ...prev, bedrock: selectedModel }) : prev);
        setHasStoredKey(prev => ({ ...prev, bedrock: true }));
        setSavedStatus(prev => ({ ...prev, bedrock: true }));
        setTestStatus(prev => ({ ...prev, bedrock: 'success' }));
        setDynamicModels(prev => ({
            ...prev,
            bedrock: models.map((m) => ({
                id: m.id,
                name: `Bedrock ${prettifyModelId(m.label || m.id)}`
            }))
        }));
        if (selectedModel) {
            await window.electronAPI?.setProviderPreferredModel?.('bedrock', selectedModel);
        }
        setTimeout(() => setSavedStatus(prev => ({ ...prev, bedrock: false })), 2000);
        setTimeout(() => setTestStatus(prev => ({ ...prev, bedrock: 'idle' })), 3000);
    };

    const handleBedrockConnect = async () => {
        setTestStatus(prev => ({ ...prev, bedrock: 'testing' }));
        setSavingStatus(prev => ({ ...prev, bedrock: true }));
        setTestError(prev => ({ ...prev, bedrock: '' }));

        try {
            const result = await window.electronAPI?.testBedrockConnection?.(bedrockCredentials);
            if (result) await applyBedrockConnectionResult(result);
        } catch (e: any) {
            setTestStatus(prev => ({ ...prev, bedrock: 'error' }));
            setTestError(prev => ({ ...prev, bedrock: e.message || 'Connection failed' }));
        } finally {
            setSavingStatus(prev => ({ ...prev, bedrock: false }));
        }
    };

    const handleBedrockSave = async () => {
        setSavingStatus(prev => ({ ...prev, bedrock: true }));
        setTestError(prev => ({ ...prev, bedrock: '' }));

        try {
            const result = await window.electronAPI?.setBedrockCredentials?.(bedrockCredentials);
            if (result) await applyBedrockConnectionResult(result);
        } catch (e: any) {
            setTestStatus(prev => ({ ...prev, bedrock: 'error' }));
            setTestError(prev => ({ ...prev, bedrock: e.message || 'Failed to save credentials' }));
        } finally {
            setSavingStatus(prev => ({ ...prev, bedrock: false }));
        }
    };

    const handleBedrockFetchModels = async () => {
        setSavingStatus(prev => ({ ...prev, bedrockFetch: true }));
        setTestError(prev => ({ ...prev, bedrock: '' }));
        try {
            const result = await window.electronAPI?.fetchBedrockModels?.();
            if (result?.success && result.models) {
                setBedrockVisionWarning(getBedrockVisionWarning(result.models));
                setDynamicModels(prev => ({
                    ...prev,
                    bedrock: result.models!.map((m: any) => ({
                        id: m.id,
                        name: `Bedrock ${prettifyModelId(m.label || m.id)}`
                    }))
                }));
            } else {
                setTestError(prev => ({ ...prev, bedrock: result?.error || 'Failed to fetch models' }));
            }
        } catch (e: any) {
            setTestError(prev => ({ ...prev, bedrock: e.message || 'Failed to fetch models' }));
        } finally {
            setSavingStatus(prev => ({ ...prev, bedrockFetch: false }));
        }
    };

    const handleBedrockPreferredModelChange = async (modelId: string) => {
        setBedrockCredentials(prev => ({ ...prev, preferredModel: modelId }));
        setPreferredModels(prev => ({ ...prev, bedrock: modelId }));
        await window.electronAPI?.setProviderPreferredModel?.('bedrock', modelId);
    };

    const handleGroqVaultKeyCountChanged = (hasEnabledKeys: boolean) => {
        setHasStoredKey(prev => ({ ...prev, groq: hasEnabledKeys }));
        // If all Groq keys removed/disabled, reset active model if it was a Groq model
        if (!hasEnabledKeys) {
            // Use model-list lookup instead of fragile string prefixes —
            // avoids accidentally resetting OpenRouter/Bedrock llama models
            const groqModelIds = new Set([
                ...(dynamicModels.groq || []).map((m: any) => m.id),
                ...(STANDARD_CLOUD_MODELS.groq?.ids || [])
            ]);
            if (groqModelIds.has(defaultModel)) {
                const fallback = 'gemini-3.1-flash-lite-preview';
                setDefaultModel(fallback);
                // @ts-ignore
                window.electronAPI?.setDefaultModel(fallback).catch(console.error);
            }
        }
    };

    const openKeyUrl = (provider: string) => {
        const urls: Record<string, string> = {
            gemini: 'https://aistudio.google.com/app/apikey',
            groq: 'https://console.groq.com/keys',
            openai: 'https://platform.openai.com/api-keys',
            claude: 'https://console.anthropic.com/settings/keys'
        };
        // @ts-ignore
        window.electronAPI?.openExternal(urls[provider]);
    };


    // --- Custom Provider Handlers ---

    const handleEditProvider = (provider: CustomProvider) => {
        setEditingProvider(provider);
        setCustomName(provider.name);
        setCustomCurl(provider.curlCommand);
        setCustomResponsePath(provider.responsePath || '');
        setIsEditingCustom(true);
        setCurlError(null);
    };

    const handleNewProvider = () => {
        setEditingProvider(null);
        setCustomName('');
        setCustomCurl('');
        setCustomResponsePath('');
        setIsEditingCustom(true);
        setCurlError(null);
    };

    const handleSaveCustom = async () => {
        setCurlError(null);
        if (!customName.trim()) {
            setCurlError("Provider Name is required.");
            return;
        }

        const validation = validateCurl(customCurl);
        if (!validation.isValid) {
            setCurlError(validation.message || "Invalid cURL command.");
            return;
        }

        const newProvider: CustomProvider = {
            id: editingProvider ? editingProvider.id : crypto.randomUUID(),
            name: customName,
            curlCommand: customCurl,
            responsePath: customResponsePath
        };

        try {
            // @ts-ignore
            const result = await window.electronAPI.saveCustomProvider(newProvider);
            if (result.success) {
                // Refresh list
                // @ts-ignore
                const updated = await window.electronAPI.getCustomProviders();
                setCustomProviders(updated);
                setIsEditingCustom(false);
            } else {
                setCurlError(result.error ?? null);
            }
        } catch (e: any) {
            setCurlError(e.message);
        }
    };

    const handleDeleteCustom = async (id: string) => {
        if (!confirm("Are you sure you want to delete this provider?")) return;
        try {
            // @ts-ignore
            const result = await window.electronAPI.deleteCustomProvider(id);
            if (result.success) {
                // @ts-ignore
                const updated = await window.electronAPI.getCustomProviders();
                setCustomProviders(updated);
            }
        } catch (e) {
            console.error("Failed to delete provider:", e);
        }
    };

    return (
        <div className="space-y-5 animated fadeIn pb-10">
            {/* Default Model for Chat */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Default Model for Chat</h3>
                    <p className="text-xs text-text-secondary mb-2">Primary model for new chats. Other configured models act as fallbacks.</p>
                </div>

                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between">
                    <div>
                        <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">Active Model</label>
                        <p className="text-[10px] text-text-secondary">Applies to new chats instantly.</p>
                    </div>
                    <ModelSelect
                        value={defaultModel}
                        options={(() => {
                            const opts: ModelOption[] = [];

                            if (hasStoredKey.teamsync) {
                                opts.push({ id: 'teamsync', name: 'TeamSync API', provider: 'teamsync' });
                            }

                            for (const [prov, cfg] of Object.entries(STANDARD_CLOUD_MODELS)) {
                                if (!hasStoredKey[prov as keyof typeof hasStoredKey]) continue;
                                
                                // Use dynamic models if available, otherwise fallback to static
                                if (dynamicModels[prov] && dynamicModels[prov].length > 0) {
                                    dynamicModels[prov].forEach(m => {
                                        if (!opts.find(o => o.id === m.id)) {
                                            opts.push({ id: m.id, name: m.name, provider: prov });
                                        }
                                    });
                                } else {
                                    cfg.ids.forEach((id, i) => {
                                        if (!opts.find(o => o.id === id)) {
                                            opts.push({ id, name: cfg.names[i], provider: prov });
                                        }
                                    });
                                }
                                
                                const pm = preferredModels[prov as keyof typeof preferredModels];
                                if (pm && !opts.find(o => o.id === pm)) {
                                    opts.push({ id: pm, name: prettifyModelId(pm), provider: prov });
                                }
                            }
                            customProviders.forEach(p => opts.push({ id: p.id, name: p.name, provider: 'custom' }));
                            ollamaModels.forEach(m => opts.push({ id: `ollama-${m}`, name: `${m} (Local)`, provider: 'ollama' }));
                            
                            if (defaultModel && !opts.find(o => o.id === defaultModel)) {
                                opts.unshift({ id: defaultModel, name: prettifyModelId(defaultModel), provider: 'custom' });
                            }
                            return opts;
                        })()}
                        onChange={(val) => {
                            setDefaultModel(val);
                            // @ts-ignore - persist as default + update runtime + broadcast
                            window.electronAPI?.setDefaultModel(val).catch(console.error);
                        }}
                    />
                </div>

                {/* Fast Response Mode */}
                <div
                    className={`bg-bg-item-surface rounded-xl p-5 border border-border-subtle flex items-center justify-between ${!canUseFastMode ? 'opacity-50 grayscale' : ''}`}
                    title={!canUseFastMode ? "Requires a Groq API Key or TeamSync API to be configured" : ""}
                >
                    <div>
                        <div className="flex items-center gap-2">
                            <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-0">Fast Response Mode</label>
                            <span className="bg-orange-500/10 text-orange-500 text-[9px] font-bold px-1.5 py-0.5 rounded border border-orange-500/20">NEW</span>
                        </div>
                        <p className="text-[10px] text-text-secondary mt-0.5">Super fast responses using Groq Llama 3 for text. Multimodal requests still use your Default Model.</p>
                        {!canUseFastMode && (
                            <p className="text-[10px] text-orange-500 mt-0.5 font-medium">Requires a Groq API Key or TeamSync API to be configured.</p>
                        )}
                    </div>
                    <div
                        onClick={async () => {
                            if (!canUseFastMode) {
                                alert("Please configure a Groq API Key or TeamSync API first to enable Fast Response Mode.");
                                return;
                            }
                            const newState = !fastResponseMode;
                            setFastResponseMode(newState);
                            localStorage.setItem('teamsync_groq_fast_text', String(newState));
                            // @ts-ignore
                            await window.electronAPI?.setGroqFastTextMode(newState);
                        }}
                        className={`w-11 h-6 rounded-full relative transition-colors ${!canUseFastMode ? 'cursor-not-allowed bg-bg-toggle-switch' : fastResponseMode ? 'bg-orange-500' : 'bg-bg-toggle-switch border border-border-muted'}`}
                    >
                        <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${fastResponseMode ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                </div>
            </div>

            <ProviderHealthStatusSurface readModel={providerHealthReadModel} />
            <ProviderDiagnosticsSurface readModel={providerDiagnosticsReadModel} />
            <ProviderRoutingTransparencySurface readModel={providerRoutingReadModel} />
            <ProviderFallbackAnalyticsSurface readModel={providerFallbackReadModel} />
            <ProviderTelemetrySurface readModel={providerTelemetryReadModel} />
            <ProviderPersonalizationImpactSurface readModel={providerPersonalizationReadModel} />
            <ProviderResponseDrilldownSurface
                ownershipByResponseId={{}}
                routingReadModel={providerRoutingReadModel}
                diagnosticsReadModel={providerDiagnosticsReadModel}
                telemetryReadModel={providerTelemetryReadModel}
            />

            {/* Cloud Providers */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Cloud Providers</h3>
                    <p className="text-xs text-text-secondary mb-2">Add API keys to unlock cloud AI models.</p>
                </div>

                <div className="space-y-4">

                    {/* Gemini */}
                    <ProviderCard
                        providerId="gemini"
                        providerName="Gemini"
                        apiKey={apiKey}
                        preferredModel={preferredModels.gemini}
                        hasStoredKey={!!hasStoredKey.gemini}
                        onKeyChange={setApiKey}
                        onSaveKey={async () => { await handleSaveKey('gemini', apiKey, setApiKey); }}
                        onRemoveKey={() => handleRemoveKey('gemini', setApiKey)}
                        onTestConnection={() => handleTestConnection('gemini', apiKey)}
                        testStatus={testStatus.gemini || 'idle'}
                        testError={testError.gemini}
                        savingStatus={!!savingStatus.gemini}
                        savedStatus={!!savedStatus.gemini}
                        keyPlaceholder="AIzaSy..."
                        keyUrl="https://aistudio.google.com/app/apikey"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, gemini: model }))}
                    />

                    {/* Groq — Multi-Key Vault */}
                    <GroqKeyVault
                        onModelsFetched={handleGroqModelsFetched}
                        onModelsCleared={handleGroqModelsCleared}
                        preferredModel={preferredModels.groq}
                        onPreferredModelChange={handleGroqPreferredModelChange}
                        hasExistingModels={!!(dynamicModels.groq && dynamicModels.groq.length > 0)}
                        onVaultKeyCountChanged={handleGroqVaultKeyCountChanged}
                    />

                    {/* OpenAI */}
                    <ProviderCard
                        providerId="openai"
                        providerName="OpenAI"
                        apiKey={openaiApiKey}
                        preferredModel={preferredModels.openai}
                        hasStoredKey={!!hasStoredKey.openai}
                        onKeyChange={setOpenaiApiKey}
                        onSaveKey={async () => { await handleSaveKey('openai', openaiApiKey, setOpenaiApiKey); }}
                        onRemoveKey={() => handleRemoveKey('openai', setOpenaiApiKey)}
                        onTestConnection={() => handleTestConnection('openai', openaiApiKey)}
                        testStatus={testStatus.openai || 'idle'}
                        testError={testError.openai}
                        savingStatus={!!savingStatus.openai}
                        savedStatus={!!savedStatus.openai}
                        keyPlaceholder="sk-..."
                        keyUrl="https://platform.openai.com/api-keys"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, openai: model }))}
                    />

                    {/* Claude */}
                    <ProviderCard
                        providerId="claude"
                        providerName="Claude"
                        apiKey={claudeApiKey}
                        preferredModel={preferredModels.claude}
                        hasStoredKey={!!hasStoredKey.claude}
                        onKeyChange={setClaudeApiKey}
                        onSaveKey={async () => { await handleSaveKey('claude', claudeApiKey, setClaudeApiKey); }}
                        onRemoveKey={() => handleRemoveKey('claude', setClaudeApiKey)}
                        onTestConnection={() => handleTestConnection('claude', claudeApiKey)}
                        testStatus={testStatus.claude || 'idle'}
                        testError={testError.claude}
                        savingStatus={!!savingStatus.claude}
                        savedStatus={!!savedStatus.claude}
                        keyPlaceholder="sk-ant-..."
                        keyUrl="https://console.anthropic.com/settings/keys"
                        onPreferredModelChange={(model) => setPreferredModels(prev => ({ ...prev, claude: model }))}
                    />

                    {/* Amazon Bedrock */}
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                                <label className="flex items-center text-xs font-medium text-text-primary uppercase tracking-wide">
                                    Amazon Bedrock
                                    {hasStoredKey.bedrock && <span className="ml-2 text-green-500 normal-case">✓ Saved</span>}
                                </label>
                                <p className="text-[10px] text-text-secondary mt-1">Uses your AWS account, region, and enabled Bedrock model access.</p>
                            </div>
                            {dynamicModels.bedrock?.length > 0 && (
                                <ModelSelect
                                    value={preferredModels.bedrock || bedrockCredentials.preferredModel || ''}
                                    options={dynamicModels.bedrock}
                                    onChange={handleBedrockPreferredModelChange}
                                    placeholder="Select model"
                                />
                            )}
                        </div>

                        <div className="inline-flex rounded-lg border border-border-subtle bg-bg-input p-1 mb-4">
                            {([
                                ['aws_cli', 'AWS CLI / Profile'],
                                ['access_keys', 'Access Keys'],
                            ] as const).map(([mode, label]) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setBedrockCredentials(prev => ({ ...prev, authMode: mode }))}
                                    className={`px-3 py-1.5 rounded-md text-xs transition-colors ${bedrockCredentials.authMode === mode ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {bedrockCredentials.authMode === 'aws_cli' ? (
                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <input
                                    value={bedrockCredentials.profileName || ''}
                                    onChange={(e) => setBedrockCredentials(prev => ({ ...prev, profileName: e.target.value }))}
                                    placeholder="Profile Name (optional)"
                                    className="bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                />
                                <input
                                    value={bedrockCredentials.region}
                                    onChange={(e) => setBedrockCredentials(prev => ({ ...prev, region: e.target.value }))}
                                    placeholder="Region"
                                    className="bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                />
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <input
                                    type="password"
                                    value={bedrockCredentials.accessKeyId || ''}
                                    onChange={(e) => setBedrockCredentials(prev => ({ ...prev, accessKeyId: e.target.value }))}
                                    placeholder="Access Key ID"
                                    className="bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                />
                                <input
                                    type="password"
                                    value={bedrockCredentials.secretAccessKey || ''}
                                    onChange={(e) => setBedrockCredentials(prev => ({ ...prev, secretAccessKey: e.target.value }))}
                                    placeholder="Secret Access Key"
                                    className="bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                />
                                <input
                                    type="password"
                                    value={bedrockCredentials.sessionToken || ''}
                                    onChange={(e) => setBedrockCredentials(prev => ({ ...prev, sessionToken: e.target.value }))}
                                    placeholder="Session Token (optional)"
                                    className="bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                />
                                <input
                                    value={bedrockCredentials.region}
                                    onChange={(e) => setBedrockCredentials(prev => ({ ...prev, region: e.target.value }))}
                                    placeholder="Region"
                                    className="bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                />
                            </div>
                        )}

                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleBedrockConnect}
                                    disabled={testStatus.bedrock === 'testing' || !bedrockCredentials.region.trim()}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-border-subtle flex items-center gap-2 ${testStatus.bedrock === 'success' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                        testStatus.bedrock === 'error' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                            'bg-bg-input hover:bg-bg-elevated text-text-primary disabled:opacity-50'
                                        }`}
                                >
                                    {testStatus.bedrock === 'testing' ? <><Loader2 size={12} className="animate-spin" /> Testing...</> :
                                        testStatus.bedrock === 'success' ? <><CheckCircle size={12} /> Connected</> :
                                            testStatus.bedrock === 'error' ? <><AlertCircle size={12} /> Error</> :
                                                bedrockCredentials.authMode === 'aws_cli' ? 'Connect AWS CLI' : 'Test Connection'}
                                </button>
                                <button
                                    onClick={handleBedrockSave}
                                    disabled={savingStatus.bedrock || !bedrockCredentials.region.trim()}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-border-subtle ${savedStatus.bedrock
                                        ? 'bg-green-500/20 text-green-400 border-green-500/20'
                                        : 'bg-bg-input hover:bg-bg-elevated text-text-primary disabled:opacity-50'
                                        }`}
                                >
                                    {savingStatus.bedrock ? 'Saving...' : savedStatus.bedrock ? 'Saved!' : 'Save Credentials'}
                                </button>
                            </div>
                            {hasStoredKey.bedrock && (
                                <button
                                    onClick={handleBedrockFetchModels}
                                    disabled={savingStatus.bedrockFetch}
                                    className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-accent-primary/20 flex items-center gap-2 bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50"
                                >
                                    {savingStatus.bedrockFetch ? <><Loader2 size={12} className="animate-spin" /> Fetching...</> : <><RefreshCw size={12} /> Fetch Models</>}
                                </button>
                            )}
                        </div>
                        {testError.bedrock && <p className="text-[10px] text-red-400 mt-2">{testError.bedrock}</p>}
                        {bedrockVisionWarning && (
                            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[10px] leading-relaxed text-amber-200">
                                <AlertCircle size={13} className="mt-0.5 shrink-0 text-amber-300" />
                                <span>{bedrockVisionWarning}</span>
                            </div>
                        )}
                    </div>

                </div>
            </div>

            {/* Local (Ollama) Providers */}
            <div className="space-y-5">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <h3 className="text-sm font-bold text-text-primary mb-1">Local Models (Ollama)</h3>
                        <p className="text-xs text-text-secondary">Run open-source models locally.</p>
                    </div>
                    <button
                        onClick={async () => {
                            setIsRefreshingOllama(true);
                            await checkOllama(false);
                            // Add a small delay for visual feedback if the check is too fast
                            setTimeout(() => setIsRefreshingOllama(false), 500);
                        }}
                        className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors"
                        title="Refresh Ollama"
                        disabled={isRefreshingOllama}
                    >
                        <RefreshCw size={18} className={isRefreshingOllama ? "animate-spin" : ""} />
                    </button>
                </div>

                <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
                    {ollamaStatus === 'checking' && (
                        <div className="flex items-center gap-2 text-xs text-text-secondary">
                            <span className="animate-spin">⏳</span> Checking for Ollama...
                        </div>
                    )}

                    {ollamaStatus === 'fixing' && (
                        <div className="flex items-center gap-2 text-xs text-text-secondary">
                            <span className="animate-spin">🔧</span> Attempting to auto-fix connection...
                        </div>
                    )}

                    {ollamaStatus === 'not-found' && (
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 text-xs text-red-400">
                                <AlertCircle size={14} />
                                <span>Ollama not detected</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <p className="text-xs text-text-secondary">
                                    Ensure Ollama is running (`ollama serve`).
                                </p>
                                <button
                                    onClick={handleFixOllama}
                                    className="text-[10px] bg-bg-elevated hover:bg-bg-input px-2 py-1 rounded border border-border-subtle"
                                >
                                    Auto-Fix Connection
                                </button>
                            </div>
                        </div>
                    )}

                    {ollamaStatus === 'detected' && ollamaModels.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-xs text-green-400 mb-3">
                                <CheckCircle size={14} />
                                <span>Ollama connected</span>
                            </div>

                            <div className="grid grid-cols-1 gap-2">
                                {ollamaModels.map(model => (
                                    <div key={model} className="flex items-center justify-between p-2 bg-bg-input rounded-lg border border-border-subtle">
                                        <span className="text-xs text-text-primary font-mono">{model}</span>
                                        <span className="text-[10px] text-bg-elevated bg-text-secondary px-1.5 py-0.5 rounded-full font-bold">LOCAL</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {ollamaStatus === 'detected' && ollamaModels.length === 0 && (
                        <div className="text-xs text-text-secondary">
                            Ollama is running but no models found. Run `ollama pull llama3` to get started.
                        </div>
                    )}
                </div>
            </div>

            {/* Custom Providers */}
            <div className="space-y-5">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-bold text-text-primary">Custom Providers</h3>
                            <span className="px-1.5 py-0 rounded-full text-[7px] font-bold bg-yellow-500/10 text-yellow-500 uppercase tracking-widest border border-yellow-500/20 leading-loose mt-0.5">Experimental</span>
                        </div>
                        <p className="text-xs text-text-secondary">Add your own AI endpoints via cURL.</p>
                    </div>
                    {!isEditingCustom && (
                        <button
                            onClick={handleNewProvider}
                            className="flex items-center gap-2 px-3 py-1.5 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg text-xs font-medium text-text-primary transition-colors"
                        >
                            <Plus size={14} /> Add Provider
                        </button>
                    )}
                </div>

                {isEditingCustom ? (
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle animated fadeIn">
                        <h4 className="text-sm font-bold text-text-primary mb-4">{editingProvider ? 'Edit Provider' : 'New Provider'}</h4>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">Provider Name</label>
                                <input
                                    type="text"
                                    value={customName}
                                    onChange={(e) => setCustomName(e.target.value)}
                                    placeholder="My Custom LLM"
                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">cURL Command</label>
                                <div className="relative">
                                    <textarea
                                        value={customCurl}
                                        onChange={(e) => setCustomCurl(e.target.value)}
                                        placeholder={`curl https://api.openai.com/v1/chat/completions ... "content": "{{TEXT}}"`}
                                        className="w-full h-32 bg-bg-input border border-border-subtle rounded-lg p-4 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary transition-colors resize-none leading-relaxed"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-text-primary uppercase tracking-wide mb-1">
                                    Response JSON Path <span className="text-text-tertiary normal-case font-normal">(Optional)</span>
                                </label>
                                <input
                                    type="text"
                                    value={customResponsePath}
                                    onChange={(e) => setCustomResponsePath(e.target.value)}
                                    placeholder="e.g. choices[0].message.content"
                                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors font-mono"
                                />
                                <p className="text-[10px] text-text-secondary mt-1">
                                    Dot notation path to the answer text in the JSON response. If empty, the full JSON is returned.
                                </p>
                            </div>

                            <div className="bg-bg-elevated/30 rounded-lg overflow-hidden border border-border-subtle mt-4">
                                <div className="px-4 py-3 bg-bg-elevated/50 border-b border-border-subtle flex items-center justify-between">
                                    <h5 className="block text-xs font-medium text-text-primary uppercase tracking-wide">
                                        Configuration Guide
                                    </h5>
                                </div>

                                <div className="p-4 space-y-4">
                                    <div>
                                        <p className="text-xs text-text-secondary mb-2 font-medium">Available Variables</p>
                                        <div className="grid grid-cols-1 gap-2">
                                            <div className="flex items-center gap-2 text-xs">
                                                <code className="bg-bg-input px-1.5 py-0.5 rounded text-text-primary font-mono border border-border-subtle">{"{{TEXT}}"}</code>
                                                <span className="text-text-tertiary">Combined System + Context + Message (Recommended)</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs">
                                                <code className="bg-bg-input px-1.5 py-0.5 rounded text-text-primary font-mono border border-border-subtle">{"{{IMAGE_BASE64}}"}</code>
                                                <span className="text-text-tertiary">Screenshot data (if available)</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <p className="text-xs text-text-secondary mb-2 font-medium">Examples</p>
                                        <div className="space-y-3">
                                            {/* Ollama Example */}
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1.5">Local (Ollama)</div>
                                                <div className="bg-bg-input p-2.5 rounded-lg border border-border-subtle overflow-x-auto group relative">
                                                    <code className="font-mono text-[10px] text-text-primary whitespace-pre block">
                                                        curl http://localhost:11434/api/generate -d '{"{"}"model": "llama3", "prompt": "{`{{TEXT}}`}"{"}"}'
                                                    </code>
                                                </div>
                                            </div>

                                            {/* OpenAI Example */}
                                            <div>
                                                <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1.5">OpenAI Compatible</div>
                                                <div className="bg-bg-input p-2.5 rounded-lg border border-border-subtle overflow-x-auto">
                                                    <code className="font-mono text-[10px] text-text-primary whitespace-pre block">
                                                        {`curl https://api.openai.com/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "{{TEXT}}"}
    ],
    "temperature": 0.7
  }'`}
                                                    </code>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {curlError && (
                                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
                                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                                    <span>{curlError}</span>
                                </div>
                            )}

                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    onClick={() => setIsEditingCustom(false)}
                                    className="px-4 py-2 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-input transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveCustom}
                                    className="px-4 py-2 rounded-lg text-xs font-medium bg-accent-primary text-white hover:bg-accent-secondary transition-colors flex items-center gap-2"
                                >
                                    <Save size={14} /> Save Provider
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {customProviders.length === 0 ? (
                            <div className="text-center py-8 bg-bg-item-surface rounded-xl border border-border-subtle border-dashed">
                                <p className="text-xs text-text-tertiary">No custom providers added yet.</p>
                            </div>
                        ) : (
                            customProviders.map((provider) => (
                                <div key={provider.id} className="bg-bg-item-surface rounded-xl p-4 border border-border-subtle flex items-center justify-between group">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-bg-input flex items-center justify-center text-text-secondary font-mono text-xs font-bold">
                                            {provider.name.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-medium text-text-primary">{provider.name}</h4>
                                            <p className="text-[10px] text-text-tertiary font-mono truncate max-w-[200px] opacity-60">
                                                {provider.curlCommand.substring(0, 30)}...
                                            </p>
                                            {provider.responsePath && (
                                                <p className="text-[9px] text-text-tertiary font-mono opacity-40 mt-0.5">
                                                    path: {provider.responsePath}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => handleEditProvider(provider)}
                                            className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
                                            title="Edit"
                                        >
                                            <Edit2 size={14} />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteCustom(provider.id)}
                                            className="p-1.5 rounded-lg text-text-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                            title="Delete"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
