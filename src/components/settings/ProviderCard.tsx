import React, { useState, useEffect, useRef } from 'react';
import { Trash2, AlertCircle, CheckCircle, ExternalLink, Loader2, ChevronDown, Check, RefreshCw } from 'lucide-react';

interface FetchedModel {
    id: string;
    label: string;
}

interface ProviderCardProps {
    providerId: 'gemini' | 'groq' | 'openai' | 'claude';
    providerName: string;
    apiKey: string;
    preferredModel?: string;
    hasStoredKey: boolean;
    onKeyChange: (key: string) => void;
    onSaveKey: () => Promise<void>;
    onRemoveKey: () => void;
    onTestConnection: () => void;
    testStatus: 'idle' | 'testing' | 'success' | 'error';
    testError?: string;
    savingStatus: boolean;
    savedStatus: boolean;
    keyPlaceholder: string;
    keyUrl: string;
    onPreferredModelChange?: (modelId: string) => void;
}

export const ProviderCard: React.FC<ProviderCardProps> = ({
    providerId,
    providerName,
    apiKey,
    preferredModel,
    hasStoredKey,
    onKeyChange,
    onSaveKey,
    onRemoveKey,
    onTestConnection,
    testStatus,
    testError,
    savingStatus,
    savedStatus,
    keyPlaceholder,
    keyUrl,
    onPreferredModelChange,
}) => {
    const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
    const [isFetching, setIsFetching] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [selectedModel, setSelectedModel] = useState<string>(preferredModel || '');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [activeModelIndex, setActiveModelIndex] = useState(0);
    const dropdownRef = React.useRef<HTMLDivElement>(null);
    const listboxId = React.useId();

    // Refs to avoid stale closures in the auto-save timer
    const savedRef = useRef(savedStatus);
    const savingRef = useRef(savingStatus);
    savedRef.current = savedStatus;
    savingRef.current = savingStatus;

    // Auto-save API key after 5 seconds of inactivity
    useEffect(() => {
        if (!apiKey.trim()) return;
        const timer = setTimeout(() => {
            if (!savedRef.current && !savingRef.current) {
                onSaveKey().catch(console.error);
            }
        }, 5000);
        return () => clearTimeout(timer);
    }, [apiKey]);

    // Sync preferredModel prop
    useEffect(() => {
        if (preferredModel) setSelectedModel(preferredModel);
    }, [preferredModel]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleFetchModels = async () => {
        setIsFetching(true);
        setFetchError(null);

        try {
            // If a new key is entered, save it first
            if (apiKey.trim()) {
                await onSaveKey();
            }

            // Fetch models using the key (or stored key)
            const keyToUse = apiKey.trim() || '';
            // @ts-ignore
            const result = await window.electronAPI?.fetchProviderModels(providerId, keyToUse);

            if (result?.success && result.models) {
                setFetchedModels(result.models);
                // If we have a preferred model that exists in the list, keep it; otherwise auto-select first
                if (result.models.length > 0) {
                    const existsInList = result.models.some((m: FetchedModel) => m.id === selectedModel);
                    if (!existsInList) {
                        const firstModel = result.models[0].id;
                        setSelectedModel(firstModel);
                        // @ts-ignore
                        await window.electronAPI?.setProviderPreferredModel(providerId, firstModel);
                        if (onPreferredModelChange) {
                            onPreferredModelChange(firstModel);
                        }
                    }
                }
            } else {
                setFetchError(result?.error || 'Failed to fetch models');
            }
        } catch (e: any) {
            setFetchError(e.message || 'Failed to fetch models');
        } finally {
            setIsFetching(false);
        }
    };

    const handleSelectModel = async (modelId: string) => {
        setSelectedModel(modelId);
        setIsDropdownOpen(false);
        setActiveModelIndex(Math.max(0, fetchedModels.findIndex(model => model.id === modelId)));
        try {
            // @ts-ignore
            await window.electronAPI?.setProviderPreferredModel(providerId, modelId);
            if (onPreferredModelChange) {
                onPreferredModelChange(modelId);
            }
        } catch (e) {
            console.error('Failed to save preferred model:', e);
        }
    };

    const selectedOption = fetchedModels.find(m => m.id === selectedModel);
    const selectedModelIndex = Math.max(0, fetchedModels.findIndex(model => model.id === selectedModel));
    const activeModel = fetchedModels[activeModelIndex] ?? fetchedModels[selectedModelIndex];

    const moveActiveModel = (direction: 1 | -1) => {
        if (fetchedModels.length === 0) return;
        setIsDropdownOpen(true);
        setActiveModelIndex((current) => {
            const start = isDropdownOpen ? current : selectedModelIndex;
            return (start + direction + fetchedModels.length) % fetchedModels.length;
        });
    };

    const handleModelComboboxKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveActiveModel(1);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveActiveModel(-1);
            return;
        }

        if (event.key === 'Home' && fetchedModels.length > 0) {
            event.preventDefault();
            setIsDropdownOpen(true);
            setActiveModelIndex(0);
            return;
        }

        if (event.key === 'End' && fetchedModels.length > 0) {
            event.preventDefault();
            setIsDropdownOpen(true);
            setActiveModelIndex(fetchedModels.length - 1);
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            setIsDropdownOpen(false);
            return;
        }

        if ((event.key === 'Enter' || event.key === ' ') && fetchedModels.length > 0) {
            event.preventDefault();
            if (!isDropdownOpen) {
                setIsDropdownOpen(true);
                setActiveModelIndex(selectedModelIndex);
                return;
            }

            void handleSelectModel((activeModel ?? fetchedModels[selectedModelIndex]).id);
        }
    };

    return (
        <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
            <div className="mb-2 flex items-center justify-between">
                <label className="flex items-center text-xs font-medium text-text-primary uppercase tracking-wide">
                    {providerName} API Key
                    {hasStoredKey && <span className="ml-2 text-green-500 normal-case">✓ Saved</span>}
                </label>
                <button
                    onClick={() => {
                        // @ts-ignore
                        window.electronAPI?.openExternal(keyUrl);
                    }}
                    className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors"
                    title={`Get ${providerName} API Key`}
                >
                    <span className="text-[10px] uppercase tracking-wide">Get Key</span>
                    <ExternalLink size={12} />
                </button>
            </div>
            <div className="flex gap-2 mb-3">
                <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => onKeyChange(e.target.value)}
                    placeholder={hasStoredKey ? "••••••••••••" : keyPlaceholder}
                    className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                />
                <button
                    onClick={onSaveKey}
                    disabled={savingStatus || !apiKey.trim()}
                    className={`px-5 py-2.5 rounded-lg text-xs font-medium transition-colors ${savedStatus
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-bg-input hover:bg-bg-secondary border border-border-subtle text-text-primary disabled:opacity-50'
                        }`}
                >
                    {savingStatus ? 'Saving...' : savedStatus ? 'Saved!' : 'Save'}
                </button>
                {hasStoredKey && (
                    <button
                        onClick={onRemoveKey}
                        className="px-2.5 py-2.5 rounded-lg text-xs font-medium text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-all"
                        title="Remove API Key"
                    >
                        <Trash2 size={16} strokeWidth={1.5} />
                    </button>
                )}
            </div>

            {/* Action Row: Test Connection + Conditional Dropdown + Fetch Models */}
            <div className="flex items-center justify-between mb-3 w-full">
                <button
                    onClick={onTestConnection}
                    disabled={(!apiKey.trim() && !hasStoredKey) || testStatus === 'testing'}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-border-subtle flex items-center gap-2 shrink-0 ${testStatus === 'success' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                        testStatus === 'error' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                            'bg-bg-input hover:bg-bg-elevated text-text-primary'
                        }`}
                    title={testError || "Test Connection"}
                >
                    {testStatus === 'testing' ? <><Loader2 size={12} className="animate-spin" /> Testing...</> :
                        testStatus === 'success' ? <><CheckCircle size={12} /> Connected</> :
                            testStatus === 'error' ? <><AlertCircle size={12} /> Error</> :
                                <>{/* No Icon */} Test Connection</>}
                </button>

                {/* Inline Model Dropdown */}
                {fetchedModels.length > 0 || preferredModel ? (
                    <div className="relative flex-1 max-w-[340px] mx-4" ref={dropdownRef}>
                        <button
                            onClick={() => {
                                if (fetchedModels.length === 0) return;
                                setIsDropdownOpen(!isDropdownOpen);
                                setActiveModelIndex(selectedModelIndex);
                            }}
                            onKeyDown={handleModelComboboxKeyDown}
                            className={`w-full bg-bg-input border border-border-subtle rounded-md px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary flex items-center justify-between transition-colors ${fetchedModels.length > 0 ? 'hover:bg-bg-elevated' : 'opacity-80 cursor-default'}`}
                            type="button"
                            role="combobox"
                            aria-haspopup="listbox"
                            aria-expanded={isDropdownOpen}
                            aria-controls={listboxId}
                            aria-activedescendant={isDropdownOpen && activeModel ? `${listboxId}-${activeModel.id}` : undefined}
                            title={selectedOption ? selectedOption.label : (preferredModel || 'Select model')}
                        >
                            <span className="truncate pr-2">{selectedOption ? selectedOption.label : (preferredModel || 'Select model')}</span>
                            <ChevronDown size={14} className={`text-text-secondary transition-transform ${isDropdownOpen ? 'rotate-180' : ''} ${fetchedModels.length === 0 ? 'opacity-50' : ''}`} />
                        </button>

                        {isDropdownOpen && fetchedModels.length > 0 && (
                            <div
                                id={listboxId}
                                role="listbox"
                                aria-label={`${providerName} preferred model`}
                                className="absolute top-full right-0 mt-1 w-[min(560px,80vw)] bg-bg-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-72 overflow-y-auto animated fadeIn"
                            >
                                <div className="p-1 space-y-0.5">
                                    {fetchedModels.map((model, index) => (
                                        <button
                                            key={model.id}
                                            id={`${listboxId}-${model.id}`}
                                            onClick={() => handleSelectModel(model.id)}
                                            onMouseEnter={() => setActiveModelIndex(index)}
                                            className={`w-full text-left px-3 py-2 text-xs rounded-md flex items-center justify-between group transition-colors ${selectedModel === model.id ? 'bg-bg-input hover:bg-bg-elevated text-text-primary' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                            type="button"
                                            role="option"
                                            aria-selected={selectedModel === model.id}
                                            title={model.id}
                                        >
                                            <span className="whitespace-normal break-words leading-snug pr-2">{model.label}</span>
                                            {selectedModel === model.id && <Check size={14} className="text-accent-primary shrink-0 ml-2" />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex-1 mx-4" />
                )}

                {hasStoredKey ? (
                    <button
                        onClick={handleFetchModels}
                        disabled={isFetching}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border border-border-subtle flex items-center gap-2 shrink-0 ${isFetching
                            ? 'bg-bg-input text-text-secondary'
                            : 'bg-accent-primary/10 text-accent-primary border-accent-primary/20 hover:bg-accent-primary/20'
                            }`}
                    >
                        {isFetching ? (
                            <><Loader2 size={12} className="animate-spin" /> Fetching...</>
                        ) : (
                            <><RefreshCw size={12} /> Fetch Models</>
                        )}
                    </button>
                ) : (
                    // Placeholder span to perfectly balance flex-between if button isn't shown
                    <span className="w-[110px]" />
                )}
            </div>

            {/* Error from test or fetch */}
            {testError && <p className="text-[10px] text-red-400 mt-1.5 mb-2">{testError}</p>}
            {fetchError && <p className="text-[10px] text-red-400 mt-1.5 mb-2">Model fetch error: {fetchError}</p>}


        </div>
    );
};
