import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Check, Loader2 } from 'lucide-react';
import {
    MODEL_PROVIDER_LABELS,
    MODEL_PROVIDER_SHORT_LABELS,
    STANDARD_CLOUD_MODELS,
    getModelProviderId,
    prettifyModelId,
} from '../utils/modelUtils';
import {
    getProviderModelMetadata,
    type ProviderModelAccessState,
    type UiProviderModelMetadata,
} from '../lib/providers/providerModelMetadata';

// Define Model Types
interface ModelOption {
    id: string;
    name: string;
    type: 'cloud' | 'local' | 'custom' | 'ollama';
    provider?: string;
    metadata?: UiProviderModelMetadata;
}

function toErrorMessage(error: unknown): string {
    if (!error) return 'Unknown error';
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
        return JSON.stringify(error);
    } catch {
        return 'Unknown error';
    }
}

function formatAccessStateLabel(accessState: ProviderModelAccessState): string {
    switch (accessState) {
        case 'available':
            return 'Available';
        case 'configured':
            return 'Configured';
        case 'fetch_error':
            return 'Fetch failed';
        case 'no_access':
            return 'No access';
        default:
            return 'Unknown';
    }
}

function formatReadableProviderLabel(provider: string): string {
    const metadata = getProviderModelMetadata('', { explicitProvider: provider });
    return metadata.providerId !== 'custom' ? metadata.providerLabel : prettifyModelId(provider);
}

function getBedrockBadges(metadata: UiProviderModelMetadata): string[] {
    const badges = [
        metadata.region,
        metadata.isGptOss ? 'GPT-OSS' : undefined,
        metadata.isVisionCapable ? 'Vision' : 'Text-only',
        `Access: ${formatAccessStateLabel(metadata.accessState)}`,
    ].filter((badge): badge is string => Boolean(badge));
    return badges;
}



