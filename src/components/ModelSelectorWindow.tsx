import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Check, Loader2 } from 'lucide-react';
import {
    MODEL_PROVIDER_LABELS,
    MODEL_PROVIDER_SHORT_LABELS,
    STANDARD_CLOUD_MODELS,
    getModelProviderId,
    prettifyModelId,
} from '../utils/modelUtils';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

// Define Model Types
interface ModelOption {
    id: string;
    name: string;
    type: 'cloud' | 'local' | 'custom' | 'ollama';
    provider?: string;
}



const ModelSelectorWindow = () => {
    const isLight = useResolvedTheme() === 'light';
    const [currentModel, setCurrentModel] = useState<string>(() => localStorage.getItem('cached-current-model') || '');
    const [availableModels, setAvailableModels] = useState<ModelOption[]>(() => {
        try {
            const cached = localStorage.getItem('cached-models');
            return cached ? JSON.parse(cached) : [];
        } catch { return []; }
    });
    const [isLoading, setIsLoading] = useState<boolean>(() => availableModels.length === 0);





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
                    models.push({ id: 'teamsync', name: 'TeamSync API', type: 'cloud', provider: 'teamsync' });
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
                            }
                        } catch (e) {
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
                        }
                    } catch (e) {
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
                                models.push({ id: m.id, name: `${providerName} ${prettifyModelId(m.label || m.id)}`, type: 'cloud', provider: prov });
                            }
                        });
                    } else {
                        cfg.ids.forEach((id, i) => {
                            if (!models.find(x => x.id === id)) {
                                models.push({ id, name: cfg.names[i], type: 'cloud', provider: prov });
                            }
                        });
                    }
                    
                    const pm = creds?.[cfg.pmKey];
                    if (pm && !models.find(x => x.id === pm)) {
                        models.push({ id: pm, name: prettifyModelId(pm), type: 'cloud', provider: prov });
                    }
                }

                // Custom Providers
                customProviders.forEach((p: any) => {
                    models.push({ id: p.id, name: p.name, type: 'custom' });
                });

                // Ollama
                ollamaModels.forEach((m: string) => {
                    models.push({ id: `ollama-${m}`, name: `${m} (Local)`, type: 'ollama' });
                });

                localStorage.setItem('cached-models', JSON.stringify(models));
                setAvailableModels(models);

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
        localStorage.setItem('cached-current-model', modelId);
        
        window.electronAPI?.setModel(modelId)
            .catch((err: any) => console.error("Failed to set model:", err));
    };

    const panelClass = isLight
        ? 'bg-[#F3F4F6]/92 border-black/10 shadow-black/10'
        : 'bg-[#1E1E1E]/80 border-white/10 shadow-black/40';
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

    return (
        <div className="w-fit h-fit bg-transparent flex flex-col">
            <div className={`w-[360px] max-w-[calc(100vw-24px)] h-[320px] backdrop-blur-md border rounded-[16px] overflow-hidden shadow-2xl p-2 flex flex-col animate-scale-in origin-top-left ${panelClass}`}>

                {isLoading ? (
                    <div className={`flex items-center justify-center py-4 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        <span className="text-xs">Loading models...</span>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col gap-0.5">
                        {availableModels.length === 0 ? (
                            <div className={`px-4 py-3 text-center text-xs ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                                No models connected.<br />Check Settings.
                            </div>
                        ) : (
                            availableModels.map((model, index) => {
                                const isSelected = currentModel === model.id;
                                const provider = getModelProviderId(model.id, model.provider, model.type);
                                const previousModel = availableModels[index - 1];
                                const previousProvider = previousModel
                                    ? getModelProviderId(previousModel.id, previousModel.provider, previousModel.type)
                                    : undefined;
                                const showProviderHeader = provider && provider !== previousProvider;
                                const accent = providerAccents[provider];
                                return (
                                    <React.Fragment key={model.id}>
                                        {showProviderHeader && (
                                            <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                                                <span className={`h-px w-4 ${accent?.rule || 'bg-white/10'}`} />
                                                <span className={`h-1.5 w-1.5 rounded-full ${accent?.dot || 'bg-slate-400'}`} />
                                                <span className={`text-[10px] font-semibold uppercase tracking-wide ${isLight ? 'text-slate-400' : (accent?.header || 'text-[#FDE68A]/35')}`}>
                                                    {MODEL_PROVIDER_LABELS[provider]}
                                                </span>
                                            </div>
                                        )}
                                        <button
                                            onClick={() => handleSelectFn(model.id)}
                                            title={model.name}
                                            className={`
                                                w-full text-left px-3 py-2 flex items-center justify-between group transition-colors duration-200 rounded-lg
                                                ${isSelected
                                                    ? (isLight ? 'bg-black/[0.07] text-slate-900' : 'bg-white/10 text-[#FDE68A]')
                                                    : (isLight ? 'text-slate-500 hover:bg-black/[0.04] hover:text-slate-800' : 'text-[#FDE68A]/60 hover:bg-white/5 hover:text-[#FDE68A]')
                                                }
                                            `}
                                        >
                                            <span className="flex min-w-0 flex-1 items-start gap-2 whitespace-normal break-words [overflow-wrap:anywhere] leading-snug pr-2">
                                                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${accent?.dot || 'bg-slate-400'}`} />
                                                <span className="min-w-0 flex-1 text-[12px] font-medium">{model.name}</span>
                                            </span>
                                            <span className="ml-2 flex shrink-0 items-center gap-1.5">
                                                <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${isLight ? 'border-black/10 bg-black/[0.035] text-slate-500' : (accent?.chip || 'border-white/10 bg-white/5 text-white/60')}`}>
                                                    {MODEL_PROVIDER_SHORT_LABELS[provider]}
                                                </span>
                                                {isSelected && <Check className={`w-3.5 h-3.5 shrink-0 ${isLight ? 'text-emerald-600' : 'text-[#FDE68A]'}`} />}
                                            </span>
                                        </button>
                                    </React.Fragment>
                                );
                            })
                        )}
                    </div>
                )}

            </div>
        </div>
    );
};

export default ModelSelectorWindow;
