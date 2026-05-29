import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, ExternalLink, Loader2, Shield, ShieldAlert, ShieldOff, Clock, Zap, AlertCircle, RefreshCw, ChevronDown, Check } from 'lucide-react';
import { prettifyModelId } from '../../utils/modelUtils';

// ── Types ──────────────────────────────────────────────────────────

interface VaultKeyEntry {
    id: string;
    maskedKey: string;
    enabled: boolean;
    addedAt: number;
    label?: string;
    exhausted: boolean;
    cooldownUntil: number | null;
    requestCount: number;
    lastUsed: number;
    invalid: boolean;
    isAvailable: boolean;
}

type KeyHealthStatus = 'healthy' | 'active' | 'cooldown' | 'invalid' | 'disabled' | 'exhausted';

// ── Helpers ────────────────────────────────────────────────────────

function getKeyStatus(key: VaultKeyEntry): KeyHealthStatus {
    if (!key.enabled) return 'disabled';
    if (key.invalid) return 'invalid';
    if (key.cooldownUntil && key.cooldownUntil > Date.now()) return 'cooldown';
    if (key.exhausted) return 'exhausted';
    if (key.isAvailable) return 'healthy';
    return 'healthy';
}

function getStatusConfig(status: KeyHealthStatus): { label: string; color: string; bgColor: string; borderColor: string; dotColor: string } {
    switch (status) {
        case 'active':
            return { label: 'Active', color: 'text-emerald-400', bgColor: 'bg-emerald-500/8', borderColor: 'border-emerald-500/15', dotColor: 'bg-emerald-400' };
        case 'healthy':
            return { label: 'Healthy', color: 'text-emerald-400', bgColor: 'bg-emerald-500/8', borderColor: 'border-emerald-500/15', dotColor: 'bg-emerald-400' };
        case 'cooldown':
            return { label: 'Cooldown', color: 'text-amber-400', bgColor: 'bg-amber-500/8', borderColor: 'border-amber-500/15', dotColor: 'bg-amber-400' };
        case 'invalid':
            return { label: 'Invalid', color: 'text-red-400', bgColor: 'bg-red-500/8', borderColor: 'border-red-500/15', dotColor: 'bg-red-400' };
        case 'disabled':
            return { label: 'Disabled', color: 'text-text-tertiary', bgColor: 'bg-bg-input', borderColor: 'border-border-subtle', dotColor: 'bg-text-tertiary' };
        case 'exhausted':
            return { label: 'Exhausted', color: 'text-orange-400', bgColor: 'bg-orange-500/8', borderColor: 'border-orange-500/15', dotColor: 'bg-orange-400' };
    }
}