const ModelSelectorWindow = () => {
    const isLight = false;
    const [currentModel, setCurrentModel] = useState<string>(() => localStorage.getItem('cached-current-model') || '');
    const [availableModels, setAvailableModels] = useState<ModelOption[]>(() => {
        try {
            const cached = localStorage.getItem('cached-models');
            return cached ? JSON.parse(cached) : [];
        } catch { return []; }
    });
    const [isLoading, setIsLoading] = useState<boolean>(() => availableModels.length === 0);
    const [providerFetchErrors, setProviderFetchErrors] = useState<Record<string, string>>({});
    const [activeModelIndex, setActiveModelIndex] = useState(0);
    const listboxId = React.useId();
    const comboboxRef = useRef<HTMLDivElement>(null);





    // Load Data
    useEffect(() => {
        const loadModels = async () => {
            try {
                // If we already have models, don't show loading to avoid flicker
                if (availableModels.length === 0) {
                    setIsLoading(true);
                }
                
                // 1. Get Stored Credentials (to know which Cloud providers are active)
                const creds = await window.electronAPI?.getStoredCredentials?.();
                const fetchErrors: Record<string, string> = {};
                const bedrockRegion = creds?.bedrockCredentials?.region;

                // 2. Custom Providers
                const customProviders = await window.electronAPI?.getCustomProviders?.() || [];

                // 3. Ollama
                let ollamaModels: string[] = [];
                try {
                    let oModels = await window.electronAPI?.getAvailableOllamaModels?.();

                    // If no models found, try to fix/restart Ollama (server might be down)
                    if (!oModels || oModels.length === 0) {
                        try {
                            // @ts-ignore
                            if (window.electronAPI?.forceRestartOllama) {
                                // @ts-ignore
                                await window.electronAPI.forceRestartOllama();
                                // Wait a moment for server to come up
                                await new Promise(resolve => setTimeout(resolve, 1500));
                                // Retry fetch
                                oModels = await window.electronAPI?.getAvailableOllamaModels?.();
                            }
                        } catch (e) {
                            console.warn("Retrying Ollama failed", e);
                        }
                    }

                    if (oModels) ollamaModels = oModels;
                } catch (e) {
                    // Ignore ollama errors here
                }

                // Build the list
                const models: ModelOption[] = [];

                if (creds?.hasTeamSyncKey) {
                    models.push({
                        id: 'teamsync',
                        name: 'Quietly API',
                        type: 'cloud',
                        provider: 'teamsync',
                        metadata: getProviderModelMetadata('teamsync', {
                            explicitProvider: 'teamsync',
                            source: 'standard',
                            displayName: 'Quietly API',
                        }),
                    });
                }

                // Fetch dynamic models
                const dynamicModels: Record<string, any[]> = {};
                const providers: ('gemini' | 'openai' | 'claude')[] = ['gemini', 'openai', 'claude'];
                for (const prov of providers) {
                    const hasKey = prov === 'gemini' ? creds?.hasGeminiKey :
                                   prov === 'openai' ? creds?.hasOpenaiKey :
                                   prov === 'claude' ? creds?.hasClaudeKey : false;
                                   
                    if (hasKey) {
                        try {
                            const result = await window.electronAPI?.fetchProviderModels?.(prov, '');
                            if (result?.success && result.models) {
                                dynamicModels[prov] = result.models;
                            } else if (result && !result.success) {
                                fetchErrors[prov] = result.error || 'Model fetch failed';
                            }
                        } catch (e) {
                            fetchErrors[prov] = toErrorMessage(e);
                            console.error(`Failed to fetch models for ${prov}:`, e);
                        }
                    }
                }

                // Read persisted Groq models (fetched via Settings → Fetch Models button)
                const groqModels = creds?.groqFetchedModels;
                if (groqModels && groqModels.length > 0) {
                    dynamicModels['groq'] = groqModels;
                }

                const bedrockModels = creds?.bedrockFetchedModels;
                if (bedrockModels && bedrockModels.length > 0) {
                    dynamicModels['bedrock'] = bedrockModels;
                } else if (creds?.hasBedrockCredentials) {
                    try {
                        const result = await window.electronAPI?.fetchBedrockModels?.();
                        if (result?.success && result.models) {
                            dynamicModels['bedrock'] = result.models;
                        } else if (result && !result.success) {
                            fetchErrors['bedrock'] = result.error || 'Bedrock model fetch failed';
                        }
                    } catch (e) {
                        fetchErrors['bedrock'] = toErrorMessage(e);
                        console.error('Failed to fetch Bedrock models:', e);
                    }
                }

                // Cloud Models — standard models + unique preferred models + dynamic models
                for (const [prov, cfg] of Object.entries(STANDARD_CLOUD_MODELS)) {
                    if (!cfg.hasKeyCheck(creds)) continue;
                    
                    if (dynamicModels[prov] && dynamicModels[prov].length > 0) {
                        const providerName = prov === 'openai' ? 'OpenAI' : prov === 'claude' ? 'Claude' : prov === 'groq' ? 'Groq' : prov === 'bedrock' ? 'Bedrock' : 'Gemini';
                        dynamicModels[prov].forEach(m => {
                            if (!models.find(x => x.id === m.id)) {
                                const name = `${providerName} ${prettifyModelId(m.label || m.id)}`;
                                models.push({
                                    id: m.id,
                                    name,
                                    type: 'cloud',
                                    provider: prov,
                                    metadata: getProviderModelMetadata(m.id, {
                                        explicitProvider: prov,
                                        region: prov === 'bedrock' ? bedrockRegion : undefined,
                                        inputModalities: m.inputModalities,
                                        accessState: prov === 'bedrock' ? 'available' : 'configured',
                                        source: 'dynamic',
                                        displayName: name,
                                    }),
                                });
                            }
                        });
                    } else {
                        cfg.ids.forEach((id, i) => {
                            if (!models.find(x => x.id === id)) {
                                models.push({
                                    id,
                                    name: cfg.names[i],
                                    type: 'cloud',
                                    provider: prov,
                                    metadata: getProviderModelMetadata(id, {
                                        explicitProvider: prov,
                                        region: prov === 'bedrock' ? bedrockRegion : undefined,
                                        accessState: prov === 'bedrock' && fetchErrors[prov] ? 'fetch_error' : 'configured',
                                        source: 'standard',
                                        displayName: cfg.names[i],
                                    }),
                                });
                            }
                        });
                    }
                    
                    const pm = creds?.[cfg.pmKey];
                    if (pm && !models.find(x => x.id === pm)) {
                        const name = prettifyModelId(pm);
                        models.push({
                            id: pm,
                            name,
                            type: 'cloud',
                            provider: prov,
                            metadata: getProviderModelMetadata(pm, {
                                explicitProvider: prov,
                                region: prov === 'bedrock' ? bedrockRegion : undefined,
                                accessState: prov === 'bedrock' && fetchErrors[prov] ? 'fetch_error' : 'configured',
                                source: 'preferred',
                                displayName: name,
                            }),
                        });
                    }
                }

                // Custom Providers
                customProviders.forEach((p: any) => {
                    models.push({
                        id: p.id,
                        name: p.name,
                        type: 'custom',
                        metadata: getProviderModelMetadata(p.id, {
                            explicitProvider: 'custom',
                            source: 'custom',
                            displayName: p.name,
                        }),
                    });
                });

                // Ollama
                ollamaModels.forEach((m: string) => {
                    const id = `ollama-${m}`;
                    const name = `${m} (Local)`;
                    models.push({
                        id,
                        name,
                        type: 'ollama',
                        provider: 'ollama',
                        metadata: getProviderModelMetadata(id, {
                            explicitProvider: 'ollama',
                            source: 'local',
                            displayName: name,
                        }),
                    });
                });

                localStorage.setItem('cached-models', JSON.stringify(models));
                setAvailableModels(models);
                setProviderFetchErrors(fetchErrors);

                // 4. Get Current Active Model
                const config = await window.electronAPI?.getCurrentLlmConfig?.(); // Get runtime model
                if (config && config.model) {
                    setCurrentModel(config.model);
                    localStorage.setItem('cached-current-model', config.model);
                }

            } catch (err) {
                console.error("Failed to load models:", err);
            } finally {
                setIsLoading(false);
            }
        };

        loadModels();
        window.addEventListener('focus', loadModels);

        // Listen for changes
        const unsubscribe = window.electronAPI?.onModelChanged?.((modelId: string) => {
            setCurrentModel(modelId);
        });
        return () => {
            unsubscribe?.();
            window.removeEventListener('focus', loadModels);
        };
    }, []);

    const handleSelectFn = (modelId: string) => {
        setCurrentModel(modelId);
        setActiveModelIndex(Math.max(0, availableModels.findIndex(model => model.id === modelId)));
        localStorage.setItem('cached-current-model', modelId);
        
        window.electronAPI?.setModel(modelId)
            .catch((err: any) => console.error("Failed to set model:", err));
    };

    useEffect(() => {
        if (availableModels.length === 0) {
            setActiveModelIndex(0);
            return;
        }

        setActiveModelIndex(Math.max(0, availableModels.findIndex(model => model.id === currentModel)));
    }, [availableModels, currentModel]);

    useLayoutEffect(() => {
        comboboxRef.current?.focus();
    }, []);

    useEffect(() => {
        const activeModel = availableModels[activeModelIndex];
        if (!activeModel) return;
        document.getElementById(`${listboxId}-${activeModel.id}`)?.scrollIntoView({ block: 'nearest' });
    }, [activeModelIndex, availableModels, listboxId]);

    const handleModelListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            window.close();
            return;
        }

        if (availableModels.length === 0) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveModelIndex((current) => (current + 1) % availableModels.length);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveModelIndex((current) => (current - 1 + availableModels.length) % availableModels.length);
            return;
        }

        if (event.key === 'Home') {
            event.preventDefault();
            setActiveModelIndex(0);
            return;
        }

        if (event.key === 'End') {
            event.preventDefault();
            setActiveModelIndex(availableModels.length - 1);
            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            const activeModel = availableModels[activeModelIndex];
            if (activeModel) handleSelectFn(activeModel.id);
        }
    };

    const panelClass = 'model-selector-panel-dark text-white/80';
    const providerAccents: Record<string, { dot: string; header: string; rule: string; chip: string }> = {
        teamsync: { dot: 'bg-cyan-400', header: 'text-cyan-300', rule: 'bg-cyan-400/30', chip: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200' },
        gemini: { dot: 'bg-sky-400', header: 'text-sky-300', rule: 'bg-sky-400/30', chip: 'border-sky-400/25 bg-sky-400/10 text-sky-200' },
        groq: { dot: 'bg-amber-400', header: 'text-amber-300', rule: 'bg-amber-400/30', chip: 'border-amber-400/25 bg-amber-400/10 text-amber-200' },
        openai: { dot: 'bg-emerald-400', header: 'text-emerald-300', rule: 'bg-emerald-400/30', chip: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' },
        claude: { dot: 'bg-orange-300', header: 'text-orange-200', rule: 'bg-orange-300/30', chip: 'border-orange-300/25 bg-orange-300/10 text-orange-100' },
        bedrock: { dot: 'bg-rose-400', header: 'text-rose-300', rule: 'bg-rose-400/30', chip: 'border-rose-400/25 bg-rose-400/10 text-rose-200' },
        custom: { dot: 'bg-violet-400', header: 'text-violet-300', rule: 'bg-violet-400/30', chip: 'border-violet-400/25 bg-violet-400/10 text-violet-200' },
        ollama: { dot: 'bg-lime-400', header: 'text-lime-300', rule: 'bg-lime-400/30', chip: 'border-lime-400/25 bg-lime-400/10 text-lime-200' },
    };
    const providerIdsWithModels = new Set<string>(
        availableModels.map((model) => getModelProviderId(model.id, model.provider, model.type)),
    );
    const orphanedProviderFetchErrors = Object.entries(providerFetchErrors)
        .filter(([, message]) => Boolean(message))
        .filter(([provider]) => !providerIdsWithModels.has(provider));
    const activeModel = availableModels[activeModelIndex];

    return (
        <div
            ref={comboboxRef}
            className="model-selector-combobox w-fit h-fit bg-transparent flex flex-col outline-none focus:outline-none focus-visible:outline-none"
            role="combobox"
            aria-expanded="true"
            aria-haspopup="listbox"
            aria-controls={listboxId}
            aria-activedescendant={activeModel ? `${listboxId}-${activeModel.id}` : undefined}
            tabIndex={0}
            onKeyDown={handleModelListKeyDown}
        >
            <div className={`model-selector-panel relative w-[360px] max-w-[calc(100vw-24px)] h-[320px] overflow-hidden rounded-[22px] border p-2.5 flex flex-col animate-scale-in origin-top-left ${panelClass}`}>
                <div className="model-selector-attached-seam" aria-hidden="true" />
                <div className="model-selector-panel-sheen" aria-hidden="true" />

                {isLoading ? (
                    <div className={`flex items-center justify-center py-4 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        <span className="text-xs">Loading models...</span>
                    </div>
                ) : (
                    <div
                        id={listboxId}
                        role="listbox"
                        aria-label="Available AI models"
                        className="relative z-10 flex-1 overflow-y-auto scrollbar-hide flex flex-col gap-1 pr-0.5"
                    >
                        {availableModels.length === 0 ? (
                            <div className={`px-4 py-3 text-center text-xs ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                                No models connected.<br />Check Settings.
                            </div>
                        ) : (
                            <>
                                {availableModels.map((model, index) => {
                                const isSelected = currentModel === model.id;
                                const provider = getModelProviderId(model.id, model.provider, model.type);
                                const metadata = model.metadata ?? getProviderModelMetadata(model.id, {
                                    explicitProvider: model.provider,
                                    type: model.type,
                                    displayName: model.name,
                                });
                                const bedrockBadges = provider === 'bedrock' ? getBedrockBadges(metadata) : [];
                                const previousModel = availableModels[index - 1];
                                const previousProvider = previousModel
                                    ? getModelProviderId(previousModel.id, previousModel.provider, previousModel.type)
                                    : undefined;
                                const showProviderHeader = provider && provider !== previousProvider;
                                const accent = providerAccents[provider];
                                return (
                                    <React.Fragment key={model.id}>
                                        {showProviderHeader && (
                                            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
                                                <span className={`h-px w-4 ${isLight ? 'bg-black/10' : 'bg-white/[0.12]'}`} />
                                                <span className={`h-1.5 w-1.5 rounded-full ${accent?.dot || 'bg-slate-400'}`} />
                                                <span className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${isLight ? 'text-slate-500/80' : 'text-white/[0.42]'}`}>
                                                    {MODEL_PROVIDER_LABELS[provider]}
                                                </span>
                                            </div>
                                        )}
                                        {showProviderHeader && providerFetchErrors[provider] && (
                                            <div className={`mx-3 mb-1 rounded-md border px-2 py-1 text-[10px] leading-snug ${isLight ? 'border-rose-500/20 bg-rose-50 text-rose-700' : 'border-rose-300/15 bg-rose-400/10 text-rose-100/75'}`}>
                                                Fetch error: {providerFetchErrors[provider]}
                                            </div>
                                        )}
                                        <button
                                            id={`${listboxId}-${model.id}`}
                                            onClick={() => handleSelectFn(model.id)}
                                            onMouseEnter={() => setActiveModelIndex(index)}
                                            title={model.name}
                                            role="option"
                                            aria-selected={isSelected}
                                            tabIndex={-1}
                                            className={`
                                                w-full text-left px-3 py-2.5 flex items-center justify-between group transition-colors duration-200 rounded-[14px]
                                                ${isSelected
                                                    ? (isLight ? 'bg-white/70 text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]' : 'bg-white/[0.115] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]')
                                                    : (isLight ? 'text-slate-600 hover:bg-white/50 hover:text-slate-950' : 'text-white/60 hover:bg-white/[0.07] hover:text-white')
                                                }
                                            `}
                                        >
                                            <span className="flex min-w-0 flex-1 items-start gap-2 whitespace-normal break-words [overflow-wrap:anywhere] leading-snug pr-2">
                                                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${accent?.dot || 'bg-slate-400'}`} />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-[12px] font-medium">{model.name}</span>
                                                    {bedrockBadges.length > 0 && (
                                                        <span className="mt-1 flex flex-wrap gap-1">
                                                            {bedrockBadges.map((badge) => (
                                                                <span
                                                                    key={badge}
                                                                    className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${isLight ? 'border-black/10 bg-black/[0.035] text-slate-500' : 'border-white/10 bg-white/5 text-white/50'}`}
                                                                >
                                                                    {badge}
                                                                </span>
                                                            ))}
                                                        </span>
                                                    )}
                                                </span>
                                            </span>
                                            <span className="ml-2 flex shrink-0 items-center gap-1.5">
                                                <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${isLight ? 'border-black/10 bg-white/60 text-slate-500' : (accent?.chip || 'border-white/10 bg-white/5 text-white/60')}`}>
                                                    {MODEL_PROVIDER_SHORT_LABELS[provider]}
                                                </span>
                                                {isSelected && <Check className={`w-3.5 h-3.5 shrink-0 ${isLight ? 'text-emerald-600' : 'text-white/80'}`} />}
                                            </span>
                                        </button>
                                    </React.Fragment>
                                );
                                })}
                                {orphanedProviderFetchErrors.map(([provider, message]) => (
                                    <div
                                        key={`fetch-error-${provider}`}
                                        className={`mx-3 my-1 rounded-md border px-2 py-1 text-[10px] leading-snug ${isLight ? 'border-rose-500/20 bg-rose-50 text-rose-700' : 'border-rose-300/15 bg-rose-400/10 text-rose-100/75'}`}
                                    >
                                        {formatReadableProviderLabel(provider)} fetch error: {message}
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                )}

            </div>
        </div>
    );
};

export default ModelSelectorWindow;