function formatRelativeTime(timestamp: number): string {
    if (!timestamp) return 'never';
    const diff = Date.now() - timestamp;
    if (diff < 5_000) return 'just now';
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatCooldownRemaining(cooldownUntil: number): string {
    const remaining = Math.max(0, cooldownUntil - Date.now());
    if (remaining <= 0) return 'recovering...';
    const secs = Math.ceil(remaining / 1000);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

// ── Props ──────────────────────────────────────────────────────────

interface GroqKeyVaultProps {
    onModelsFetched?: (models: { id: string; name: string }[]) => void;
    onModelsCleared?: () => void;
    preferredModel?: string;
    onPreferredModelChange?: (modelId: string) => void;
    hasExistingModels?: boolean;
    onVaultKeyCountChanged?: (hasEnabledKeys: boolean) => void;
}

// ── Component ──────────────────────────────────────────────────────

export const GroqKeyVault: React.FC<GroqKeyVaultProps> = ({
    onModelsFetched,
    onModelsCleared,
    preferredModel,
    onPreferredModelChange,
    hasExistingModels,
    onVaultKeyCountChanged,
}) => {
    const [keys, setKeys] = useState<VaultKeyEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [newKeyInput, setNewKeyInput] = useState('');
    const [addingKey, setAddingKey] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);
    const [addSuccess, setAddSuccess] = useState(false);
    const [removingId, setRemovingId] = useState<string | null>(null);
    const [hoveredKeyId, setHoveredKeyId] = useState<string | null>(null);
    const [, setTick] = useState(0); // force re-render for countdown
    const inputRef = useRef<HTMLInputElement>(null);
    const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── Model Discovery State ────────────────────────────────────
    const [fetchedModels, setFetchedModels] = useState<{ id: string; label: string }[]>([]);
    const [isFetchingModels, setIsFetchingModels] = useState(false);
    const [fetchModelError, setFetchModelError] = useState<string | null>(null);
    const [selectedModel, setSelectedModel] = useState<string>(preferredModel || '');
    const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
    const modelDropdownRef = useRef<HTMLDivElement>(null);

    // ── Data Loading ─────────────────────────────────────────────

    const loadKeys = useCallback(async (): Promise<VaultKeyEntry[]> => {
        try {
            // @ts-ignore
            const result = await window.electronAPI?.groqVaultGetKeys?.();
            if (result?.success && result.keys) {
                setKeys(result.keys);
                return result.keys;
            }
        } catch (e) {
            console.error('[GroqKeyVault] Failed to load keys:', e);
        } finally {
            setLoading(false);
        }
        return [];
    }, []);

    // Initial load
    useEffect(() => {
        loadKeys();
    }, [loadKeys]);

    // Auto-refresh every 10s for health updates
    useEffect(() => {
        const interval = setInterval(loadKeys, 10_000);
        return () => clearInterval(interval);
    }, [loadKeys]);

    // Tick for cooldown countdown display
    useEffect(() => {
        const hasCooldown = keys.some(k => k.cooldownUntil && k.cooldownUntil > Date.now());
        if (hasCooldown) {
            tickIntervalRef.current = setInterval(() => setTick(t => t + 1), 1000);
        } else if (tickIntervalRef.current) {
            clearInterval(tickIntervalRef.current);
            tickIntervalRef.current = null;
        }
        return () => {
            if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
        };
    }, [keys]);

    // ── Model Discovery ─────────────────────────────────────────

    useEffect(() => {
        if (preferredModel) setSelectedModel(preferredModel);
    }, [preferredModel]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
                setIsModelDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleFetchModels = useCallback(async () => {
        setIsFetchingModels(true);
        setFetchModelError(null);

        try {
            // @ts-ignore
            const result = await window.electronAPI?.fetchProviderModels('groq', '');
            if (result?.success && result.models) {
                setFetchedModels(result.models);
                // Auto-select first model if current selection not in list
                if (result.models.length > 0) {
                    const existsInList = result.models.some((m: any) => m.id === selectedModel);
                    if (!existsInList) {
                        const firstModel = result.models[0].id;
                        setSelectedModel(firstModel);
                        // @ts-ignore
                        await window.electronAPI?.setProviderPreferredModel('groq', firstModel);
                        onPreferredModelChange?.(firstModel);
                    }
                }
                // Notify parent — updates global Active Model selector
                const providerModels = result.models.map((m: any) => ({
                    id: m.id,
                    name: `Groq ${prettifyModelId(m.label || m.id)}`
                }));
                onModelsFetched?.(providerModels);
            } else {
                setFetchModelError(result?.error || 'Failed to fetch models');
            }
        } catch (e: any) {
            setFetchModelError(e.message || 'Failed to fetch models');
        } finally {
            setIsFetchingModels(false);
        }
    }, [selectedModel, onModelsFetched, onPreferredModelChange]);

    const handleSelectModel = useCallback(async (modelId: string) => {
        setSelectedModel(modelId);
        setIsModelDropdownOpen(false);
        try {
            // @ts-ignore
            await window.electronAPI?.setProviderPreferredModel('groq', modelId);
            onPreferredModelChange?.(modelId);
        } catch (e) {
            console.error('[GroqKeyVault] Failed to save preferred model:', e);
        }
    }, [onPreferredModelChange]);

    // ── Actions ──────────────────────────────────────────────────

    const handleAddKey = async () => {
        const trimmed = newKeyInput.trim();
        if (!trimmed) return;

        setAddingKey(true);
        setAddError(null);
        setAddSuccess(false);

        try {
            // @ts-ignore
            const result = await window.electronAPI?.groqVaultAddKey?.(trimmed);
            if (result?.success) {
                const wasFirstKey = keys.length === 0;
                setNewKeyInput('');
                setAddSuccess(true);
                setTimeout(() => setAddSuccess(false), 2000);
                await loadKeys();
                onVaultKeyCountChanged?.(true);
                // Smart auto-fetch: first key added and no models exist yet
                if (wasFirstKey && !hasExistingModels) {
                    handleFetchModels();
                }
            } else {
                setAddError(result?.error || 'Failed to add key');
            }
        } catch (e: any) {
            setAddError(e.message || 'Failed to add key');
        } finally {
            setAddingKey(false);
        }
    };

    const handleRemoveKey = async (id: string) => {
        setRemovingId(id);
        try {
            // @ts-ignore
            await window.electronAPI?.groqVaultRemoveKey?.(id);
            const updatedKeys = await loadKeys();
            const hasEnabled = updatedKeys.some(k => k.enabled);
            onVaultKeyCountChanged?.(hasEnabled);
            if (!hasEnabled) {
                setFetchedModels([]);
                setSelectedModel('');
                onModelsCleared?.();
            }
        } catch (e) {
            console.error('[GroqKeyVault] Failed to remove key:', e);
        } finally {
            setRemovingId(null);
        }
    };

    const handleToggleKey = async (id: string, enabled: boolean) => {
        // Optimistic update
        setKeys(prev => prev.map(k => k.id === id ? { ...k, enabled } : k));
        try {
            // @ts-ignore
            await window.electronAPI?.groqVaultToggleKey?.(id, enabled);
            const updatedKeys = await loadKeys();
            const hasEnabled = updatedKeys.some(k => k.enabled);
            onVaultKeyCountChanged?.(hasEnabled);
            if (!hasEnabled) {
                setFetchedModels([]);
                setSelectedModel('');
                onModelsCleared?.();
            }
        } catch (e) {
            console.error('[GroqKeyVault] Failed to toggle key:', e);
            await loadKeys(); // Revert on error
        }
    };

    // ── Pool Stats ───────────────────────────────────────────────

    const totalKeys = keys.length;
    const healthyKeys = keys.filter(k => k.enabled && !k.invalid && !k.exhausted && !(k.cooldownUntil && k.cooldownUntil > Date.now())).length;
    const cooldownKeys = keys.filter(k => k.cooldownUntil && k.cooldownUntil > Date.now()).length;
    const invalidKeys = keys.filter(k => k.invalid).length;
    const disabledKeys = keys.filter(k => !k.enabled).length;

    // Find the most recently used key (active)
    const activeKeyId = keys.length > 0
        ? keys.filter(k => k.enabled && !k.invalid && k.lastUsed > 0)
            .sort((a, b) => b.lastUsed - a.lastUsed)[0]?.id ?? null
        : null;

    // ── Render ───────────────────────────────────────────────────

    return (
        <div className="bg-bg-item-surface rounded-xl border border-border-subtle">
            {/* Header */}
            <div className="px-5 pt-5 pb-3">
                <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-text-primary uppercase tracking-wide">
                            Groq API Keys
                        </label>
                        {totalKeys > 0 && (
                            <span className="text-[10px] font-medium text-text-tertiary bg-bg-input px-1.5 py-0.5 rounded-full">
                                {totalKeys} key{totalKeys !== 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                    <button
                        onClick={() => {
                            // @ts-ignore
                            window.electronAPI?.openExternal('https://console.groq.com/keys');
                        }}
                        className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors"
                        title="Get Groq API Key"
                    >
                        <span className="text-[10px] uppercase tracking-wide">Get Key</span>
                        <ExternalLink size={12} />
                    </button>
                </div>
                <p className="text-[10px] text-text-tertiary leading-relaxed">
                    Multi-key rotation with automatic failover. Keys are encrypted at rest.
                </p>
            </div>

            {/* Key List */}
            {loading ? (
                <div className="px-5 pb-4">
                    <div className="flex items-center gap-2 text-xs text-text-tertiary py-3">
                        <Loader2 size={12} className="animate-spin" />
                        Loading vault...
                    </div>
                </div>
            ) : keys.length > 0 ? (
                <div className="px-5 pb-2">
                    <div className="rounded-lg border border-border-subtle overflow-hidden divide-y divide-border-subtle">
                        {keys.map((key) => {
                            const isActive = key.id === activeKeyId;
                            const status = isActive ? 'active' : getKeyStatus(key);
                            const config = getStatusConfig(status);
                            const isHovered = hoveredKeyId === key.id;
                            const isRemoving = removingId === key.id;

                            return (
                                <div
                                    key={key.id}
                                    className={`group flex items-center justify-between px-3.5 py-2.5 transition-all duration-200 ${
                                        key.enabled
                                            ? 'bg-bg-input/30 hover:bg-bg-input/60'
                                            : 'bg-bg-input/10 opacity-60'
                                    }`}
                                    onMouseEnter={() => setHoveredKeyId(key.id)}
                                    onMouseLeave={() => setHoveredKeyId(null)}
                                >
                                    {/* Left: Key info */}
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        {/* Status Icon */}
                                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${config.bgColor} border ${config.borderColor}`}>
                                            {status === 'active' ? (
                                                <Zap size={13} className={config.color} />
                                            ) : status === 'cooldown' ? (
                                                <Clock size={13} className={config.color} />
                                            ) : status === 'invalid' ? (
                                                <ShieldOff size={13} className={config.color} />
                                            ) : status === 'disabled' ? (
                                                <ShieldAlert size={13} className={config.color} />
                                            ) : (
                                                <Shield size={13} className={config.color} />
                                            )}
                                        </div>

                                        {/* Key masked + meta */}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[11px] font-mono text-text-primary truncate">
                                                    {key.maskedKey}
                                                </span>
                                                {/* Status badge */}
                                                <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${config.bgColor} ${config.color} border ${config.borderColor}`}>
                                                    {config.label}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                {status === 'cooldown' && key.cooldownUntil ? (
                                                    <span className="text-[9px] text-amber-400/80 font-medium">
                                                        {formatCooldownRemaining(key.cooldownUntil)}
                                                    </span>
                                                ) : key.lastUsed > 0 ? (
                                                    <span className="text-[9px] text-text-tertiary">
                                                        {formatRelativeTime(key.lastUsed)}
                                                    </span>
                                                ) : (
                                                    <span className="text-[9px] text-text-tertiary">unused</span>
                                                )}
                                                {key.requestCount > 0 && (
                                                    <span className="text-[9px] text-text-tertiary">
                                                        · {key.requestCount} req{key.requestCount !== 1 ? 's' : ''}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right: Actions */}
                                    <div className="flex items-center gap-2 shrink-0 ml-2">
                                        {/* Enable/Disable Toggle */}
                                        <div
                                            onClick={() => handleToggleKey(key.id, !key.enabled)}
                                            className={`w-8 h-[18px] rounded-full relative cursor-pointer transition-colors duration-200 ${
                                                key.enabled
                                                    ? 'bg-emerald-500/80'
                                                    : 'bg-bg-input border border-border-subtle'
                                            }`}
                                            title={key.enabled ? 'Disable key' : 'Enable key'}
                                        >
                                            <div className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
                                                key.enabled ? 'translate-x-[14px]' : 'translate-x-0'
                                            }`} />
                                        </div>

                                        {/* Remove — hover only */}
                                        <button
                                            onClick={() => handleRemoveKey(key.id)}
                                            disabled={isRemoving}
                                            className={`p-1 rounded-md transition-all duration-200 ${
                                                isHovered
                                                    ? 'opacity-100 text-text-tertiary hover:text-red-400 hover:bg-red-500/10'
                                                    : 'opacity-0 pointer-events-none'
                                            }`}
                                            title="Remove key"
                                        >
                                            {isRemoving ? (
                                                <Loader2 size={13} className="animate-spin" />
                                            ) : (
                                                <Trash2 size={13} strokeWidth={1.5} />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : null}

            {/* Model Discovery */}
            {totalKeys > 0 && (
                <div className="px-5 pb-3">
                    <div className="flex items-center justify-between gap-3">
                        {fetchedModels.length > 0 || preferredModel ? (
                            <div className="relative flex-1 max-w-[200px]" ref={modelDropdownRef}>
                                <button
                                    onClick={() => fetchedModels.length > 0 && setIsModelDropdownOpen(!isModelDropdownOpen)}
                                    className={`w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary flex items-center justify-between transition-colors ${fetchedModels.length > 0 ? 'hover:bg-bg-elevated' : 'opacity-80 cursor-default'}`}
                                    type="button"
                                >
                                    <span className="truncate pr-2">
                                        {fetchedModels.find(m => m.id === selectedModel)?.label || (preferredModel ? prettifyModelId(preferredModel) : 'Select model')}
                                    </span>
                                    <ChevronDown size={14} className={`text-text-secondary transition-transform ${isModelDropdownOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {isModelDropdownOpen && fetchedModels.length > 0 && (
                                    <div className="absolute top-full left-0 mt-1 w-full min-w-[200px] bg-bg-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto animated fadeIn">
                                        <div className="p-1 space-y-0.5">
                                            {fetchedModels.map((model) => (
                                                <button
                                                    key={model.id}
                                                    onClick={() => handleSelectModel(model.id)}
                                                    className={`w-full text-left px-3 py-2 text-xs rounded-md flex items-center justify-between group transition-colors ${selectedModel === model.id ? 'bg-bg-input hover:bg-bg-elevated text-text-primary' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                                    type="button"
                                                >
                                                    <span className="truncate">{model.label}</span>
                                                    {selectedModel === model.id && <Check size={14} className="text-accent-primary shrink-0 ml-2" />}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <span className="text-[10px] text-text-tertiary flex-1">Click Fetch Models to discover available models</span>
                        )}

                        <button
                            onClick={handleFetchModels}
                            disabled={isFetchingModels || healthyKeys === 0}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border border-border-subtle flex items-center gap-2 shrink-0 ${
                                isFetchingModels
                                    ? 'bg-bg-input text-text-secondary'
                                    : 'bg-accent-primary/10 text-accent-primary border-accent-primary/20 hover:bg-accent-primary/20 disabled:opacity-40 disabled:cursor-not-allowed'
                            }`}
                        >
                            {isFetchingModels ? (
                                <><Loader2 size={12} className="animate-spin" /> Fetching...</>
                            ) : (
                                <><RefreshCw size={12} /> Fetch Models</>
                            )}
                        </button>
                    </div>
                    {fetchModelError && (
                        <div className="flex items-center gap-1.5 mt-2">
                            <AlertCircle size={11} className="text-red-400 shrink-0" />
                            <p className="text-[10px] text-red-400">{fetchModelError}</p>
                        </div>
                    )}
                </div>
            )}

            {/* Add Key Input */}
            <div className="px-5 pb-4 pt-1">
                <div className="flex gap-2">
                    <input
                        ref={inputRef}
                        type="password"
                        value={newKeyInput}
                        onChange={(e) => {
                            setNewKeyInput(e.target.value);
                            setAddError(null);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && newKeyInput.trim()) handleAddKey();
                        }}
                        placeholder="Paste Groq API key..."
                        className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
                        disabled={addingKey}
                    />
                    <button
                        onClick={handleAddKey}
                        disabled={addingKey || !newKeyInput.trim()}
                        className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-medium transition-all duration-200 shrink-0 ${
                            addSuccess
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                : addingKey
                                    ? 'bg-bg-input text-text-tertiary border border-border-subtle'
                                    : 'bg-bg-input hover:bg-bg-elevated border border-border-subtle text-text-primary disabled:opacity-40 disabled:cursor-not-allowed'
                        }`}
                    >
                        {addingKey ? (
                            <>
                                <Loader2 size={12} className="animate-spin" />
                                Validating...
                            </>
                        ) : addSuccess ? (
                            'Added!'
                        ) : (
                            <>
                                <Plus size={13} />
                                Add Key
                            </>
                        )}
                    </button>
                </div>
                {addError && (
                    <div className="flex items-center gap-1.5 mt-2">
                        <AlertCircle size={11} className="text-red-400 shrink-0" />
                        <p className="text-[10px] text-red-400">{addError}</p>
                    </div>
                )}
            </div>

            {/* Pool Health Footer */}
            {totalKeys > 0 && (
                <div className="px-5 py-3 border-t border-border-subtle bg-bg-input/20 rounded-b-xl">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-wrap">
                            {healthyKeys > 0 && (
                                <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                    {healthyKeys} healthy
                                </span>
                            )}
                            {cooldownKeys > 0 && (
                                <span className="flex items-center gap-1 text-[10px] text-amber-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                    {cooldownKeys} cooldown
                                </span>
                            )}
                            {invalidKeys > 0 && (
                                <span className="flex items-center gap-1 text-[10px] text-red-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                                    {invalidKeys} invalid
                                </span>
                            )}
                            {disabledKeys > 0 && (
                                <span className="flex items-center gap-1 text-[10px] text-text-tertiary">
                                    <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary" />
                                    {disabledKeys} disabled
                                </span>
                            )}
                        </div>
                        <span className="text-[9px] text-text-tertiary uppercase tracking-wider font-medium">
                            LRU Rotation
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};
