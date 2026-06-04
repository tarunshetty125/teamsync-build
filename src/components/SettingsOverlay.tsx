import React, { useState, useEffect, useMemo } from 'react';
import packageJson from '../../package.json';
import {
    X, Mic, Speaker, Monitor, Keyboard, User, LifeBuoy, LogOut, Upload,
    ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
    Camera, RotateCcw, Eye, Layout, MessageSquare, Crop,
    ChevronDown, ChevronUp, Check, BadgeCheck, Power, Palette, Calendar, Ghost, Sun, Moon, RefreshCw, Info, Globe, FlaskConical, Terminal, Settings, Activity, ExternalLink, Trash2, FolderOpen,
    Sparkles, Pencil, Briefcase, Building2, Search, MapPin, CheckCircle, HelpCircle, Zap, SlidersHorizontal, PointerOff,
    AlertCircle, Lock
} from 'lucide-react';
import { analytics } from '../lib/analytics/analytics.service';
import { AboutSection } from './AboutSection';
import { HelpSettings } from './settings/HelpSettings';
import { AIProvidersSettings } from './settings/AIProvidersSettings';
import { TeamSyncApiSettings } from './settings/TeamSyncApiSettings';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import {
    clampOverlayOpacity,
    getOverlayAppearance,
    OVERLAY_OPACITY_DEFAULT,
    OVERLAY_OPACITY_MIN,
    getDefaultOverlayOpacity,
} from '../lib/overlayAppearance';
import {
    DEFAULT_PERSONALIZATION_PREFERENCES,
    type PersonalizationPreferences,
    type PreferredCodingLanguage,
    type PreferredProvider,
    type ResponseStylePreference,
    type InterviewFocusPreference,
} from '../lib/personalization/preferences';
import { KeyRecorder } from './ui/KeyRecorder';
import { ProfileVisualizer, PremiumUpgradeModal, ResearchPanel } from '../premium';
import { usePermissionsStore } from '../stores/usePermissionsStore';
import type { PermissionKind, PermissionState } from '../lib/permissions/types';
import { isPermissionGranted } from '../lib/permissions/utils';
import { getUpcomingEvents, type NormalizedEvent } from '../utils/filter';
import icon from './icon.png';

type GoogleAuthUser = {
    name: string;
    email: string;
    picture?: string;
    calendarConnected?: boolean;
    isNewUser?: boolean;
}

type UpdaterCacheFileInfo = {
    fileName: string;
    path: string;
    size: number;
    modifiedAt: string;
}

type UpdaterCacheInfo = {
    cacheDir: string;
    pendingDir: string;
    downloadedFiles: UpdaterCacheFileInfo[];
    totalSize: number;
    currentVersion: string;
    latestVersion: string | null;
    error?: string;
}

const formatUpdaterBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, exponent);
    return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
};

type TrustState = 'healthy' | 'needs_attention' | 'disabled';

const getTrustStateLabel = (state: TrustState): string => {
    switch (state) {
        case 'healthy':
            return 'Healthy';
        case 'needs_attention':
            return 'Needs Attention';
        case 'disabled':
            return 'Disabled';
        default:
            return 'Needs Attention';
    }
};

const getTrustChipClass = (state: TrustState): string => {
    switch (state) {
        case 'healthy':
            return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500';
        case 'needs_attention':
            return 'border-amber-500/25 bg-amber-500/10 text-amber-500';
        case 'disabled':
            return 'border-border-subtle bg-bg-input text-text-tertiary';
        default:
            return 'border-border-subtle bg-bg-input text-text-tertiary';
    }
};

const getPermissionTrustState = (
    permissionState: PermissionState | undefined,
    restartRequired = false,
): TrustState => {
    if (restartRequired) return 'needs_attention';
    if (!permissionState) return 'needs_attention';
    if (isPermissionGranted(permissionState)) return 'healthy';
    if (permissionState === 'unsupported') return 'disabled';
    return 'needs_attention';
};

const formatTrustTimestamp = (value?: string | null): string => {
    if (!value) return 'Not checked yet';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not checked yet';
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
};

const CALENDAR_REFRESH_GATE_MESSAGE = 'Connect Google Calendar before refreshing calendar events.';

const deleteProfileScopeItems = [
    'Resume',
    'Job Description',
    'AOT results',
    'Snapshots',
    'Dossiers',
    'Notes',
    'Profile Intelligence',
];

const formatCalendarWindow = (event: NormalizedEvent | null): string => {
    if (!event) return 'No upcoming meeting';
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return event.summary;
    }
    return `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()} - ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()}`;
};

// ---------------------------------------------------------------------------
// MockupTeamSyncInterface — fake in-meeting widget for the opacity preview
// ---------------------------------------------------------------------------
const MockupTeamSyncInterface = ({ opacity }: { opacity: number }) => {
    const resolvedTheme = useResolvedTheme();
    const appearance = useMemo(
        () => getOverlayAppearance(opacity, resolvedTheme),
        [opacity, resolvedTheme]
    );

    return (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none bg-transparent">
            {/* TeamSyncInterface Widget — opacity controlled by the slider */}
            <div
                id="mockup-teamsync-interface"
                className="flex flex-col items-center pointer-events-none -mt-56"
            >
                {/* TopPill Replica */}
                <div className="flex justify-center mb-2 select-none z-50">
                    <div className="flex items-center gap-2 rounded-full overlay-pill-surface backdrop-blur-md pl-1.5 pr-1.5 py-1.5" style={appearance.pillStyle}>
                        <div className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden overlay-icon-surface" style={appearance.iconStyle}>
                            <img
                                src={icon}
                                alt="TeamSync"
                                className="w-[24px] h-[24px] object-contain opacity-95 scale-105 force-black-icon"
                                draggable="false"
                            />
                        </div>
                        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full text-[12px] font-medium border overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                            <ChevronUp className="w-3.5 h-3.5 opacity-70" />
                            <span className="opacity-80 tracking-wide">Hide</span>
                        </div>
                        <div className="w-8 h-8 rounded-full flex items-center justify-center overlay-icon-surface overlay-text-primary" style={appearance.iconStyle}>
                            <div className="w-3.5 h-3.5 rounded-[3px] bg-red-400 opacity-80" />
                        </div>
                    </div>
                </div>

                {/* Main Interface Window Replica */}
                <div className="relative w-[600px] max-w-full overlay-shell-surface overlay-text-primary backdrop-blur-2xl border rounded-[24px] overflow-hidden flex flex-col pt-2 pb-3" style={appearance.shellStyle}>

                    {/* Rolling Transcript Bar */}
                    <div className="w-full flex justify-center py-2 px-4 border-b mb-1 overlay-transcript-surface" style={appearance.transcriptStyle}>
                        <p className="text-[13px] truncate max-w-[90%] font-medium overlay-text-primary">
                            <span className={`${resolvedTheme === 'light' ? 'text-blue-700' : 'text-blue-400'} mr-2 font-semibold`}>Interviewer</span>
                            <span className="opacity-95">So how would you optimize the current algorithm?</span>
                        </p>
                    </div>

                    {/* Chat History Mock */}
                    <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
                        <div className="flex justify-start">
                            <div className="max-w-[85%] px-4 py-3 text-[14px] leading-relaxed font-normal overlay-text-primary">
                                <span className="font-semibold text-emerald-500 block mb-1">Suggestion</span>
                                A good approach would be to use a hash map to cache the intermediate results, which brings the time complexity down from O(n²) to O(n).
                            </div>
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 pt-3">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                            <Pencil className="w-3 h-3 opacity-70" /> What to answer?
                        </div>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                            <MessageSquare className="w-3 h-3 opacity-70" /> Clarify
                        </div>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                            <RefreshCw className="w-3 h-3 opacity-70" /> Recap
                        </div>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border shrink-0 overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                            <HelpCircle className="w-3 h-3 opacity-70" /> Follow Up Question
                        </div>
                        <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium min-w-[74px] shrink-0 border overlay-chip-surface overlay-text-interactive" style={appearance.chipStyle}>
                            <Zap className="w-3 h-3 opacity-70" /> Answer
                        </div>
                    </div>

                    {/* Input Area */}
                    <div className="px-3">
                        <div className="relative group">
                            <div className="w-full border rounded-xl pl-3 pr-10 py-2.5 h-[38px] flex items-center overlay-input-surface" style={appearance.inputStyle}>
                                <span className="text-[13px] overlay-text-muted">Ask anything on screen or conversation</span>
                            </div>
                        </div>

                        {/* Bottom Row */}
                        <div className="flex items-center justify-between mt-3 px-0.5">
                            <div className="flex items-center gap-1.5">
                                <div className="flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs font-medium w-[140px] overlay-control-surface overlay-text-interactive" style={appearance.controlStyle}>
                                    <span className="truncate min-w-0 flex-1">Gemini 3 Flash</span>
                                    <ChevronDown size={14} className="shrink-0" />
                                </div>
                                <div className="w-px h-3 mx-1" style={appearance.dividerStyle} />
                                <div className="w-7 h-7 flex items-center justify-center rounded-lg overlay-icon-surface overlay-text-muted" style={appearance.iconStyle}>
                                    <SlidersHorizontal className="w-3.5 h-3.5" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const CODING_LANGUAGE_OPTIONS: Array<{ value: PreferredCodingLanguage | 'auto'; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' },
    { value: 'python', label: 'Python' },
    { value: 'java', label: 'Java' },
    { value: 'cpp', label: 'C++' },
    { value: 'go', label: 'Go' },
];

const PROVIDER_PREFERENCE_OPTIONS: Array<{ value: PreferredProvider; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: 'teamsync', label: 'TeamSync' },
    { value: 'gemini', label: 'Gemini' },
    { value: 'groq', label: 'Groq' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'claude', label: 'Claude' },
    { value: 'bedrock', label: 'Bedrock' },
    { value: 'ollama', label: 'Ollama' },
];

const RESPONSE_STYLE_OPTIONS: Array<{ value: ResponseStylePreference; label: string }> = [
    { value: 'concise', label: 'Concise' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'detailed', label: 'Detailed' },
];

const INTERVIEW_FOCUS_OPTIONS: Array<{ value: InterviewFocusPreference; label: string }> = [
    { value: 'mixed', label: 'Mixed' },
    { value: 'coding', label: 'Coding' },
    { value: 'system_design', label: 'System Design' },
    { value: 'behavioral', label: 'Behavioral' },
];

interface CustomSelectProps {
    label: string;
    icon: React.ReactNode;
    value: string;
    options: MediaDeviceInfo[];
    onChange: (value: string) => void;
    placeholder?: string;
}

const CustomSelect: React.FC<CustomSelectProps> = ({ label, icon, value, options, onChange, placeholder = "Select device" }) => {
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

    const selectedLabel = options.find(o => o.deviceId === value)?.label || placeholder;

    return (
        <div className="bg-bg-card rounded-xl p-4 border border-border-subtle" ref={containerRef}>
            {label && (
                <div className="flex items-center gap-2 mb-3">
                    <span className="text-text-secondary">{icon}</span>
                    <label className="text-xs font-medium text-text-primary uppercase tracking-wide">{label}</label>
                </div>
            )}

            <div className="relative">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2.5 text-sm text-text-primary flex items-center justify-between hover:bg-bg-elevated transition-colors"
                >
                    <span className="truncate pr-4">{selectedLabel}</span>
                    <ChevronDown size={14} className={`text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                    <div className="absolute top-full left-0 w-full mt-1 bg-bg-elevated border border-border-subtle rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto animated fadeIn">
                        <div className="p-1 space-y-0.5">
                            {options.map((device) => (
                                <button
                                    key={device.deviceId}
                                    onClick={() => {
                                        onChange(device.deviceId);
                                        setIsOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-sm rounded-md flex items-center justify-between group transition-colors ${value === device.deviceId ? 'bg-bg-input hover:bg-bg-elevated text-text-primary' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                >
                                    <span className="truncate">{device.label || `Device ${device.deviceId.slice(0, 5)}...`}</span>
                                    {value === device.deviceId && <Check size={14} className="text-accent-primary" />}
                                </button>
                            ))}
                            {options.length === 0 && (
                                <div className="px-3 py-2 text-sm text-gray-500 italic">No devices found</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

interface ProviderOption {
    id: string;
    label: string;
    badge?: string | null;
    recommended?: boolean;
    desc: string;
    color: string;
    icon: React.ReactNode;
}

interface ProviderSelectProps {
    value: string;
    options: ProviderOption[];
    onChange: (value: string) => void;
}

type SttProviderOptionId =
    | 'none'
    | 'google'
    | 'groq'
    | 'openai'
    | 'deepgram'
    | 'elevenlabs'
    | 'azure'
    | 'ibmwatson'
    | 'soniox'
    | 'teamsync'
    | 'whisper';

type ExternalSttKeyProvider = Exclude<SttProviderOptionId, 'none' | 'google' | 'teamsync' | 'whisper'>;
type SecretStatus = { configured: boolean; masked: string | null };
type SttSecretStatuses = Record<ExternalSttKeyProvider, SecretStatus>;

const createEmptySttSecretStatuses = (): SttSecretStatuses => ({
    deepgram: { configured: false, masked: null },
    groq: { configured: false, masked: null },
    openai: { configured: false, masked: null },
    elevenlabs: { configured: false, masked: null },
    azure: { configured: false, masked: null },
    ibmwatson: { configured: false, masked: null },
    soniox: { configured: false, masked: null },
});

const maskSecretForDisplay = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.length <= 8) return '****';
    const prefixLength = trimmed.includes('-') ? Math.min(trimmed.indexOf('-') + 1, 5) : 4;
    return `${trimmed.slice(0, Math.max(2, prefixLength))}****${trimmed.slice(-4)}`;
};

const ProviderSelect: React.FC<ProviderSelectProps> = ({ value, options, onChange }) => {
    const isLight = useResolvedTheme() === 'light';
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

    const selected = options.find(o => o.id === value);

    const getBadgeStyle = (color?: string) => {
        switch (color) {
            case 'blue': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
            case 'orange': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
            case 'purple': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
            case 'teal': return 'bg-teal-500/10 text-teal-500 border-teal-500/20';
            case 'cyan': return 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20';
            case 'indigo': return 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20';
            case 'green': return 'bg-green-500/10 text-green-500 border-green-500/20';
            default: return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
        }
    };

    const getIconStyle = (color?: string, isSelectedItem: boolean = false) => {
        if (isSelectedItem) return 'bg-accent-primary text-white shadow-sm';
        // For unselected items in list or trigger
        switch (color) {
            case 'blue': return 'bg-blue-500/10 text-blue-600';
            case 'orange': return 'bg-orange-500/10 text-orange-600';
            case 'purple': return 'bg-purple-500/10 text-purple-600';
            case 'teal': return 'bg-teal-500/10 text-teal-600';
            case 'cyan': return 'bg-cyan-500/10 text-cyan-600';
            case 'indigo': return 'bg-indigo-500/10 text-indigo-600';
            case 'green': return 'bg-green-500/10 text-green-600';
            default: return 'bg-gray-500/10 text-gray-600';
        }
    };

    return (
        <div ref={containerRef} className="relative z-20 font-sans">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full group bg-bg-input border border-border-subtle hover:border-border-muted shadow-sm rounded-xl p-2.5 pr-3.5 flex items-center justify-between transition-all duration-200 outline-none focus:ring-2 focus:ring-accent-primary/20 ${isOpen ? 'ring-2 ring-accent-primary/20 border-accent-primary/50' : 'hover:shadow-md'}`}
            >
                {selected ? (
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 transition-all duration-300 ${getIconStyle(selected.color)}`}>
                            {selected.icon}
                        </div>
                        <div className="min-w-0 flex-1 text-left">
                            <div className="flex items-center gap-2">
                                <span className="text-[13px] font-semibold text-text-primary truncate leading-tight">{selected.label}</span>
                                {selected.badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ml-2 ${getBadgeStyle(selected.badge === 'Saved' ? 'green' : selected.color)}`}>{selected.badge}</span>}
                                {selected.recommended && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ml-2 ${getBadgeStyle(selected.color)}`}>Recommended</span>}
                            </div>
                            {/* Short description for trigger */}
                            <span className="text-[11px] text-text-tertiary truncate block leading-tight mt-0.5">{selected.desc}</span>
                        </div>
                    </div>
                ) : <span className="text-text-secondary px-2 text-sm">Select Provider</span>}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-text-tertiary transition-transform duration-300 group-hover:bg-bg-input ${isOpen ? 'rotate-180 bg-bg-input text-text-primary' : ''}`}>
                    <ChevronDown size={14} strokeWidth={2.5} />
                </div>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.98 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className={`absolute top-full left-0 w-full mt-2 backdrop-blur-xl rounded-xl shadow-2xl overflow-hidden ring-1 ring-black/5 ${isLight ? 'bg-bg-elevated border border-border-subtle' : 'bg-bg-elevated/90 border border-white/5'}`}
                    >
                        <div className="max-h-[320px] overflow-y-auto p-1.5 space-y-0.5 custom-scrollbar">
                            {options.map(option => {
                                const isSelected = value === option.id;
                                return (
                                    <button
                                        key={option.id}
                                        onClick={() => { onChange(option.id); setIsOpen(false); }}
                                        className={`w-full rounded-[10px] p-2 flex items-center gap-3 transition-all duration-200 group relative ${isSelected ? (isLight ? 'bg-bg-item-active shadow-inner' : 'bg-white/10 shadow-inner') : (isLight ? 'hover:bg-bg-item-surface' : 'hover:bg-white/5')}`}
                                    >
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 ${isSelected ? 'scale-100' : 'scale-95 group-hover:scale-100'} ${getIconStyle(option.color, false)}`}>
                                            {option.icon}
                                        </div>
                                        <div className="flex-1 min-w-0 text-left">
                                            <div className="flex items-center justify-between mb-0.5">
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-[13px] font-medium transition-colors ${isSelected && !isLight ? 'text-white' : 'text-text-primary'}`}>{option.label}</span>
                                                    {option.badge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${getBadgeStyle(option.badge === 'Saved' ? 'green' : option.color)}`}>{option.badge}</span>}
                                                    {option.recommended && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${getBadgeStyle(option.color)}`}>Recommended</span>}
                                                </div>
                                                {isSelected && <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}><Check size={14} className="text-accent-primary" strokeWidth={3} /></motion.div>}
                                            </div>
                                            <span className={`text-[11px] block truncate transition-colors ${isSelected && !isLight ? 'text-white/70' : 'text-text-tertiary'}`}>{option.desc}</span>
                                        </div>
                                        {/* Hover Indicator */}
                                        {!isSelected && <div className="absolute inset-0 rounded-[10px] ring-1 ring-inset ring-transparent group-hover:ring-border-subtle pointer-events-none" />}
                                    </button>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

interface SettingsOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: string;
    isTrialActive?: boolean;
    isPremiumActive?: boolean;
    isLicenseLoaded?: boolean;
}

const SettingsOverlay: React.FC<SettingsOverlayProps> = ({
    isOpen,
    onClose,
    initialTab = 'overview',
    isTrialActive = false,
    isPremiumActive = false,
    isLicenseLoaded = false,
}) => {
    const isLight = useResolvedTheme() === 'light';
    const shouldReduceMotion = useReducedMotion();
    const [activeTab, setActiveTab] = useState(initialTab);
    const [showQuitConfirm, setShowQuitConfirm] = useState(false);
    const refreshProfileStateRef = React.useRef<((expectedGenerationId?: number) => Promise<void>) | null>(null);

    // Sync active tab when modal opens
    useEffect(() => {
        if (isOpen && initialTab) {
            setActiveTab(initialTab);

            // Proactively load profile data if starting on profile tab
            if (initialTab === 'profile') {
                refreshProfileStateRef.current?.().catch(() => { });
                window.electronAPI?.profileGetNotes?.().then(res => {
                    if (res?.success) setCustomNotes(res.content ?? '');
                }).catch(() => { });
            }
        }
    }, [isOpen, initialTab]);

    const { shortcuts, updateShortcut, resetShortcuts } = useShortcuts();
    const permissionStatus = usePermissionsStore((state) => state.status);
    const permissionsChecking = usePermissionsStore((state) => state.isChecking);
    const permissionsInitialized = usePermissionsStore((state) => state.hasInitialized);
    const permissionError = usePermissionsStore((state) => state.lastError);
    const activePermission = usePermissionsStore((state) => state.activePermission);
    const initializePermissions = usePermissionsStore((state) => state.initialize);
    const refreshPermissions = usePermissionsStore((state) => state.refreshPermissions);
    const requestPermission = usePermissionsStore((state) => state.requestPermission);
    const openPermissionSettings = usePermissionsStore((state) => state.openSettings);
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [isMousePassthrough, setIsMousePassthrough] = useState(false);
    const [disguiseMode, setDisguiseMode] = useState<'terminal' | 'settings' | 'activity' | 'none'>('none');
    const [openOnLogin, setOpenOnLogin] = useState(false);
    const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');
    const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
    const [isAiLangDropdownOpen, setIsAiLangDropdownOpen] = useState(false);
    const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'uptodate' | 'error'>('idle');
    const [updateErrorMessage, setUpdateErrorMessage] = useState<string | null>(null);
    const [latestUpdateVersion, setLatestUpdateVersion] = useState<string | null>(null);
    const [updaterCacheInfo, setUpdaterCacheInfo] = useState<UpdaterCacheInfo | null>(null);
    const [updaterCacheLoading, setUpdaterCacheLoading] = useState(false);
    const [updaterCacheError, setUpdaterCacheError] = useState<string | null>(null);
    const updateStatusTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const themeDropdownRef = React.useRef<HTMLDivElement>(null);
    const aiLangDropdownRef = React.useRef<HTMLDivElement>(null);

    // Profile Engine State
    const [profileStatus, setProfileStatus] = useState<{
        hasProfile: boolean;
        profileMode: boolean;
        isReady: boolean;
        name?: string;
        role?: string;
        totalExperienceYears?: number;
    }>({ hasProfile: false, profileMode: false, isReady: false });
    const [profileUploading, setProfileUploading] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [profileData, setProfileData] = useState<any>(null);
    const [profileViewStatus, setProfileViewStatus] = useState<'idle' | 'processing' | 'ready' | 'empty' | 'error'>('idle');
    const [lastResumeFileToken, setLastResumeFileToken] = useState<string | null>(null);
    const [lastJdFileToken, setLastJdFileToken] = useState<string | null>(null);
    const [lastUploadKind, setLastUploadKind] = useState<'resume' | 'jd' | null>(null);
    const [isPremiumModalOpen, setIsPremiumModalOpen] = useState(false);
    const [isPremium, setIsPremium] = useState(isPremiumActive);
    const [premiumPlan, setPremiumPlan] = useState<string>('');
    // Trial users get the same profile access as premium users for the duration of the trial
    const hasProfileAccess = isPremium || isTrialActive;
    const hasResumeAndJd = profileStatus.hasProfile && Boolean(profileData?.hasActiveJD);
    const canEnableProfileIntelligence = hasProfileAccess && profileStatus.hasProfile;
    const [jdUploading, setJdUploading] = useState(false);
    const [jdError, setJdError] = useState('');
    const [companyResearching, setCompanyResearching] = useState(false);
    const [companyResearchToast, setCompanyResearchToast] = useState<null | {
        variant: 'neutral' | 'success' | 'error';
        title: string;
        description: string;
    }>(null);
    const [deleteProfileConfirmOpen, setDeleteProfileConfirmOpen] = useState(false);
    const [deleteProfileDeleting, setDeleteProfileDeleting] = useState(false);
    const [deleteProfileStatus, setDeleteProfileStatus] = useState<null | {
        variant: 'success' | 'error';
        message: string;
    }>(null);
    const [tavilyApiKey, setTavilyApiKey] = useState('');
    const [hasStoredTavilyKey, setHasStoredTavilyKey] = useState(false);
    const [tavilySaving, setTavilySaving] = useState(false);
    const [tavilyError, setTavilyError] = useState('');
    const companyResearchToastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [negotiationScript, setNegotiationScript] = useState<any>(null);
    const [negotiationGenerating, setNegotiationGenerating] = useState(false);
    const [negotiationError, setNegotiationError] = useState('');
    const uploadGenerationRef = React.useRef(0);
    const profileGenerationRef = React.useRef(0);
    const profileViewStatusRef = React.useRef<'idle' | 'processing' | 'ready' | 'empty' | 'error'>('idle');
    const profileHardDeleteUiGuardRef = React.useRef(false);
    const [customNotes, setCustomNotes] = useState('');
    const [customNotesSaved, setCustomNotesSaved] = useState(false);
    const customNotesDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [verboseLogging, setVerboseLogging] = useState(false);
    const [showVerboseToast, setShowVerboseToast] = useState(false);
    const verboseToastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [useProUI, setUseProUI] = useState(() => localStorage.getItem('teamsync_overlay_v2') === 'true');

    useEffect(() => {
        setIsPremium(isPremiumActive);
    }, [isPremiumActive]);

    useEffect(() => {
        if (!isOpen) {
            setDeleteProfileConfirmOpen(false);
        }
    }, [isOpen]);

    // Auto-disable Pro UI if premium/trial access is lost
    const hasProAccess = isPremium || isTrialActive;
    useEffect(() => {
        if (!isLicenseLoaded) return;
        if (!hasProAccess && useProUI) {
            setUseProUI(false);
            localStorage.setItem('teamsync_overlay_v2', 'false');
            window.dispatchEvent(new CustomEvent('teamsync-overlay-v2-changed', { detail: false }));
        }
    }, [hasProAccess, isLicenseLoaded, useProUI]);

    useEffect(() => {
        if (!isOpen) return;
        initializePermissions().catch(() => { });
    }, [initializePermissions, isOpen]);

    const updateProfileViewStatus = React.useCallback((nextStatus: 'idle' | 'processing' | 'ready' | 'empty' | 'error') => {
        profileViewStatusRef.current = nextStatus;
        setProfileViewStatus(nextStatus);
    }, []);

    const retryLastUpload = React.useCallback(async () => {
        if (profileViewStatusRef.current === 'processing') return;
        if (lastUploadKind === 'resume' && !lastResumeFileToken) return;
        if (lastUploadKind === 'jd' && !lastJdFileToken) return;
        if (!lastUploadKind) return;

        let uploadGenerationId = 0;
        try {
            uploadGenerationId = Date.now();
            uploadGenerationRef.current = uploadGenerationId;
            profileHardDeleteUiGuardRef.current = false;
            setProfileError('');
            setJdError('');
            setProfileData(null);
            profileGenerationRef.current = 0;
            setNegotiationScript(null);
            updateProfileViewStatus('processing');

            if (lastUploadKind === 'resume' && lastResumeFileToken) {
                setProfileUploading(true);
                setProfileStatus({
                    hasProfile: false,
                    profileMode: false,
                    isReady: false
                });
                const result = await window.electronAPI?.profileUploadResume?.(lastResumeFileToken);
                if (uploadGenerationRef.current !== uploadGenerationId) return;
                if (!result?.success) {
                    if (result?.error !== 'STALE_GENERATION') {
                        updateProfileViewStatus('error');
                        setProfileError(result?.error || 'Upload failed');
                    }
                    return;
                }
            } else if (lastUploadKind === 'jd' && lastJdFileToken) {
                setJdUploading(true);
                setProfileStatus(prev => ({ ...prev, isReady: false }));
                const result = await window.electronAPI?.profileUploadJD?.(lastJdFileToken);
                if (uploadGenerationRef.current !== uploadGenerationId) return;
                if (!result?.success) {
                    if (result?.error !== 'STALE_GENERATION') {
                        updateProfileViewStatus('error');
                        setJdError(result?.error || 'JD upload failed');
                    }
                    return;
                }
            }

            await refreshProfileStateRef.current?.(uploadGenerationId);
        } catch (error: any) {
            updateProfileViewStatus('error');
            setProfileError(error?.message || 'Retry failed');
        } finally {
            if (uploadGenerationRef.current === uploadGenerationId) {
                setProfileUploading(false);
                setJdUploading(false);
            }
        }
    }, [lastJdFileToken, lastResumeFileToken, lastUploadKind, updateProfileViewStatus]);

    refreshProfileStateRef.current = async (expectedGenerationId?: number) => {
        const [status, data] = await Promise.all([
            window.electronAPI?.profileGetStatus?.().catch(() => null),
            window.electronAPI?.profileGetProfile?.().catch(() => null)
        ]);

        if (typeof expectedGenerationId === 'number' && expectedGenerationId !== uploadGenerationRef.current) {
            return;
        }
        if (typeof expectedGenerationId === 'number' && profileViewStatusRef.current !== 'processing') {
            return;
        }

        if (status) {
            setProfileStatus(status);
        }

        if (data) {
            profileHardDeleteUiGuardRef.current = false;
            profileGenerationRef.current = typeof data?.generationId === 'number' ? data.generationId : profileGenerationRef.current;
            setNegotiationScript(data?.aot?.negotiation_script ?? data?.negotiationScript ?? null);
            setProfileData(data);
            updateProfileViewStatus('ready');
        } else {
            profileGenerationRef.current = 0;
            setNegotiationScript(null);
            setProfileData(null);
            updateProfileViewStatus('empty');
        }
    };

    const openDeleteProfileConfirmation = React.useCallback(() => {
        setDeleteProfileStatus(null);
        setDeleteProfileConfirmOpen(true);
    }, []);

    const handleDeleteProfileIntelligence = React.useCallback(async () => {
        if (deleteProfileDeleting) return;

        setDeleteProfileDeleting(true);
        setDeleteProfileStatus(null);
        profileHardDeleteUiGuardRef.current = true;

        try {
            const result = await window.electronAPI?.profileHardDeleteAll?.('manual-ui');
            if (!result?.success) {
                throw new Error(result?.error || 'Delete failed');
            }

            const deleteGenerationId = Date.now();
            uploadGenerationRef.current = deleteGenerationId;
            profileGenerationRef.current = 0;
            setProfileUploading(false);
            setJdUploading(false);
            setCompanyResearching(false);
            setNegotiationGenerating(false);
            setProfileError('');
            setJdError('');
            setNegotiationError('');
            setLastResumeFileToken(null);
            setLastJdFileToken(null);
            setLastUploadKind(null);
            if (customNotesDebounceRef.current) {
                clearTimeout(customNotesDebounceRef.current);
                customNotesDebounceRef.current = null;
            }
            if (companyResearchToastTimerRef.current) {
                clearTimeout(companyResearchToastTimerRef.current);
                companyResearchToastTimerRef.current = null;
            }
            setProfileData(null);
            setNegotiationScript(null);
            setCustomNotes('');
            setCustomNotesSaved(false);
            setCompanyResearchToast(null);
            setProfileStatus({
                hasProfile: false,
                profileMode: false,
                isReady: true,
            });
            updateProfileViewStatus('empty');

            try {
                await refreshProfileStateRef.current?.();
            } catch {
                // The local reset above keeps the profile surface in fresh-install state.
            }

            setDeleteProfileConfirmOpen(false);
            setDeleteProfileStatus({
                variant: 'success',
                message: 'Profile Intelligence deleted.',
            });
        } catch (error) {
            profileHardDeleteUiGuardRef.current = false;
            setDeleteProfileStatus({
                variant: 'error',
                message: 'Delete failed',
            });
        } finally {
            setDeleteProfileDeleting(false);
        }
    }, [deleteProfileDeleting, updateProfileViewStatus]);

    const refreshUpdaterCacheInfo = React.useCallback(async () => {
        if (!window.electronAPI?.getUpdaterCacheInfo) {
            setUpdaterCacheError('Updater diagnostics are unavailable in this build');
            return;
        }

        setUpdaterCacheLoading(true);
        setUpdaterCacheError(null);
        try {
            const info = await window.electronAPI.getUpdaterCacheInfo();
            setUpdaterCacheInfo(info);
            setLatestUpdateVersion(info.latestVersion ?? null);
            if (info.error) {
                setUpdaterCacheError(info.error);
            }
        } catch (error) {
            console.error('[Settings] Failed to load updater cache info:', error);
            setUpdaterCacheError(error instanceof Error ? error.message : 'Unable to read updater cache info');
        } finally {
            setUpdaterCacheLoading(false);
        }
    }, []);

    const handleOpenUpdaterCacheFolder = React.useCallback(async () => {
        if (!window.electronAPI?.openUpdaterCacheFolder) {
            setUpdaterCacheError('Open cache folder is unavailable in this build');
            return;
        }

        try {
            const result = await window.electronAPI.openUpdaterCacheFolder();
            if (!result?.success) {
                setUpdaterCacheError(result?.error || 'Unable to open update cache folder');
            }
        } catch (error) {
            console.error('[Settings] Failed to open updater cache folder:', error);
            setUpdaterCacheError(error instanceof Error ? error.message : 'Unable to open update cache folder');
        }
    }, []);

    // Close dropdown when clicking outside
    // Sync with global state changes
    useEffect(() => {
        if (isOpen) {
            if (window.electronAPI?.licenseGetDetails) {
                window.electronAPI.licenseGetDetails().then((details) => {
                    setIsPremium(details.isPremium);
                    if (details.plan) setPremiumPlan(details.plan);
                }).catch(() => { });
            } else {
                window.electronAPI?.licenseCheckPremium?.().then(setIsPremium).catch(() => { });
            }

            // Fetch true initial state from main process
            window.electronAPI?.getUndetectable?.().then(setIsUndetectable).catch(() => { });
            window.electronAPI?.getOverlayMousePassthrough?.().then(setIsMousePassthrough).catch(() => { });
            window.electronAPI?.getDisguise?.().then(setDisguiseMode).catch(() => { });
            window.electronAPI?.getVerboseLogging?.().then(setVerboseLogging).catch(() => { });
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || activeTab !== 'general') return;
        refreshUpdaterCacheInfo();
    }, [activeTab, isOpen, refreshUpdaterCacheInfo]);

    // Listen for autoUpdater events to update the Settings button state
    useEffect(() => {
        const unsubs: Array<() => void> = [];
        if (window.electronAPI?.onUpdateAvailable) {
            unsubs.push(window.electronAPI.onUpdateAvailable((info) => {
                setUpdateErrorMessage(null);
                setLatestUpdateVersion(info?.version ?? null);
                setUpdateStatus('available');
                if (updateStatusTimerRef.current) clearTimeout(updateStatusTimerRef.current);
                updateStatusTimerRef.current = setTimeout(() => setUpdateStatus('idle'), 6000);
            }));
        }
        if (window.electronAPI?.onUpdateNotAvailable) {
            unsubs.push(window.electronAPI.onUpdateNotAvailable(() => {
                setUpdateErrorMessage(null);
                setUpdateStatus('uptodate');
                if (updateStatusTimerRef.current) clearTimeout(updateStatusTimerRef.current);
                updateStatusTimerRef.current = setTimeout(() => setUpdateStatus('idle'), 4000);
            }));
        }
        if (window.electronAPI?.onUpdateDownloaded) {
            unsubs.push(window.electronAPI.onUpdateDownloaded((info) => {
                setLatestUpdateVersion(info?.version ?? null);
                refreshUpdaterCacheInfo();
            }));
        }
        if (window.electronAPI?.onUpdateError) {
            unsubs.push(window.electronAPI.onUpdateError((err) => {
                setUpdateErrorMessage(err || 'Update check failed');
                setUpdateStatus('error');
                if (updateStatusTimerRef.current) clearTimeout(updateStatusTimerRef.current);
                updateStatusTimerRef.current = setTimeout(() => setUpdateStatus('idle'), 4000);
            }));
        }
        return () => {
            unsubs.forEach(u => u());
            if (updateStatusTimerRef.current) clearTimeout(updateStatusTimerRef.current);
        };
    }, [refreshUpdaterCacheInfo]);

    useEffect(() => {
        if (!showVerboseToast) return;
        verboseToastTimerRef.current = setTimeout(() => setShowVerboseToast(false), 5200);
        return () => {
            if (verboseToastTimerRef.current) clearTimeout(verboseToastTimerRef.current);
        };
    }, [showVerboseToast]);

    useEffect(() => {
        if (!companyResearchToast) return;
        companyResearchToastTimerRef.current = setTimeout(() => setCompanyResearchToast(null), 4200);
        return () => {
            if (companyResearchToastTimerRef.current) clearTimeout(companyResearchToastTimerRef.current);
        };
    }, [companyResearchToast]);

    useEffect(() => {
        if (window.electronAPI?.onLicenseStatusChanged) {
            return window.electronAPI.onLicenseStatusChanged((data) => {
                if (data.isPremium) {
                    if (window.electronAPI.licenseGetDetails) {
                        window.electronAPI.licenseGetDetails().then((details) => {
                            setIsPremium(details.isPremium);
                            if (details.plan) setPremiumPlan(details.plan);
                        }).catch(() => { });
                    } else {
                        setIsPremium(true);
                    }
                } else {
                    setIsPremium(false);
                    setPremiumPlan('');
                }
                refreshProfileStateRef.current?.().catch(() => { });
            });
        }
    }, []);

    useEffect(() => {
        if (!window.electronAPI?.onProfileModeChanged) return;
        // Unidirectional: IPC is the source of truth — reflect whatever main process says.
        // Only guard: can't be enabled without a resume. hasActiveJD is NOT required to enable.
        return window.electronAPI.onProfileModeChanged((enabled) => {
            setProfileStatus((prev) => ({
                ...prev,
                profileMode: prev.hasProfile ? enabled : false
            }));
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!profileStatus.profileMode || profileStatus.hasProfile) return;

        setProfileStatus((prev) => ({ ...prev, profileMode: false }));
        window.electronAPI?.profileSetMode?.(false).catch((error) => {
            console.error('Failed to auto-disable profile intelligence:', error);
        });
    }, [profileStatus.hasProfile, profileStatus.profileMode]);

    useEffect(() => {
        const openPremiumUpgrade = () => setIsPremiumModalOpen(true);
        window.addEventListener('open-premium-upgrade', openPremiumUpgrade);
        return () => {
            window.removeEventListener('open-premium-upgrade', openPremiumUpgrade);
        };
    }, []);

    useEffect(() => {
        const unsubscribers: Array<() => void> = [];
        if (window.electronAPI?.onKnowledgeEngineReady) {
            unsubscribers.push(window.electronAPI.onKnowledgeEngineReady(() => {
                refreshProfileStateRef.current?.().catch(() => { });
            }));
        }
        if (window.electronAPI?.onNegotiationRestored) {
            unsubscribers.push(window.electronAPI.onNegotiationRestored(() => {
                refreshProfileStateRef.current?.().catch(() => { });
            }));
        }
        if (window.electronAPI?.onNegotiationRegenerated) {
            unsubscribers.push(window.electronAPI.onNegotiationRegenerated(() => {
                refreshProfileStateRef.current?.().catch(() => { });
            }));
        }
        if (window.electronAPI?.onGapAnalysisRestored) {
            unsubscribers.push(window.electronAPI.onGapAnalysisRestored(() => {
                refreshProfileStateRef.current?.().catch(() => { });
            }));
        }
        if (window.electronAPI?.onQuestionsRestored) {
            unsubscribers.push(window.electronAPI.onQuestionsRestored(() => {
                refreshProfileStateRef.current?.().catch(() => { });
            }));
        }
        if (window.electronAPI?.onProfileResearchUpdated) {
            unsubscribers.push(window.electronAPI.onProfileResearchUpdated(() => {
                if (profileHardDeleteUiGuardRef.current) return;
                refreshProfileStateRef.current?.().catch(() => { });
            }));
        }
        if (window.electronAPI?.onCompanyResearchReady) {
            unsubscribers.push(window.electronAPI.onCompanyResearchReady((research) => {
                if (profileHardDeleteUiGuardRef.current) return;
                if (typeof research?.generationId === 'number' && profileGenerationRef.current > 0 && research.generationId < profileGenerationRef.current) {
                    return;
                }
                setCompanyResearching(false);
                setCompanyResearchToast({
                    variant: 'success',
                    title: 'Company research ready',
                    description: `${research?.company || 'Company'} insights have been added to your dashboard.`
                });
                refreshProfileStateRef.current?.().catch(() => { });
            }));
        }
        if (window.electronAPI?.onProfileUpdated) {
            unsubscribers.push(window.electronAPI.onProfileUpdated((profile) => {
                if (profileHardDeleteUiGuardRef.current && profile) return;
                if (profile) profileHardDeleteUiGuardRef.current = false;
                if (typeof profile?.generationId === 'number' && uploadGenerationRef.current > 0 && profile.generationId !== uploadGenerationRef.current && profileViewStatusRef.current === 'processing') {
                    return;
                }
                if (typeof profile?.generationId === 'number' && profileGenerationRef.current > 0 && profile.generationId < profileGenerationRef.current) {
                    return;
                }
                profileGenerationRef.current = typeof profile?.generationId === 'number'
                    ? profile.generationId
                    : (profile ? profileGenerationRef.current : 0);
                setNegotiationScript(profile?.aot?.negotiation_script ?? profile?.negotiationScript ?? null);
                setProfileData(profile);
                updateProfileViewStatus(profile ? 'ready' : 'empty');
            }));
        }
        return () => {
            unsubscribers.forEach((unsubscribe) => unsubscribe());
        };
    }, [updateProfileViewStatus]);

    useEffect(() => {
        if (window.electronAPI?.onUndetectableChanged) {
            const unsubscribe = window.electronAPI.onUndetectableChanged((newState: boolean) => {
                setIsUndetectable(newState);
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        if (window.electronAPI?.onDisguiseChanged) {
            const unsubscribe = window.electronAPI.onDisguiseChanged((newMode: any) => {
                setDisguiseMode(newMode);
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        if (window.electronAPI?.onOverlayMousePassthroughChanged) {
            const unsubscribe = window.electronAPI.onOverlayMousePassthroughChanged((enabled: boolean) => {
                setIsMousePassthrough(enabled);
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        if (window.electronAPI?.onSttLanguageAutoDetected) {
            const unsubscribe = window.electronAPI.onSttLanguageAutoDetected((bcp47: string) => {
                setAutoDetectedLanguage(bcp47);
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (themeDropdownRef.current && !themeDropdownRef.current.contains(event.target as Node)) {
                setIsThemeDropdownOpen(false);
            }
            if (aiLangDropdownRef.current && !aiLangDropdownRef.current.contains(event.target as Node)) {
                setIsAiLangDropdownOpen(false);
            }
        };

        if (isThemeDropdownOpen || isAiLangDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isThemeDropdownOpen, isAiLangDropdownOpen]);

    const [showTranscript, setShowTranscript] = useState(() => {
        const stored = localStorage.getItem('teamsync_interviewer_transcript');
        return stored !== 'false';
    });

    // Recognition Language
    const [recognitionLanguage, setRecognitionLanguage] = useState('');
    const [selectedSttGroup, setSelectedSttGroup] = useState('');
    const [availableLanguages, setAvailableLanguages] = useState<Record<string, any>>({});
    const [autoDetectedLanguage, setAutoDetectedLanguage] = useState<string | null>(null);

    // AI Response Language
    const [aiResponseLanguage, setAiResponseLanguage] = useState('English');
    const [availableAiLanguages, setAvailableAiLanguages] = useState<any[]>([]);
    const [personalizationPreferences, setPersonalizationPreferences] = useState<PersonalizationPreferences>(
        DEFAULT_PERSONALIZATION_PREFERENCES,
    );

    // Overlay Opacity state
    const [overlayOpacity, setOverlayOpacity] = useState<number>(() => {
        const stored = localStorage.getItem('teamsync_overlay_opacity');
        const parsed = stored ? parseFloat(stored) : NaN;
        // Treat missing value or the old default (0.65) as "not user-set"
        const isUserSet = Number.isFinite(parsed) && parsed !== OVERLAY_OPACITY_DEFAULT;
        return isUserSet ? clampOverlayOpacity(parsed) : getDefaultOverlayOpacity();
    });

    // When the theme changes and the user hasn't saved a custom value, reset to theme-aware default
    const resolvedTheme = useResolvedTheme();
    useEffect(() => {
        const stored = localStorage.getItem('teamsync_overlay_opacity');
        const parsed = stored ? parseFloat(stored) : NaN;
        const isUserSet = Number.isFinite(parsed) && parsed !== OVERLAY_OPACITY_DEFAULT;
        if (!isUserSet) {
            setOverlayOpacity(getDefaultOverlayOpacity());
        }
    }, [resolvedTheme]);


    // Live preview state — true while the user is holding down the slider
    const [isPreviewingOpacity, setIsPreviewingOpacity] = useState(false);
    const [previewOverlayOpacity, setPreviewOverlayOpacity] = useState(overlayOpacity);

    // Ref to hold the latest opacity value without triggering renders during drag
    const latestOpacityRef = React.useRef(overlayOpacity);

    const handleOpacityChange = (val: number) => {
        // DOM-direct updates for 0-lag 60fps drag (bypasses React reconciliation)
        const percentText = `${Math.round(val * 100)}%`;
        document.querySelectorAll('.opacity-percent-label').forEach(el => el.textContent = percentText);
        setPreviewOverlayOpacity(val);
        latestOpacityRef.current = val;

        // Broadcast IPC in real-time so actual meeting overlay tracks slider instantly
        // (safe to do at 60fps, does not trigger React renders)
        window.electronAPI?.setOverlayOpacity?.(val);
    };

    // Bug fix #3: keep latestOpacityRef in sync when overlayOpacity changes outside of a drag
    // (e.g. on first mount, or if another part of code updates it)
    useEffect(() => {
        latestOpacityRef.current = overlayOpacity;
        setPreviewOverlayOpacity(overlayOpacity);
    }, [overlayOpacity]);

    // Bug fix #3 (close-during-drag): if the overlay closes while the user is still dragging,
    // restore all DOM state so nothing is left in a broken state.
    useEffect(() => {
        if (!isOpen && isPreviewingOpacity) {
            stopPreviewingOpacity();
        }
    }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    const startPreviewingOpacity = () => {
        // Bug fix #5: guard against rapid repeated calls (double pointerDown / touch events)
        if (isPreviewingOpacity) return;

        // Direct DOM mutation for sub-millisecond instant hide (bypassing slow React tree diffs)
        document.body.classList.add('disable-transitions');

        const backdrop = document.getElementById('settings-backdrop');
        const wrapper = document.getElementById('settings-panel-wrapper');
        const panel = document.getElementById('settings-panel');
        const card = document.getElementById('opacity-slider-card');
        const mockup = document.getElementById('settings-mockup-wrapper');
        const launcher = document.getElementById('launcher-container');

        if (backdrop) {
            backdrop.style.backgroundColor = 'transparent';
            backdrop.style.backdropFilter = 'none';
            backdrop.style.transition = 'none';
        }
        if (wrapper) {
            wrapper.style.backgroundColor = 'transparent';
            wrapper.style.border = 'none';
            wrapper.style.boxShadow = 'none';
        }
        if (panel) {
            panel.style.visibility = 'hidden';
        }
        if (launcher) {
            launcher.style.visibility = 'hidden';
        }

        if (card) {
            card.style.visibility = 'visible';
            card.style.position = 'relative';
            card.style.zIndex = '9999';
        }
        if (mockup) {
            mockup.style.opacity = '1';
        }

        setPreviewOverlayOpacity(latestOpacityRef.current);
        setIsPreviewingOpacity(true);
    };

    const stopPreviewingOpacity = () => {
        // Direct DOM restoration
        document.body.classList.remove('disable-transitions');
        const backdrop = document.getElementById('settings-backdrop');
        const wrapper = document.getElementById('settings-panel-wrapper');
        const panel = document.getElementById('settings-panel');
        const card = document.getElementById('opacity-slider-card');
        const mockup = document.getElementById('settings-mockup-wrapper');
        const launcher = document.getElementById('launcher-container');

        if (backdrop) {
            backdrop.style.backgroundColor = '';
            backdrop.style.backdropFilter = '';
            backdrop.style.transition = '';
        }
        if (wrapper) {
            wrapper.style.backgroundColor = '';
            wrapper.style.border = '';
            wrapper.style.boxShadow = '';
        }
        if (panel) {
            panel.style.visibility = '';
        }
        if (launcher) {
            launcher.style.visibility = '';
        }

        if (card) {
            card.style.visibility = '';
            card.style.position = '';
            card.style.zIndex = '';
        }
        if (mockup) {
            // Bug fix #4: restore mockup to hidden (opacity 0) rather than leaving it visible
            mockup.style.opacity = '0';
        }

        setIsPreviewingOpacity(false);
        // Sync final dragged value back to React state (persists to localStorage + IPC via useEffect)
        setOverlayOpacity(latestOpacityRef.current);
        setPreviewOverlayOpacity(latestOpacityRef.current);
    };

    useEffect(() => {
        // Only persist to localStorage here. IPC is handled real-time in handleOpacityChange
        // to avoid a redundant extra call 150ms after every drag ends.
        const timeoutId = setTimeout(() => {
            localStorage.setItem('teamsync_overlay_opacity', String(overlayOpacity));
        }, 150);
        return () => clearTimeout(timeoutId);
    }, [overlayOpacity]);

    useEffect(() => {
        const loadLanguages = async () => {
            if (window.electronAPI?.getRecognitionLanguages) {
                const langs = await window.electronAPI.getRecognitionLanguages();
                setAvailableLanguages(langs);

                // Load stored preference or auto-detect
                const storedStt = await window.electronAPI.getSttLanguage();
                let currentLangKey = storedStt;

                if (!currentLangKey) {
                    const systemLocale = navigator.language;
                    // Try to find exact match or primary match
                    const match = Object.entries(langs).find(([_, config]: [string, any]) =>
                        config.bcp47 === systemLocale ||
                        config.iso639 === systemLocale ||
                        (config.alternates && config.alternates.includes(systemLocale))
                    );

                    currentLangKey = match ? match[0] : 'english-us';

                    // Save the auto-detected default
                    if (window.electronAPI?.setRecognitionLanguage) {
                        window.electronAPI.setRecognitionLanguage(currentLangKey);
                    }
                }

                setRecognitionLanguage(currentLangKey);

                // Initialize Group based on current language
                if (langs[currentLangKey]) {
                    setSelectedSttGroup(langs[currentLangKey].group);
                } else {
                    setSelectedSttGroup('English');
                }
            }

            if (window.electronAPI?.getAiResponseLanguages) {
                const aiLangs = await window.electronAPI.getAiResponseLanguages();
                // Sort: Auto first, English second, then alphabetical
                const sortedAiLangs = [...aiLangs].sort((a, b) => {
                    if (a.code === 'auto') return -1;
                    if (b.code === 'auto') return 1;
                    if (a.label === 'English') return -1;
                    if (b.label === 'English') return 1;
                    return a.label.localeCompare(b.label);
                });
                setAvailableAiLanguages(sortedAiLangs);

                const storedAi = await window.electronAPI.getAiResponseLanguage();
                setAiResponseLanguage(storedAi || 'auto');
            }

            if (window.electronAPI?.getPersonalizationPreferences) {
                const preferences = await window.electronAPI.getPersonalizationPreferences();
                setPersonalizationPreferences(preferences);
            }
        };
        loadLanguages();
    }, []);

    useEffect(() => {
        if (!window.electronAPI?.onPersonalizationPreferencesChanged) return;
        return window.electronAPI.onPersonalizationPreferencesChanged((preferences) => {
            setPersonalizationPreferences(preferences);
        });
    }, []);

    const handleLanguageChange = async (key: string) => {
        setRecognitionLanguage(key);
        setAutoDetectedLanguage(null);  // always reset — new session may detect a different language
        if (availableLanguages[key]) {
            setSelectedSttGroup(availableLanguages[key].group);
        }
        if (window.electronAPI?.setRecognitionLanguage) {
            await window.electronAPI.setRecognitionLanguage(key);
        }
    };

    const handleGroupChange = (group: string) => {
        setSelectedSttGroup(group);
        // Find default variant for this group (first one)
        const firstVariant = Object.entries(availableLanguages).find(([_, lang]) => lang.group === group);
        if (firstVariant) {
            handleLanguageChange(firstVariant[0]);
        }
    };

    // Helper to get unique groups
    const languageGroups = Array.from(new Set(Object.values(availableLanguages).map((l: any) => l.group)))
        .sort((a, b) => {
            if (a === 'Auto') return -1;
            if (b === 'Auto') return 1;
            if (a === 'English') return -1;
            if (b === 'English') return 1;
            return a.localeCompare(b);
        });

    // Helper to get variants for current group
    const currentGroupVariants = Object.entries(availableLanguages)

        .filter(([_, lang]) => lang.group === selectedSttGroup)
        .map(([key, lang]) => ({
            deviceId: key,
            label: lang.label,
            kind: 'audioinput' as MediaDeviceKind,
            groupId: '',
            toJSON: () => ({})
        }));

    const handleAiLanguageChange = async (key: string) => {
        if (!key) return;
        const previous = aiResponseLanguage;
        setAiResponseLanguage(key); // Optimistic update
        try {
            if (window.electronAPI?.setAiResponseLanguage) {
                const result = await window.electronAPI.setAiResponseLanguage(key);
                if (result && !result.success) {
                    // Rollback on explicit failure
                    setAiResponseLanguage(previous);
                    console.error('[Settings] Failed to set AI response language:', result.error);
                }
            }
        } catch (err) {
            // Rollback on exception
            setAiResponseLanguage(previous);
            console.error('[Settings] Exception setting AI response language:', err);
        }
    };

    const handlePersonalizationChange = async <K extends keyof PersonalizationPreferences>(
        key: K,
        value: PersonalizationPreferences[K],
    ) => {
        const previous = personalizationPreferences;
        const next = { ...personalizationPreferences, [key]: value };
        setPersonalizationPreferences(next);

        try {
            const result = await window.electronAPI?.setPersonalizationPreferences?.({ [key]: value });
            if (result?.success && result.preferences) {
                setPersonalizationPreferences(result.preferences);
                return;
            }
            setPersonalizationPreferences(previous);
        } catch (err) {
            setPersonalizationPreferences(previous);
            console.error('[Settings] Exception setting personalization preference:', err);
        }
    };


    // Sync transcript setting
    useEffect(() => {
        const handleStorage = () => {
            const stored = localStorage.getItem('teamsync_interviewer_transcript');
            setShowTranscript(stored !== 'false');
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    // Theme Handlers
    const handleSetTheme = async (mode: 'system' | 'light' | 'dark') => {
        setThemeMode(mode);
        if (window.electronAPI?.setThemeMode) {
            await window.electronAPI.setThemeMode(mode);
        }
    };

    // Audio Settings
    const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
    const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedInput, setSelectedInput] = useState('');
    const [selectedOutput, setSelectedOutput] = useState('');
    const [micLevel, setMicLevel] = useState(0);
    const [micTestActive, setMicTestActive] = useState(false);
    const [useExperimentalSck, setUseExperimentalSck] = useState(false);

    // STT Provider settings
    const [sttProvider, setSttProvider] = useState<SttProviderOptionId>('deepgram');
    const [groqSttModel, setGroqSttModel] = useState('whisper-large-v3-turbo');
    const [sttGroqKey, setSttGroqKey] = useState('');
    const [sttOpenaiKey, setSttOpenaiKey] = useState('');
    const [sttDeepgramKey, setSttDeepgramKey] = useState('');
    const [sttElevenLabsKey, setSttElevenLabsKey] = useState('');
    const [sttAzureKey, setSttAzureKey] = useState('');
    const [sttAzureRegion, setSttAzureRegion] = useState('eastus');
    const [sttIbmKey, setSttIbmKey] = useState('');
    const [sttIbmRegion, setSttIbmRegion] = useState('us-south');
    const [sttTestStatus, setSttTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [sttTestError, setSttTestError] = useState('');
    const [sttSaving, setSttSaving] = useState(false);
    const [sttSaved, setSttSaved] = useState(false);
    const [sttKeyStatuses, setSttKeyStatuses] = useState<SttSecretStatuses>(() => createEmptySttSecretStatuses());
    const [googleServiceAccountPath, setGoogleServiceAccountPath] = useState<string | null>(null);
    const [hasTeamSyncKey, setHasTeamSyncKey] = useState(false);
    const [hasStoredSttGroqKey, setHasStoredSttGroqKey] = useState(false);
    const [hasStoredSttOpenaiKey, setHasStoredSttOpenaiKey] = useState(false);
    const [hasStoredDeepgramKey, setHasStoredDeepgramKey] = useState(false);
    const [hasStoredElevenLabsKey, setHasStoredElevenLabsKey] = useState(false);
    const [hasStoredAzureKey, setHasStoredAzureKey] = useState(false);
    const [hasStoredIbmWatsonKey, setHasStoredIbmWatsonKey] = useState(false);
    const [sttSonioxKey, setSttSonioxKey] = useState('');
    const [hasStoredSonioxKey, setHasStoredSonioxKey] = useState(false);
    const normalizeStoredSttProvider = (provider?: string): SttProviderOptionId => {
        if (
            provider === 'none'
            || provider === 'google'
            || provider === 'groq'
            || provider === 'openai'
            || provider === 'deepgram'
            || provider === 'elevenlabs'
            || provider === 'azure'
            || provider === 'ibmwatson'
            || provider === 'soniox'
            || provider === 'teamsync'
            || provider === 'whisper'
        ) {
            return provider;
        }
        return 'deepgram';
    };

    // Load STT settings on mount
    useEffect(() => {
        const loadSttSettings = async () => {
            try {
                // @ts-ignore
                const creds = await window.electronAPI?.getStoredCredentials?.();
                if (creds) {
                    const nextSttKeyStatuses = { ...createEmptySttSecretStatuses(), ...(creds.sttKeys ?? {}) };
                    setSttProvider(normalizeStoredSttProvider(creds.sttProvider));
                    if (creds.groqSttModel) setGroqSttModel(creds.groqSttModel);
                    setGoogleServiceAccountPath(creds.googleServiceAccountPath);
                    setSttKeyStatuses(nextSttKeyStatuses);
                    setHasStoredSttGroqKey(nextSttKeyStatuses.groq.configured || creds.hasSttGroqKey);
                    setHasStoredSttOpenaiKey(nextSttKeyStatuses.openai.configured || creds.hasSttOpenaiKey);
                    setHasStoredDeepgramKey(nextSttKeyStatuses.deepgram.configured || creds.hasDeepgramKey);
                    setHasStoredElevenLabsKey(nextSttKeyStatuses.elevenlabs.configured || creds.hasElevenLabsKey);
                    setHasStoredAzureKey(nextSttKeyStatuses.azure.configured || creds.hasAzureKey);
                    if (creds.azureRegion) setSttAzureRegion(creds.azureRegion);
                    setHasStoredIbmWatsonKey(nextSttKeyStatuses.ibmwatson.configured || creds.hasIbmWatsonKey);
                    if (creds.ibmWatsonRegion) setSttIbmRegion(creds.ibmWatsonRegion);
                    setHasStoredSonioxKey(nextSttKeyStatuses.soniox.configured || creds.hasSonioxKey || false);
                    setHasStoredTavilyKey(creds.hasTavilyKey || false);
                    setHasTeamSyncKey(creds.hasTeamSyncKey || false);
                }
            } catch (e) {
                console.error('Failed to load STT settings:', e);
            }
        };
        if (isOpen) loadSttSettings();
    }, [isOpen]);

    // PR #173: Live-reload settings whenever the backend broadcasts a credentials change
    // (e.g., when the user saves an STT key in a different window, or main fires it after
    // a provider auto-reconfigure like TeamSync key clear).
    useEffect(() => {
        if (!window.electronAPI?.onCredentialsChanged) return;
        const unsubscribe = window.electronAPI.onCredentialsChanged(() => {
            if (isOpen) {
                // Re-fetch credentials silently — purely additive, no state reset
                window.electronAPI?.getStoredCredentials?.().then((creds: any) => {
                    if (!creds) return;
                    const nextSttKeyStatuses = { ...createEmptySttSecretStatuses(), ...(creds.sttKeys ?? {}) };
                    setSttProvider(normalizeStoredSttProvider(creds.sttProvider));
                    if (creds.groqSttModel) setGroqSttModel(creds.groqSttModel);
                    setHasTeamSyncKey(creds.hasTeamSyncKey || false);
                    setSttKeyStatuses(nextSttKeyStatuses);
                    setHasStoredSttGroqKey(nextSttKeyStatuses.groq.configured || creds.hasSttGroqKey);
                    setHasStoredSttOpenaiKey(nextSttKeyStatuses.openai.configured || creds.hasSttOpenaiKey);
                    setHasStoredDeepgramKey(nextSttKeyStatuses.deepgram.configured || creds.hasDeepgramKey);
                    setHasStoredElevenLabsKey(nextSttKeyStatuses.elevenlabs.configured || creds.hasElevenLabsKey);
                    setHasStoredAzureKey(nextSttKeyStatuses.azure.configured || creds.hasAzureKey);
                    if (creds.azureRegion) setSttAzureRegion(creds.azureRegion);
                    setHasStoredIbmWatsonKey(nextSttKeyStatuses.ibmwatson.configured || creds.hasIbmWatsonKey);
                    if (creds.ibmWatsonRegion) setSttIbmRegion(creds.ibmWatsonRegion);
                    setHasStoredSonioxKey(nextSttKeyStatuses.soniox.configured || creds.hasSonioxKey || false);
                    setHasStoredTavilyKey(creds.hasTavilyKey || false);
                }).catch(() => { /* silently ignore */ });
            }
        });
        return () => unsubscribe();
    }, []); // mount-once: isOpen is checked inside the callback

    const handleSttProviderChange = async (provider: SttProviderOptionId) => {
        setSttProvider(provider);
        setSttTestStatus('idle');
        setSttTestError('');
        try {
            // @ts-ignore
            await window.electronAPI?.setSttProvider?.(provider);
        } catch (e) {
            console.error('Failed to set STT provider:', e);
        }
    };

    const getHasStoredSttKey = (provider: ExternalSttKeyProvider): boolean => {
        if (provider === 'groq') return hasStoredSttGroqKey;
        if (provider === 'openai') return hasStoredSttOpenaiKey;
        if (provider === 'deepgram') return hasStoredDeepgramKey;
        if (provider === 'elevenlabs') return hasStoredElevenLabsKey;
        if (provider === 'azure') return hasStoredAzureKey;
        if (provider === 'ibmwatson') return hasStoredIbmWatsonKey;
        return hasStoredSonioxKey;
    };

    const setSttInputForProvider = (provider: ExternalSttKeyProvider, value: string) => {
        if (provider === 'groq') setSttGroqKey(value);
        else if (provider === 'openai') setSttOpenaiKey(value);
        else if (provider === 'deepgram') setSttDeepgramKey(value);
        else if (provider === 'elevenlabs') setSttElevenLabsKey(value);
        else if (provider === 'azure') setSttAzureKey(value);
        else if (provider === 'ibmwatson') setSttIbmKey(value);
        else setSttSonioxKey(value);
    };

    const handleSttKeySubmit = async (provider: ExternalSttKeyProvider, key: string) => {
        if (!key.trim()) return;

        // Auto-test before saving
        setSttSaving(true);
        setSttTestStatus('testing');
        setSttTestError('');

        try {
            // @ts-ignore
            const testResult = await window.electronAPI?.testSttConnection?.(
                provider,
                key.trim(),
                provider === 'azure'
                    ? sttAzureRegion
                    : provider === 'ibmwatson'
                        ? sttIbmRegion
                        : undefined
            );

            if (!testResult?.success) {
                setSttTestStatus('error');
                setSttTestError(testResult?.error || 'Validation failed. Key not saved.');
                setSttSaving(false);
                return; // Stop save
            }

            // If success, proceed to save
            setSttTestStatus('success');
            setTimeout(() => setSttTestStatus('idle'), 3000);

            if (provider === 'groq') {
                // @ts-ignore
                await window.electronAPI?.setGroqSttApiKey?.(key.trim());
                // @ts-ignore
                await window.electronAPI?.setGroqSttModel?.(groqSttModel);
            } else if (provider === 'openai') {
                // @ts-ignore
                await window.electronAPI?.setOpenAiSttApiKey?.(key.trim());
            } else if (provider === 'elevenlabs') {
                // @ts-ignore
                await window.electronAPI?.setElevenLabsApiKey?.(key.trim());
            } else if (provider === 'azure') {
                // @ts-ignore
                await window.electronAPI?.setAzureRegion?.(sttAzureRegion);
                // @ts-ignore
                await window.electronAPI?.setAzureApiKey?.(key.trim());
            } else if (provider === 'ibmwatson') {
                // @ts-ignore
                await window.electronAPI?.setIbmWatsonRegion?.(sttIbmRegion);
                // @ts-ignore
                await window.electronAPI?.setIbmWatsonApiKey?.(key.trim());
            } else if (provider === 'soniox') {
                // @ts-ignore
                await window.electronAPI?.setSonioxApiKey?.(key.trim());
            } else {
                // @ts-ignore
                await window.electronAPI?.setDeepgramApiKey?.(key.trim());
            }
            if (provider === 'groq') setHasStoredSttGroqKey(true);
            else if (provider === 'openai') setHasStoredSttOpenaiKey(true);
            else if (provider === 'elevenlabs') setHasStoredElevenLabsKey(true);
            else if (provider === 'azure') setHasStoredAzureKey(true);
            else if (provider === 'ibmwatson') setHasStoredIbmWatsonKey(true);
            else if (provider === 'soniox') setHasStoredSonioxKey(true);
            else setHasStoredDeepgramKey(true);

            setSttKeyStatuses(prev => ({
                ...prev,
                [provider]: { configured: true, masked: maskSecretForDisplay(key.trim()) },
            }));
            setSttInputForProvider(provider, '');
            setSttProvider(provider);
            setSttSaved(true);
            setTimeout(() => setSttSaved(false), 2000);
        } catch (e: any) {
            console.error(`Failed to save ${provider} STT key:`, e);
            setSttTestStatus('error');
            setSttTestError(e.message || 'Validation failed');
        } finally {
            setSttSaving(false);
        }
    };

    const handleRemoveSttKey = async (provider: ExternalSttKeyProvider) => {
        if (!confirm(`Are you sure you want to remove the ${provider === 'ibmwatson' ? 'IBM Watson' : provider.charAt(0).toUpperCase() + provider.slice(1)} API key?`)) return;

        try {
            if (provider === 'groq') {
                // @ts-ignore
                await window.electronAPI?.setGroqSttApiKey?.('');
                setSttGroqKey('');
                setHasStoredSttGroqKey(false);
            } else if (provider === 'openai') {
                // @ts-ignore
                await window.electronAPI?.setOpenAiSttApiKey?.('');
                setSttOpenaiKey('');
                setHasStoredSttOpenaiKey(false);
            } else if (provider === 'elevenlabs') {
                // @ts-ignore
                await window.electronAPI?.setElevenLabsApiKey?.('');
                setSttElevenLabsKey('');
                setHasStoredElevenLabsKey(false);
            } else if (provider === 'azure') {
                // @ts-ignore
                await window.electronAPI?.setAzureApiKey?.('');
                setSttAzureKey('');
                setHasStoredAzureKey(false);
            } else if (provider === 'ibmwatson') {
                // @ts-ignore
                await window.electronAPI?.setIbmWatsonApiKey?.('');
                setSttIbmKey('');
                setHasStoredIbmWatsonKey(false);
            } else if (provider === 'soniox') {
                // @ts-ignore
                await window.electronAPI?.setSonioxApiKey?.('');
                setSttSonioxKey('');
                setHasStoredSonioxKey(false);
            } else {
                // @ts-ignore
                await window.electronAPI?.setDeepgramApiKey?.('');
                setSttDeepgramKey('');
                setHasStoredDeepgramKey(false);
            }
            setSttKeyStatuses(prev => ({
                ...prev,
                [provider]: { configured: false, masked: null },
            }));
        } catch (e) {
            console.error(`Failed to remove ${provider} STT key:`, e);
        }
    };

    const handleRemoveTavilyKey = async () => {
        if (!confirm('Are you sure you want to remove the Tavily API Key?')) return;

        try {
            await window.electronAPI?.setTavilyApiKey?.('');
            setTavilyApiKey('');
            setHasStoredTavilyKey(false);
        } catch (e) {
            console.error('Failed to remove Tavily API key:', e);
        }
    };

    const handleRunCompanyResearch = async () => {
        const company = profileData?.activeJD?.company?.trim?.();
        const role = profileData?.activeJD?.title?.trim?.() || '';

        if (!company) {
            setCompanyResearchToast({
                variant: 'error',
                title: 'Missing company',
                description: 'Upload a job description first so company research knows what to analyze.'
            });
            return;
        }

        const tavilyStatus = await window.electronAPI?.getTavilyStatus?.().catch(() => null);
        if (!tavilyStatus?.configured) {
            setCompanyResearchToast({
                variant: 'error',
                title: 'Tavily key required',
                description: 'Please add your Tavily API key in Settings before running company research.'
            });
            return;
        }

        setCompanyResearching(true);
        setCompanyResearchToast({
            variant: 'neutral',
            title: 'Research started',
            description: `Gathering live company intelligence for ${company}.`
        });

        try {
            const result = await window.electronAPI?.runCompanyResearch?.(
                company,
                role,
                Boolean(profileData?.research)
            );

            if (!result?.success) {
                setCompanyResearching(false);
                setCompanyResearchToast({
                    variant: 'error',
                    title: 'Research unavailable',
                    description: result?.error === 'MISSING_API_KEY'
                        ? 'Please add your Tavily API key in Settings before running company research.'
                        : (result?.error || 'Company research could not be started.')
                });
                return;
            }

            if (result.status === 'cached' && result.research) {
                await refreshProfileStateRef.current?.();
                setCompanyResearching(false);
                setCompanyResearchToast({
                    variant: 'success',
                    title: 'Using cached research',
                    description: `${company} intelligence is already available and has been restored instantly.`
                });
                return;
            }

            if (result.status === 'running') {
                setCompanyResearchToast({
                    variant: 'neutral',
                    title: 'Research already running',
                    description: `We are already compiling live company intelligence for ${company}.`
                });
                return;
            }
        } catch (error: any) {
            setCompanyResearching(false);
            setCompanyResearchToast({
                variant: 'error',
                title: 'Research failed',
                description: error?.message || 'Unexpected error starting company research.'
            });
        }
    };

    const handleTestSttConnection = async () => {
        if (sttProvider === 'none' || sttProvider === 'google' || sttProvider === 'whisper' || sttProvider === 'teamsync') return;

        const keyToTest =
            sttProvider === 'groq' ? sttGroqKey
                : sttProvider === 'openai' ? sttOpenaiKey
                    : sttProvider === 'deepgram' ? sttDeepgramKey
                        : sttProvider === 'elevenlabs' ? sttElevenLabsKey
                            : sttProvider === 'azure' ? sttAzureKey
                                : sttProvider === 'ibmwatson' ? sttIbmKey
                                    : sttProvider === 'soniox' ? sttSonioxKey
                                        : '';
        const provider = sttProvider as ExternalSttKeyProvider;
        const hasStoredKey = getHasStoredSttKey(provider);
        const regionForTest = sttProvider === 'azure'
            ? sttAzureRegion
            : sttProvider === 'ibmwatson'
                ? sttIbmRegion
                : undefined;

        if (!keyToTest.trim() && !hasStoredKey) {
            setSttTestStatus('error');
            setSttTestError('Please enter an API key first');
            return;
        }

        setSttTestStatus('testing');
        setSttTestError('');
        try {
            // @ts-ignore
            const result = await window.electronAPI?.testSttConnection?.(
                sttProvider,
                keyToTest.trim() || undefined,
                regionForTest
            );
            if (result?.success) {
                setSttTestStatus('success');
                setTimeout(() => setSttTestStatus('idle'), 3000);
            } else {
                setSttTestStatus('error');
                setSttTestError(result?.error || 'Connection failed');
            }
        } catch (e: any) {
            setSttTestStatus('error');
            setSttTestError(e.message || 'Test failed');
        }
    };


    const [authUser, setAuthUser] = useState<GoogleAuthUser | null>(null);
    const [calendarStatus, setCalendarStatus] = useState<{ connected: boolean; email?: string }>({ connected: false });
    const [isCalendarsLoading, setIsCalendarsLoading] = useState(false);
    const [isCalendarSyncing, setIsCalendarSyncing] = useState(false);
    const [calendarLastSyncedAt, setCalendarLastSyncedAt] = useState<string | null>(null);
    const [calendarSyncError, setCalendarSyncError] = useState<string | null>(null);
    const [settingsCalendarEvents, setSettingsCalendarEvents] = useState<NormalizedEvent[]>([]);


    // Load stored credentials on mount




    const handleCheckForUpdates = async () => {
        if (updateStatus === 'checking') return;
        setUpdateErrorMessage(null);
        setUpdateStatus('checking');
        try {
            await window.electronAPI.checkForUpdates();
        } catch (error) {
            console.error("Failed to check for updates:", error);
            setUpdateErrorMessage(error instanceof Error ? error.message : 'Update check failed');
            setUpdateStatus('error');
            setTimeout(() => setUpdateStatus('idle'), 3000);
        }
    };

    const refreshCalendarEvents = React.useCallback(async (options: { allowWhenDisconnected?: boolean } = {}) => {
        if (!options.allowWhenDisconnected && !calendarStatus.connected) {
            setSettingsCalendarEvents([]);
            setCalendarLastSyncedAt(null);
            setCalendarSyncError(CALENDAR_REFRESH_GATE_MESSAGE);
            return;
        }

        if (!window.electronAPI?.googleGetCalendarEvents) {
            setSettingsCalendarEvents([]);
            setCalendarSyncError('Calendar refresh is unavailable in this build.');
            return;
        }

        setIsCalendarSyncing(true);
        setCalendarSyncError(null);
        try {
            const result = await window.electronAPI.googleGetCalendarEvents();
            if (result?.success) {
                setSettingsCalendarEvents(getUpcomingEvents(Array.isArray(result.events) ? result.events : []));
                setCalendarLastSyncedAt(new Date().toISOString());
                if (result.authState) {
                    setAuthUser(result.authState.user || null);
                    setCalendarStatus({
                        connected: Boolean(result.authState.calendarConnected),
                        email: result.authState.user?.email,
                    });
                }
            } else {
                setSettingsCalendarEvents([]);
                setCalendarSyncError(result?.error || 'Calendar sync failed.');
                if (result?.authState) {
                    setAuthUser(result.authState.user || null);
                    setCalendarStatus({
                        connected: Boolean(result.authState.calendarConnected),
                        email: result.authState.user?.email,
                    });
                } else if (result?.error === 'Calendar not connected') {
                    setCalendarStatus((status) => ({ connected: false, email: status.email }));
                }
            }
        } catch (error) {
            setSettingsCalendarEvents([]);
            setCalendarSyncError(error instanceof Error ? error.message : 'Calendar sync failed.');
        } finally {
            setIsCalendarSyncing(false);
        }
    }, [calendarStatus.connected]);

    const handleConnectCalendar = React.useCallback(async () => {
        setIsCalendarsLoading(true);
        try {
            const result = await window.electronAPI?.googleConnectCalendar?.(authUser?.email);
            if (result?.success && result.user?.calendarConnected) {
                setAuthUser(result.user);
                window.dispatchEvent(
                    new CustomEvent('teamsync:calendar-status-changed', { detail: { connected: true } })
                );
                setCalendarStatus({ connected: true, email: result.user.email });
                setCalendarSyncError(null);
                await refreshCalendarEvents({ allowWhenDisconnected: true });
            } else if (result?.error) {
                setCalendarSyncError(result.error);
                console.error(result.error);
            }
        } catch (e) {
            setCalendarSyncError(e instanceof Error ? e.message : 'Calendar connection failed.');
            console.error(e);
        } finally {
            setIsCalendarsLoading(false);
        }
    }, [authUser?.email, refreshCalendarEvents]);

    const handleDisconnectCalendar = React.useCallback(async () => {
        setIsCalendarsLoading(true);
        try {
            const result = await window.electronAPI?.googleDisconnectCalendar?.();
            if (result?.user) {
                setAuthUser(result.user);
            } else {
                setAuthUser((user) => user ? { ...user, calendarConnected: false } : user);
            }
            window.dispatchEvent(
                new CustomEvent('teamsync:calendar-status-changed', { detail: { connected: false } })
            );
            setCalendarStatus({ connected: false, email: result?.user?.email || authUser?.email });
            setSettingsCalendarEvents([]);
            setCalendarSyncError(null);
            setCalendarLastSyncedAt(null);
        } catch (e) {
            setCalendarSyncError(e instanceof Error ? e.message : 'Calendar disconnect failed.');
            console.error(e);
        } finally {
            setIsCalendarsLoading(false);
        }
    }, [authUser?.email]);

    useEffect(() => {
        if (!isOpen) return;

        const unsubs = [
            window.electronAPI.onUpdateChecking(() => {
                setUpdateErrorMessage(null);
                setUpdateStatus('checking');
            }),
            window.electronAPI.onUpdateAvailable((info) => {
                setUpdateErrorMessage(null);
                setLatestUpdateVersion(info?.version ?? null);
                setUpdateStatus('available');
                // Don't close settings - let user see the button change to "Update Available"
            }),
            window.electronAPI.onUpdateNotAvailable((info) => {
                setUpdateErrorMessage(null);
                setLatestUpdateVersion(info?.version ?? null);
                setUpdateStatus('uptodate');
                setTimeout(() => setUpdateStatus('idle'), 3000);
            }),
            window.electronAPI.onUpdateDownloaded((info) => {
                setLatestUpdateVersion(info?.version ?? null);
                refreshUpdaterCacheInfo();
            }),
            window.electronAPI.onUpdateError((err) => {
                console.error('[Settings] Update error:', err);
                setUpdateErrorMessage(err || 'Update check failed');
                setUpdateStatus('error');
                setTimeout(() => setUpdateStatus('idle'), 3000);
            })
        ];

        return () => unsubs.forEach(unsub => unsub());
    }, [isOpen, onClose, refreshUpdaterCacheInfo]);



    useEffect(() => {
        if (isOpen) {
            // Load detectable status
            if (window.electronAPI?.getUndetectable) {
                window.electronAPI.getUndetectable().then(setIsUndetectable);
            }
            if (window.electronAPI?.getOpenAtLogin) {
                window.electronAPI.getOpenAtLogin().then(setOpenOnLogin);
            }
            if (window.electronAPI?.getThemeMode) {
                window.electronAPI.getThemeMode().then(({ mode }) => setThemeMode(mode));
            }

            // Load settings
            const loadDevices = async () => {
                try {
                    const [inputs, outputs] = await Promise.all([
                        // @ts-ignore
                        window.electronAPI?.getInputDevices() || Promise.resolve([]),
                        // @ts-ignore
                        window.electronAPI?.getOutputDevices() || Promise.resolve([])
                    ]);

                    // Map to shape compatible with CustomSelect (which expects MediaDeviceInfo-like objects)
                    const formatDevices = (devs: any[]) => devs.map(d => ({
                        deviceId: d.id,
                        label: d.name,
                        kind: 'audioinput' as MediaDeviceKind,
                        groupId: '',
                        toJSON: () => d
                    }));

                    setInputDevices(formatDevices(inputs));
                    setOutputDevices(formatDevices(outputs));

                    // Load saved preferences
                    const savedInput = localStorage.getItem('preferredInputDeviceId');
                    const savedOutput = localStorage.getItem('preferredOutputDeviceId');

                    if (savedInput && inputs.find((d: any) => d.id === savedInput)) {
                        setSelectedInput(savedInput);
                    } else if (inputs.length > 0 && !selectedInput) {
                        setSelectedInput(inputs[0].id);
                    }

                    if (savedOutput && outputs.find((d: any) => d.id === savedOutput)) {
                        setSelectedOutput(savedOutput);
                    } else if (outputs.length > 0 && !selectedOutput) {
                        setSelectedOutput(outputs[0].id);
                    }
                } catch (e) {
                    console.error("Error loading native devices:", e);
                }
            };
            loadDevices();

            // Load Experimental SCK pref
            const savedSck = localStorage.getItem('useExperimentalSckBackend') === 'true';
            setUseExperimentalSck(savedSck);

            // Load Calendar Status from main-process hosted auth state.
            window.electronAPI?.googleVerifySession?.()
                .then((result) => {
                    const state = result?.authState;
                    setAuthUser(state?.user || null);
                    setCalendarStatus({
                        connected: Boolean(state?.calendarConnected),
                        email: state?.user?.email,
                    });
                    setCalendarLastSyncedAt(new Date().toISOString());
                })
                .catch(() => {
                    window.electronAPI?.googleGetAuthState?.()
                        .then((state) => {
                            setAuthUser(state?.user || null);
                            setCalendarStatus({
                                connected: Boolean(state?.calendarConnected),
                                email: state?.user?.email,
                            });
                            setCalendarLastSyncedAt(new Date().toISOString());
                        })
                        .catch(() => {
                            setAuthUser(null);
                            setCalendarStatus({ connected: false });
                            setSettingsCalendarEvents([]);
                            setCalendarLastSyncedAt(null);
                        });
                });

            // Listen for calendar status changes from other views (Launcher <-> Settings sync)
            const unsubCalendar = window.electronAPI?.onCalendarStatusChanged?.((status) => {
                setCalendarStatus({ connected: status.connected, email: status.email || undefined });
                setAuthUser((user) => user ? { ...user, calendarConnected: status.connected } : user);
                setCalendarLastSyncedAt(new Date().toISOString());
                if (!status.connected) {
                    setSettingsCalendarEvents([]);
                    setCalendarSyncError(null);
                }
                window.dispatchEvent(
                    new CustomEvent('teamsync:calendar-status-changed', { detail: { connected: status.connected } })
                );
            });
            const unsubAuthLoggedOut = window.electronAPI?.onAuthLoggedOut?.(() => {
                localStorage.removeItem('teamsync_auth_token');
                localStorage.removeItem('teamsync_auth_user');
                setAuthUser(null);
                setCalendarStatus({ connected: false });
                setSettingsCalendarEvents([]);
                setCalendarLastSyncedAt(null);
                setCalendarSyncError(null);
            });

            return () => {
                unsubCalendar?.();
                unsubAuthLoggedOut?.();
            };
        }
    }, [isOpen, selectedInput, selectedOutput]); // Re-run if isOpen changes, or if selected devices are cleared

    useEffect(() => {
        if (!isOpen) return;
        if (!calendarStatus.connected) {
            setSettingsCalendarEvents([]);
            setCalendarSyncError(null);
            return;
        }
        refreshCalendarEvents().catch(() => { });
    }, [calendarStatus.connected, isOpen, refreshCalendarEvents]);

    // Use the native mic test path so device IDs stay consistent with the meeting runtime.
    // Gated behind micTestActive to prevent eager mic activation (macOS orange indicator).
    useEffect(() => {
        if (isOpen && activeTab === 'audio' && micTestActive) {
            const unsubscribe = window.electronAPI?.onAudioTestLevel?.((level) => {
                setMicLevel(Math.max(0, Math.min(100, level * 100)));
            });

            window.electronAPI?.startAudioTest(selectedInput || undefined).catch((error) => {
                console.error("Error starting native microphone test:", error);
                setMicLevel(0);
            });

            return () => {
                unsubscribe?.();
                window.electronAPI?.stopAudioTest?.().catch((error) => {
                    console.error("Error stopping native microphone test:", error);
                });
                setMicLevel(0);
            };
        } else {
            setMicLevel(0);
            window.electronAPI?.stopAudioTest?.().catch((error) => {
                console.error("Error stopping native microphone test:", error);
            });
        }
    }, [isOpen, activeTab, selectedInput, micTestActive]);

    // Stop mic test when leaving the audio tab or closing settings
    useEffect(() => {
        if (!isOpen || activeTab !== 'audio') {
            setMicTestActive(false);
        }
    }, [isOpen, activeTab]);

    const sttProviderOptions: ProviderOption[] = [
        { id: 'deepgram', label: 'Deepgram Nova-3', badge: hasStoredDeepgramKey ? 'Saved' : 'Default', recommended: true, desc: 'Primary realtime STT with live fallback to Google and Whisper.', color: 'purple', icon: <Mic size={14} /> },
        { id: 'groq', label: 'Groq Whisper', badge: hasStoredSttGroqKey ? 'Saved' : null, desc: 'Fast Whisper transcription with the same live fallback chain.', color: 'orange', icon: <Mic size={14} /> },
        { id: 'openai', label: 'OpenAI Transcribe', badge: hasStoredSttOpenaiKey ? 'Saved' : null, desc: 'OpenAI realtime transcription backed by Google and Whisper failover.', color: 'green', icon: <Mic size={14} /> },
        { id: 'elevenlabs', label: 'ElevenLabs Scribe', badge: hasStoredElevenLabsKey ? 'Saved' : null, desc: 'Realtime Scribe transcription with the standard fallback path.', color: 'teal', icon: <Mic size={14} /> },
        { id: 'azure', label: 'Azure Speech', badge: hasStoredAzureKey ? 'Saved' : null, desc: 'Microsoft Speech with the same Google and Whisper fallback chain.', color: 'blue', icon: <Mic size={14} /> },
        { id: 'ibmwatson', label: 'IBM Watson', badge: hasStoredIbmWatsonKey ? 'Saved' : null, desc: 'IBM cloud STT with the same runtime recovery path.', color: 'indigo', icon: <Mic size={14} /> },
        { id: 'soniox', label: 'Soniox', badge: hasStoredSonioxKey ? 'Saved' : null, desc: 'Realtime Soniox transcription with Google and Whisper fallback.', color: 'cyan', icon: <Mic size={14} /> },
        { id: 'google', label: 'Google Cloud', badge: googleServiceAccountPath ? 'Saved' : 'Fallback', desc: 'Streaming Google STT used directly or as the first recovery provider.', color: 'blue', icon: <Mic size={14} /> },
        ...(hasTeamSyncKey ? [{
            id: 'teamsync',
            label: 'TeamSync Managed',
            badge: 'Saved',
            desc: 'Managed TeamSync transcription with live fallback behind it.',
            color: 'green',
            icon: <Mic size={14} />,
        } as ProviderOption] : []),
        { id: 'whisper', label: 'Local Whisper', badge: 'Fallback', desc: 'Last-resort local recovery path before degraded mode.', color: 'cyan', icon: <Mic size={14} /> },
    ];

    const sttFallbackChainLabel = (() => {
        const selected = sttProviderOptions.find((option) => option.id === sttProvider)?.label || 'Selected Provider';
        if (sttProvider === 'none') return 'STT disabled.';
        if (sttProvider === 'whisper') return 'Runtime path: Whisper only.';
        if (sttProvider === 'google') return 'Runtime path: Google Cloud → Whisper.';
        return `Runtime path: ${selected} → Google Cloud → Whisper.`;
    })();

    const renderSttApiKeyCard = ({
        provider,
        label,
        value,
        onChange,
        hasStoredKey,
        maskedKey,
        placeholder,
        docsUrl,
        extraFields,
        helperText,
    }: {
        provider: ExternalSttKeyProvider;
        label: string;
        value: string;
        onChange: (value: string) => void;
        hasStoredKey: boolean;
        maskedKey?: string | null;
        placeholder: string;
        docsUrl: string;
        extraFields?: React.ReactNode;
        helperText?: string;
    }) => (
        <div className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-3">
            <label className="text-xs font-medium text-text-secondary block">{label}</label>
            {extraFields}
            <div className="flex gap-2">
                <input
                    type="password"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={hasStoredKey ? (maskedKey || '••••••••••••') : placeholder}
                    className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
                />
                <button
                    onClick={() => handleSttKeySubmit(provider, value)}
                    disabled={sttSaving || !value.trim()}
                    className={`px-5 py-2.5 rounded-lg text-xs font-medium transition-colors ${sttSaved
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-bg-input hover:bg-bg-input/80 border border-border-subtle text-text-primary disabled:opacity-50'
                        }`}
                >
                    {sttSaving ? 'Saving...' : sttSaved ? 'Saved!' : 'Save'}
                </button>
                {hasStoredKey ? (
                    <button
                        onClick={() => handleRemoveSttKey(provider)}
                        className="px-2.5 py-2.5 rounded-lg text-xs font-medium text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-all"
                        title="Remove API Key"
                    >
                        <Trash2 size={16} strokeWidth={1.5} />
                    </button>
                ) : null}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
                <button
                    onClick={handleTestSttConnection}
                    disabled={sttTestStatus === 'testing'}
                    className="text-xs bg-bg-input hover:bg-bg-elevated text-text-primary px-3 py-1.5 rounded-md transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                    {sttTestStatus === 'testing' ? (
                        <><RefreshCw size={12} className="animate-spin" /> Testing...</>
                    ) : sttTestStatus === 'success' ? (
                        <><Check size={12} className="text-green-500" /> Connected</>
                    ) : (
                        <>Test Connection</>
                    )}
                </button>
                <button
                    onClick={() => {
                        // @ts-ignore
                        window.electronAPI?.openExternal(docsUrl);
                    }}
                    className="text-xs text-text-tertiary hover:text-text-primary flex items-center gap-1 transition-colors"
                    title="Get API Key"
                >
                    <ExternalLink size={12} />
                </button>
                {sttTestStatus === 'error' && (
                    <span className="text-xs text-red-400">{sttTestError}</span>
                )}
            </div>

            {helperText ? (
                <p className="text-[10px] text-text-tertiary">{helperText}</p>
            ) : null}
        </div>
    );

    const updateDiagnosticsFile = updaterCacheInfo?.downloadedFiles[0] ?? null;
    const updateDiagnosticsCacheDir = updaterCacheInfo?.cacheDir || 'Not resolved yet';
    const updateDiagnosticsFileName = updateDiagnosticsFile?.fileName || 'No downloaded update found';
    const updateDiagnosticsFilePath = updateDiagnosticsFile?.path || 'No downloaded update found';
    const updateDiagnosticsSize = formatUpdaterBytes(updateDiagnosticsFile?.size ?? updaterCacheInfo?.totalSize ?? 0);
    const updateDiagnosticsCurrentVersion = updaterCacheInfo?.currentVersion || packageJson.version;
    const updateDiagnosticsLatestVersion = latestUpdateVersion || updaterCacheInfo?.latestVersion || 'Unknown';
    const sttProviderLabel = sttProviderOptions.find((option) => option.id === sttProvider)?.label || 'Speech provider';
    const selectedInputLabel = inputDevices.find((device) => device.deviceId === selectedInput)?.label || 'System default microphone';
    const calendarIdentity = calendarStatus.email || authUser?.email || 'Google Calendar';
    const nextSettingsCalendarEvent = settingsCalendarEvents[0] ?? null;
    const permissionLastCheckedLabel = permissionsChecking
        ? 'Checking now'
        : permissionsInitialized
            ? formatTrustTimestamp(permissionStatus?.checkedAt)
            : 'Not checked yet';
    const calendarLastSyncLabel = isCalendarSyncing
        ? 'Checking now'
        : calendarStatus.connected
            ? formatTrustTimestamp(calendarLastSyncedAt)
            : 'Not connected';
    const screenRecordingTrustState = getPermissionTrustState(
        permissionStatus?.screenRecording,
        Boolean(permissionStatus?.restartRequired)
    );
    const accessibilityTrustState = getPermissionTrustState(permissionStatus?.accessibility);
    const microphoneTrustState: TrustState = sttProvider === 'none'
        ? 'disabled'
        : getPermissionTrustState(permissionStatus?.microphone);
    const calendarTrustState: TrustState = calendarStatus.connected ? 'healthy' : 'needs_attention';
    const stealthTrustState: TrustState = isUndetectable ? 'healthy' : 'disabled';
    const trustReadinessItems = [
        {
            id: 'screen-recording',
            label: 'Screen Recording',
            state: screenRecordingTrustState,
            detail: permissionStatus?.restartRequired
                ? 'Restart TeamSync to finish applying screen access.'
                : 'Lets TeamSync read visible meeting context when you ask for help.',
            icon: <Monitor size={16} />,
        },
        {
            id: 'accessibility',
            label: 'Accessibility',
            state: accessibilityTrustState,
            detail: 'Keeps global shortcuts and overlay controls reliable during calls.',
            icon: <Keyboard size={16} />,
        },
        {
            id: 'microphone',
            label: 'Microphone',
            state: microphoneTrustState,
            detail: sttProvider === 'none'
                ? 'Speech capture is disabled in Audio settings.'
                : `${sttProviderLabel} listens through ${selectedInputLabel}.`,
            icon: <Mic size={16} />,
        },
        {
            id: 'calendar',
            label: 'Calendar',
            state: calendarTrustState,
            detail: calendarStatus.connected
                ? `Connected as ${calendarIdentity}.`
                : 'Connect Calendar for meeting-aware preparation.',
            icon: <Calendar size={16} />,
        },
        {
            id: 'stealth',
            label: 'Stealth Status',
            state: stealthTrustState,
            detail: isUndetectable
                ? 'Privacy during screen sharing is active.'
                : 'Screen sharing privacy is currently disabled.',
            icon: <Ghost size={16} />,
        },
    ];
    const trustHealthyCount = trustReadinessItems.filter((item) => item.state === 'healthy').length;
    const trustNeedsAttentionCount = trustReadinessItems.filter((item) => item.state === 'needs_attention').length;
    const trustStatusLabel = trustNeedsAttentionCount > 0
        ? `${trustNeedsAttentionCount} needs attention`
        : `${trustHealthyCount}/${trustReadinessItems.length} healthy`;
    const trustSidebarLabel = trustNeedsAttentionCount > 0
        ? `${trustNeedsAttentionCount} needs`
        : `${trustHealthyCount}/${trustReadinessItems.length}`;
    const permissionChecklistItems: Array<{
        id: PermissionKind;
        label: string;
        state: TrustState;
        why: string;
        unlocks: string;
        fix: string;
        icon: React.ReactNode;
    }> = [
        {
            id: 'screenRecording',
            label: 'Screen Recording',
            state: screenRecordingTrustState,
            why: 'TeamSync needs permission before it can inspect the screen you are already viewing.',
            unlocks: 'Screen-aware answers, code context, and visible-meeting notes.',
            fix: permissionStatus?.restartRequired
                ? 'Restart TeamSync after macOS finishes granting access.'
                : 'Open Privacy & Security and allow TeamSync under Screen Recording.',
            icon: <Monitor size={16} />,
        },
        {
            id: 'accessibility',
            label: 'Accessibility',
            state: accessibilityTrustState,
            why: 'TeamSync uses this to keep keyboard controls available while another app is focused.',
            unlocks: 'Reliable show, hide, capture, movement, and recovery shortcuts.',
            fix: 'Open Accessibility settings and allow TeamSync.',
            icon: <Keyboard size={16} />,
        },
        {
            id: 'microphone',
            label: 'Microphone',
            state: getPermissionTrustState(permissionStatus?.microphone),
            why: 'TeamSync listens to your selected microphone only when capture is active.',
            unlocks: 'Live transcript, better meeting memory, and speech-aware suggestions.',
            fix: 'Allow microphone access, then test your input in Audio settings.',
            icon: <Mic size={16} />,
        },
    ];
    const handleToggleUndetectable = () => {
        const newState = !isUndetectable;
        setIsUndetectable(newState);
        window.electronAPI?.setUndetectable(newState);
        analytics.trackModeSelected(newState ? 'undetectable' : 'overlay');
    };
    const handleToggleMousePassthrough = () => {
        const newState = !isMousePassthrough;
        setIsMousePassthrough(newState);
        window.electronAPI?.setOverlayMousePassthrough(newState);
    };
    const handlePermissionAction = (permission: PermissionKind) => {
        if (permissionStatus?.[permission] === 'not_requested') {
            requestPermission(permission).catch(() => { });
            return;
        }
        openPermissionSettings(permission).catch(() => { });
    };
    const handleSelectResume = async () => {
        let uploadGenerationId = 0;
        setProfileError('');
        try {
            const fileResult = await window.electronAPI?.profileSelectFile?.();
            if (fileResult?.cancelled || !fileResult?.fileToken) return;

            setLastResumeFileToken(fileResult.fileToken);
            setLastUploadKind('resume');
            uploadGenerationId = Date.now();
            uploadGenerationRef.current = uploadGenerationId;
            profileHardDeleteUiGuardRef.current = false;
            setProfileUploading(true);
            updateProfileViewStatus('processing');
            setProfileData(null);
            profileGenerationRef.current = 0;
            setNegotiationScript(null);
            setProfileStatus({
                hasProfile: false,
                profileMode: false,
                isReady: false
            });
            const result = await window.electronAPI?.profileUploadResume?.(fileResult.fileToken);
            if (uploadGenerationRef.current !== uploadGenerationId) return;
            if (result?.success) {
                await refreshProfileStateRef.current?.(uploadGenerationId);
            } else if (result?.error === 'STALE_GENERATION') {
                return;
            } else {
                updateProfileViewStatus('error');
                setProfileError(result?.error || 'Upload failed');
            }
        } catch (e: any) {
            updateProfileViewStatus('error');
            setProfileError(e.message || 'Upload failed');
        } finally {
            if (uploadGenerationRef.current === uploadGenerationId) {
                setProfileUploading(false);
            }
        }
    };
    const openSettingsSection = (tab: string) => {
        setActiveTab(tab);
        if (tab === 'profile') {
            refreshProfileStateRef.current?.().catch(() => { });
            window.electronAPI?.profileGetNotes?.().then(res => {
                if (res?.success) setCustomNotes(res.content ?? '');
            }).catch(() => { });
        }
    };
    const todayReadinessItems = [
        {
            id: 'calendar',
            label: 'Calendar',
            title: calendarStatus.connected ? 'Calendar context is connected' : 'Calendar context is not connected',
            detail: calendarStatus.connected ? calendarIdentity : 'Connect Google Calendar for meeting-aware context.',
            status: calendarStatus.connected ? 'Connected' : 'Needs setup',
            ready: calendarStatus.connected,
            tab: 'calendar',
            icon: <Calendar size={16} />,
        },
        {
            id: 'audio',
            label: 'Audio',
            title: sttProvider === 'none' ? 'Speech capture is disabled' : `${sttProviderLabel} is selected`,
            detail: selectedInputLabel,
            status: sttProvider === 'none' ? 'Off' : 'Ready',
            ready: sttProvider !== 'none',
            tab: 'audio',
            icon: <Mic size={16} />,
        },
        {
            id: 'privacy',
            label: 'Privacy',
            title: isUndetectable ? 'Screen sharing privacy is on' : 'Overlay is visible to screen sharing',
            detail: isMousePassthrough ? 'Mouse passthrough is enabled.' : 'Mouse passthrough is off.',
            status: isUndetectable ? 'Private' : 'Visible',
            ready: isUndetectable,
            tab: 'privacy-trust',
            icon: <Ghost size={16} />,
        },
        {
            id: 'profile',
            label: 'Profile',
            title: profileStatus.hasProfile ? 'Profile intelligence is prepared' : 'Profile intelligence is not initialized',
            detail: profileStatus.profileMode ? 'Personal context is active.' : 'Upload a resume to personalize responses.',
            status: profileStatus.hasProfile ? (profileStatus.profileMode ? 'Active' : 'Ready') : 'Optional',
            ready: profileStatus.hasProfile,
            tab: 'profile',
            icon: <User size={16} />,
        },
    ];
    const readyTodayCount = todayReadinessItems.filter((item) => item.ready).length;
    const todayStatusLabel = readyTodayCount === todayReadinessItems.length
        ? 'Ready for today'
        : `${readyTodayCount}/${todayReadinessItems.length} ready`;
    const settingsHeaderBadge = isPremium
        ? {
            label: 'Activated',
            className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500',
        }
        : isTrialActive
            ? {
                label: 'Trial active',
                className: 'border-sky-500/25 bg-sky-500/10 text-sky-500',
            }
            : {
                label: todayStatusLabel,
                className: 'border-border-subtle bg-bg-item-active text-text-secondary',
            };
    const overviewQuickLinks = [
        {
            id: 'interface',
            label: 'Interface',
            detail: `Theme follows ${themeMode === 'system' ? 'system' : themeMode}. Opacity is ${Math.round(overlayOpacity * 100)}%.`,
            tab: 'general',
            icon: <SlidersHorizontal size={16} />,
        },
        {
            id: 'shortcuts',
            label: 'Shortcuts',
            detail: 'Review global commands for visibility, capture, and movement.',
            tab: 'keybinds',
            icon: <Keyboard size={16} />,
        },
        {
            id: 'startup',
            label: 'Startup',
            detail: openOnLogin ? 'TeamSync opens when you log in.' : 'Manual launch is currently selected.',
            tab: 'general',
            icon: <Power size={16} />,
        },
    ];
    type SettingsSidebarItem = {
        id: string;
        label: string;
        icon: React.ReactNode;
        meta?: string;
    };
    const sidebarGroups: Array<{ label: string; items: SettingsSidebarItem[] }> = [
        {
            label: 'Today',
            items: [
                { id: 'overview', label: 'Overview', icon: <Activity size={16} /> },
                { id: 'privacy-trust', label: 'Privacy & Trust', icon: <BadgeCheck size={16} /> },
            ],
        },
        {
            label: 'Workspace',
            items: [
                { id: 'general', label: 'General', icon: <Monitor size={16} /> },
                { id: 'audio', label: 'Audio', icon: <Mic size={16} /> },
                { id: 'keybinds', label: 'Keybinds', icon: <Keyboard size={16} /> },
            ],
        },
        {
            label: 'Intelligence',
            items: [
                { id: 'profile', label: 'Profile Intelligence', icon: <User size={16} /> },
                { id: 'calendar', label: 'Calendar', icon: <Calendar size={16} />, meta: calendarStatus.connected ? 'Connected' : undefined },
                { id: 'ai-providers', label: 'AI Providers', icon: <FlaskConical size={16} /> },
            ],
        },
        {
            label: 'Account',
            items: [
                { id: 'account', label: 'Account', icon: <User size={16} /> },
            ],
        },
        {
            label: 'Support',
            items: [
                { id: 'help', label: 'Setup & Help', icon: <HelpCircle size={16} /> },
                { id: 'about', label: 'About', icon: <Info size={16} /> },
            ],
        },
    ];
    const settingsMotionEase = [0.22, 1, 0.36, 1] as const;
    const sectionMotionProps = shouldReduceMotion
        ? {
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            exit: { opacity: 0 },
            transition: { duration: 0.12 },
        }
        : {
            initial: { opacity: 0, y: 6 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -6 },
            transition: { duration: 0.18, ease: settingsMotionEase },
        };
    const sidebarIndicatorTransition = shouldReduceMotion
        ? { duration: 0 }
        : { type: 'spring' as const, stiffness: 520, damping: 42, mass: 0.75 };
    const switchTransition = shouldReduceMotion
        ? { duration: 0 }
        : { type: 'spring' as const, stiffness: 560, damping: 34, mass: 0.72 };
    const statusChipBaseClass = 'inline-flex h-6 shrink-0 items-center justify-center overflow-hidden rounded-full border px-2.5 text-[10px] font-semibold leading-none whitespace-nowrap';
    const skeletonLineClass = 'rounded-full bg-bg-input/80 animate-pulse';
    const getSwitchTrackClass = (checked: boolean, tone: 'accent' | 'sky' | 'purple' | 'amber' = 'accent') => {
        if (!checked) return 'bg-bg-toggle-switch border border-border-muted';
        if (tone === 'sky') return 'bg-sky-500';
        if (tone === 'purple') return 'bg-purple-500';
        if (tone === 'amber') return 'bg-amber-500';
        return 'bg-accent-primary';
    };
    const renderSettingsSwitch = ({
        checked,
        onToggle,
        label,
        tone = 'accent',
        disabled = false,
        size = 'default',
    }: {
        checked: boolean;
        onToggle: () => void;
        label: string;
        tone?: 'accent' | 'sky' | 'purple' | 'amber';
        disabled?: boolean;
        size?: 'default' | 'small';
    }) => {
        const isSmall = size === 'small';
        const thumbSize = isSmall ? 'h-3 w-3' : 'h-4 w-4';
        const trackSize = isSmall ? 'h-5 w-9' : 'h-6 w-11';
        const thumbOffset = isSmall ? 16 : 20;

        return (
            <motion.button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={label}
                onClick={disabled ? undefined : onToggle}
                disabled={disabled}
                whileTap={shouldReduceMotion || disabled ? undefined : { scale: 0.97 }}
                className={`relative shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent-primary/25 disabled:cursor-not-allowed disabled:opacity-50 ${trackSize} ${getSwitchTrackClass(checked, tone)}`}
            >
                <motion.span
                    className={`absolute left-1 top-1 rounded-full bg-white shadow-sm ${thumbSize}`}
                    animate={{ x: checked ? thumbOffset : 0 }}
                    transition={switchTransition}
                />
            </motion.button>
        );
    };

    const renderDeleteProfileIntelligenceCard = (surface: 'profile' | 'privacy-trust') => (
        <section
            data-profile-delete-surface={surface}
            className="rounded-xl border border-red-500/20 bg-red-500/5 p-5"
        >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-400">
                            <Trash2 size={16} />
                        </span>
                        <div className="min-w-0">
                            <h4 className="text-[14px] font-semibold text-text-primary">Delete Profile Intelligence</h4>
                            <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">
                                Permanently removes profile data and generated intelligence from this device.
                            </p>
                        </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                        {deleteProfileScopeItems.map((item) => (
                            <span
                                key={item}
                                className="rounded-md border border-red-500/15 bg-bg-input/60 px-2 py-1 text-[10px] font-medium text-text-secondary"
                            >
                                {item}
                            </span>
                        ))}
                    </div>
                    {deleteProfileStatus && (
                        <div
                            className={`mt-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-medium ${deleteProfileStatus.variant === 'success'
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500'
                                : 'border-red-500/25 bg-red-500/10 text-red-400'
                                }`}
                            role="status"
                        >
                            {deleteProfileStatus.variant === 'success' ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
                            {deleteProfileStatus.message}
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    onClick={openDeleteProfileConfirmation}
                    disabled={deleteProfileDeleting}
                    className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3.5 py-2 text-[12px] font-semibold text-red-400 transition-all hover:bg-red-500/15 hover:text-red-300 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 sm:w-auto"
                >
                    {deleteProfileDeleting ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    {deleteProfileDeleting ? 'Deleting...' : 'Delete Profile Intelligence'}
                </button>
            </div>
        </section>
    );

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    id="settings-backdrop"
                    className={`fixed inset-0 z-[3000] flex items-center justify-center p-4 transition-colors duration-150 sm:p-6 lg:p-8 ${isPreviewingOpacity ? 'bg-transparent backdrop-blur-none' : 'bg-black/60 backdrop-blur-sm'}`}
                >
                    <motion.div
                        id="settings-panel-wrapper"
                        initial={{ scale: 0.94, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.94, opacity: 0, y: 20 }}
                        transition={{
                            type: "spring",
                            stiffness: 400,
                            damping: 32,
                            mass: 1
                        }}
                        className="relative h-[74vh] max-h-[680px] w-[84vw] max-w-[860px] overflow-hidden rounded-[22px] border border-border-subtle bg-bg-elevated shadow-[0_28px_88px_rgba(0,0,0,0.40),inset_0_1px_0_rgba(255,255,255,0.06)]"
                    >
                        <div
                            id="settings-panel"
                            className="relative z-10 flex h-full w-full min-w-0"
                            style={{ visibility: isPreviewingOpacity ? 'hidden' : 'visible' }}
                        >
                            <div
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_0%,rgba(59,130,246,0.10),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_26%)]"
                            />
                            <div
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
                            />
                            {/* Sidebar */}
                            <div className="flex w-[210px] shrink-0 flex-col border-r border-white/10 bg-black text-white">
                                <div className="px-4 pt-4 pb-3 border-b border-white/10">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white">TeamSync</p>
                                    <div className="mt-1.5 flex items-center justify-between gap-3">
                                        <h2 className="text-[17px] font-semibold tracking-tight text-white">Settings</h2>
                                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${settingsHeaderBadge.className} !text-white`}>
                                            {isPremium && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                                            {settingsHeaderBadge.label}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-y-auto px-2.5 py-3.5">
                                    <nav className="space-y-4" aria-label="Settings sections">
                                        {sidebarGroups.map((group) => (
                                            <div key={group.label}>
                                                <div className="px-2 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white">
                                                    {group.label}
                                                </div>
                                                <div className="space-y-0.5">
                                                    {group.items.map((item) => {
                                                        const isActive = activeTab === item.id;
                                                        return (
                                                            <button
                                                                key={item.id}
                                                                onClick={() => openSettingsSection(item.id)}
                                                                aria-current={isActive ? 'page' : undefined}
                                                                className={`group relative w-full overflow-hidden rounded-xl px-2.5 py-2.5 text-left text-[12.5px] font-medium transition-colors duration-200 flex items-center gap-2.5 active:scale-[0.99] ${isActive
                                                                    ? 'text-white'
                                                                    : 'text-white hover:bg-white/10'
                                                                    }`}
                                                            >
                                                                {isActive && (
                                                                    <motion.span
                                                                        layoutId="settings-sidebar-active"
                                                                        className="absolute inset-0 rounded-xl border border-white/15 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]"
                                                                        transition={sidebarIndicatorTransition}
                                                                    />
                                                                )}
                                                                <span className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white transition-colors ${isActive ? 'bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' : 'group-hover:bg-white/10'}`}>
                                                                    {item.icon}
                                                                </span>
                                                                <span className="relative z-10 min-w-0 flex-1 truncate">{item.label}</span>
                                                                {item.meta && (
                                                                    <span className={`relative z-10 max-w-[72px] truncate ${statusChipBaseClass} ${isActive ? 'border-white/20 bg-white/10 text-white' : 'border-white/15 bg-white/10 text-white'}`}>
                                                                        {item.meta}
                                                                    </span>
                                                                )}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </nav>
                                </div>

                                <div className="mt-auto p-4 border-t border-white/10">

                                    <AnimatePresence mode="wait" initial={false}>
                                        {showQuitConfirm ? (
                                            <motion.div
                                                key="quit-confirm"
                                                initial={{ opacity: 0, y: 4 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: 4 }}
                                                transition={{ duration: 0.15 }}
                                                className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-2"
                                            >
                                                <div className="flex items-center gap-2 text-[13px] font-semibold text-red-400">
                                                    <AlertCircle size={15} />
                                                    Meeting in progress
                                                </div>
                                                <p className="text-[12px] text-white mt-1">
                                                    Quitting will end the active session and stop recording.
                                                </p>
                                                <div className="flex justify-end gap-2 mt-3">
                                                    <button
                                                        onClick={() => setShowQuitConfirm(false)}
                                                        className="text-[12px] px-3 py-1.5 text-white hover:bg-white/10 transition-colors rounded-lg"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        onClick={() => window.electronAPI.quitApp()}
                                                        className="text-[12px] px-3 py-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg font-medium transition-colors"
                                                    >
                                                        Quit Anyway
                                                    </button>
                                                </div>
                                            </motion.div>
                                        ) : (
                                            <motion.button
                                                key="quit-button"
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                exit={{ opacity: 0 }}
                                                transition={{ duration: 0.1 }}
                                                onClick={async () => {
                                                    // Query meeting state directly via IPC
                                                    let isActive = false;
                                                    try {
                                                        isActive = await window.electronAPI?.getMeetingActive?.() ?? false;
                                                    } catch { /* fallback to false */ }
                                                    if (isActive) {
                                                        setShowQuitConfirm(true);
                                                    } else {
                                                        window.electronAPI.quitApp();
                                                    }
                                                }}
                                                className="w-full text-left px-3 py-2 mt-1 rounded-xl text-[13px] font-medium text-white hover:bg-white/10 transition-colors flex items-center gap-3"
                                            >
                                                <LogOut size={16} className="text-red-400" /> Quit TeamSync
                                            </motion.button>
                                        )}
                                    </AnimatePresence>
                                    <button onClick={onClose} className="group mt-2 w-full text-left px-3 py-2 rounded-xl text-[13px] font-medium text-white hover:bg-white/10 transition-colors flex items-center gap-3">
                                        <X size={18} className="text-white group-hover:text-red-400 transition-colors" /> Close
                                    </button>
                                </div>
                            </div>

                            {/* Content */}
                            <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-bg-main px-5 py-5 sm:px-6 lg:px-7">
                                <AnimatePresence mode="wait" initial={false}>
                                    <motion.div
                                        key={activeTab}
                                        {...sectionMotionProps}
                                        className="mx-auto min-h-full min-w-0 max-w-[720px]"
                                    >
                                {activeTab === 'overview' && (
                                    <div className="space-y-5 animated fadeIn select-text pb-4">
                                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                            <div className="min-w-0">
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">Today</p>
                                                <h3 className="mt-1 text-[23px] font-semibold tracking-tight text-text-primary">Control center</h3>
                                                <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-text-secondary">
                                                    A quick read on whether TeamSync is ready for meetings, capture, and screen sharing.
                                                </p>
                                            </div>
                                            <div className="shrink-0 self-start rounded-2xl border border-border-subtle bg-bg-card px-4 py-3 text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">Readiness</p>
                                                <p className="mt-1 text-[18px] font-semibold tabular-nums text-text-primary">{readyTodayCount}/{todayReadinessItems.length}</p>
                                            </div>
                                        </div>

                                        <div className="overflow-hidden rounded-2xl border border-border-subtle bg-bg-card shadow-[0_12px_32px_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.05)]">
                                            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="flex items-start gap-3">
                                                    <div className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl border ${readyTodayCount === todayReadinessItems.length ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/20 bg-amber-500/10 text-amber-400'}`}>
                                                        {readyTodayCount === todayReadinessItems.length ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                                                    </div>
                                                    <div>
                                                        <h4 className="text-[15px] font-semibold text-text-primary">{todayStatusLabel}</h4>
                                                        <p className="mt-1 max-w-[520px] text-[12px] leading-relaxed text-text-secondary">
                                                            {calendarStatus.connected
                                                                ? 'Calendar context is available. Review the remaining controls before a live session.'
                                                                : 'Connect Calendar when you want TeamSync to understand upcoming meetings and attendees.'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => openSettingsSection(calendarStatus.connected ? 'general' : 'calendar')}
                                                    className="shrink-0 rounded-full border border-border-subtle bg-bg-input px-3.5 py-2 text-[12px] font-semibold text-text-primary transition-all hover:bg-bg-elevated active:scale-[0.98]"
                                                >
                                                    {calendarStatus.connected ? 'Review controls' : 'Connect calendar'}
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-1 divide-y divide-border-subtle border-t border-border-subtle xl:grid-cols-2 xl:divide-x xl:divide-y-0">
                                                {todayReadinessItems.map((item) => (
                                                    <button
                                                        key={item.id}
                                                        onClick={() => openSettingsSection(item.tab)}
                                                        className="group flex min-h-[112px] items-start gap-3 p-4 text-left transition-colors hover:bg-bg-input/40 sm:p-5"
                                                    >
                                                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors ${item.ready ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border-border-subtle bg-bg-input text-text-tertiary group-hover:text-text-primary'}`}>
                                                            {item.icon}
                                                        </span>
                                                        <span className="min-w-0 flex-1">
                                                            <span className="flex items-center justify-between gap-3">
                                                                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{item.label}</span>
                                                                <span className={`${statusChipBaseClass} ${item.ready ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border-border-subtle bg-bg-input text-text-tertiary'}`}>
                                                                    {item.status}
                                                                </span>
                                                            </span>
                                                            <span className="mt-2 block text-[13px] font-semibold text-text-primary">{item.title}</span>
                                                            <span className="mt-1 block text-[12px] leading-relaxed text-text-secondary">{item.detail}</span>
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 gap-3">
                                            <section className="rounded-2xl border border-border-subtle bg-bg-card p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                                                <div className="flex items-center justify-between gap-4">
                                                    <div>
                                                        <h4 className="text-[14px] font-semibold text-text-primary">Daily workspace</h4>
                                                        <p className="mt-1 text-[12px] text-text-secondary">The controls most likely to matter before a call.</p>
                                                    </div>
                                                    <Activity size={18} className="text-text-tertiary" />
                                                </div>
                                                <div className="mt-4 divide-y divide-border-subtle">
                                                    {overviewQuickLinks.map((item) => (
                                                        <button
                                                            key={item.id}
                                                            onClick={() => openSettingsSection(item.tab)}
                                                            className="group flex w-full items-center gap-3 rounded-xl px-1 py-3 text-left transition-colors hover:bg-bg-input/45"
                                                        >
                                                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-bg-input text-text-tertiary transition-colors group-hover:text-text-primary">
                                                                {item.icon}
                                                            </span>
                                                            <span className="min-w-0 flex-1">
                                                                <span className="block text-[13px] font-medium text-text-primary">{item.label}</span>
                                                                <span className="mt-0.5 block truncate text-[11px] text-text-secondary">{item.detail}</span>
                                                            </span>
                                                            <ChevronDown size={14} className="-rotate-90 text-text-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-text-primary" />
                                                        </button>
                                                    ))}
                                                </div>
                                            </section>

                                            <section className="rounded-2xl border border-border-subtle bg-bg-card p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                                                <div className="flex items-center justify-between gap-4">
                                                    <div>
                                                        <h4 className="text-[14px] font-semibold text-text-primary">Current session</h4>
                                                        <p className="mt-1 text-[12px] text-text-secondary">A compact view of the app state Settings can control.</p>
                                                    </div>
                                                    <CheckCircle size={18} className="text-text-tertiary" />
                                                </div>
                                                <div className="mt-4 space-y-3">
                                                    {[
                                                        ['Account', authUser?.email || 'Not signed in'],
                                                        ['Calendar', calendarStatus.connected ? 'Connected' : 'Not connected'],
                                                        ['Capture', sttProvider === 'none' ? 'Speech off' : sttProviderLabel],
                                                        ['Privacy', isUndetectable ? 'Screen sharing privacy on' : 'Visible overlay'],
                                                    ].map(([label, value]) => (
                                                        <div key={label} className="flex items-center justify-between gap-4 rounded-lg bg-bg-input/60 px-3 py-2">
                                                            <span className="text-[11px] font-medium text-text-secondary">{label}</span>
                                                            <span className="min-w-0 truncate text-right text-[12px] font-semibold text-text-primary">{value}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </section>
                                        </div>
                                    </div>
                                )}
                                {activeTab === 'privacy-trust' && (
                                    <div className="space-y-6 animated fadeIn select-text pb-4">
                                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                            <div className="min-w-0">
                                                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Privacy & Trust</p>
                                                <h3 className="mt-1 text-[24px] font-semibold tracking-tight text-text-primary">Trusted control center</h3>
                                                <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-text-secondary">
                                                    One place to review capture permissions, Calendar readiness, and privacy controls before sharing your screen.
                                                </p>
                                            </div>
                                            <div className="w-full max-w-[180px] shrink-0 self-start rounded-xl border border-border-subtle bg-bg-item-surface px-4 py-3 text-right shadow-sm">
                                                <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Trust status</p>
                                                <p className="mt-1 text-[15px] font-semibold text-text-primary">{trustStatusLabel}</p>
                                            </div>
                                        </div>

                                        <section className="rounded-2xl border border-border-subtle bg-bg-item-surface overflow-hidden">
                                            <div className="flex flex-col gap-3 border-b border-border-subtle p-5 sm:flex-row sm:items-center sm:justify-between">
                                                <div>
                                                    <h4 className="text-[15px] font-semibold text-text-primary">Readiness checklist</h4>
                                                    <p className="mt-1 text-[12px] text-text-secondary">
                                                        Last permission check: {permissionLastCheckedLabel}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => refreshPermissions().catch(() => { })}
                                                    disabled={permissionsChecking}
                                                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-[12px] font-semibold text-text-primary transition-all hover:bg-bg-elevated active:scale-[0.98] disabled:opacity-50"
                                                >
                                                    {permissionsChecking ? <Activity size={13} /> : <RefreshCw size={13} />}
                                                    {permissionsChecking ? 'Checking' : 'Refresh'}
                                                </button>
                                            </div>

                                            <div className="grid grid-cols-1 gap-px bg-border-subtle xl:grid-cols-2">
                                                {trustReadinessItems.map((item) => (
                                                    <div key={item.id} className="min-w-0 bg-bg-item-surface p-4">
                                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${getTrustChipClass(item.state)}`}>
                                                                {item.icon}
                                                            </span>
                                                            <span className={`${statusChipBaseClass} ${getTrustChipClass(item.state)}`}>
                                                                {getTrustStateLabel(item.state)}
                                                            </span>
                                                        </div>
                                                        <h5 className="mt-3 text-[13px] font-semibold text-text-primary">{item.label}</h5>
                                                        <p className="mt-1 text-[11px] leading-relaxed text-text-secondary break-words">{item.detail}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>

                                        <div className="grid grid-cols-1 gap-4">
                                            <section className="rounded-2xl border border-border-subtle bg-bg-card p-5">
                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                    <div className="flex min-w-0 items-start gap-3">
                                                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${getTrustChipClass(calendarTrustState)}`}>
                                                            <Calendar size={18} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <h4 className="text-[15px] font-semibold text-text-primary">Calendar trust</h4>
                                                            <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">
                                                                Meeting context stays connected to your signed-in Google account.
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <span className={`${statusChipBaseClass} ${getTrustChipClass(calendarTrustState)}`}>
                                                        {calendarStatus.connected ? 'Connected' : 'Needs Setup'}
                                                    </span>
                                                </div>

                                                {calendarStatus.connected ? (
                                                    <div className="mt-5 space-y-4">
                                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                            {[
                                                                ['Account', calendarIdentity],
                                                                ['Sync status', calendarSyncError ? 'Needs attention' : 'Available'],
                                                                ['Last sync', calendarLastSyncLabel],
                                                                ['Next meeting', nextSettingsCalendarEvent ? nextSettingsCalendarEvent.summary : 'No upcoming meeting'],
                                                            ].map(([label, value]) => (
                                                                <div key={label} className="rounded-xl border border-border-subtle bg-bg-input/60 px-3 py-2.5">
                                                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{label}</p>
                                                                    <p className="mt-1 truncate text-[12px] font-semibold text-text-primary">{value}</p>
                                                                </div>
                                                            ))}
                                                        </div>

                                                        <div className="rounded-xl border border-border-subtle bg-bg-input/50 p-4">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <div>
                                                                    <p className="text-[12px] font-semibold text-text-primary">
                                                                        {nextSettingsCalendarEvent ? formatCalendarWindow(nextSettingsCalendarEvent) : 'Calendar is clear'}
                                                                    </p>
                                                                    <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
                                                                        {nextSettingsCalendarEvent
                                                                            ? 'TeamSync can use this upcoming meeting for preparation context in Launcher.'
                                                                            : 'No upcoming event is currently available from Calendar.'}
                                                                    </p>
                                                                </div>
                                                                <span className="shrink-0 rounded-md border border-border-subtle bg-bg-card px-2 py-1 text-[10px] font-medium text-text-secondary">
                                                                    Next
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                                            {['Meeting-aware setup', 'Attendee context', 'Preparation notes'].map((benefit) => (
                                                                <div key={benefit} className="flex items-center gap-2 rounded-lg bg-bg-input/50 px-3 py-2 text-[11px] font-medium text-text-secondary">
                                                                    <CheckCircle size={13} className="text-emerald-500" />
                                                                    <span className="truncate">{benefit}</span>
                                                                </div>
                                                            ))}
                                                        </div>

                                                        {calendarSyncError && (
                                                            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-500">
                                                                {calendarSyncError}
                                                            </div>
                                                        )}

                                                        <div className="flex flex-wrap items-center justify-end gap-2">
                                                            <button
                                                                onClick={() => refreshCalendarEvents().catch(() => { })}
                                                                disabled={isCalendarSyncing}
                                                                className="rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-[12px] font-semibold text-text-primary transition-all hover:bg-bg-elevated active:scale-[0.98] disabled:opacity-50"
                                                            >
                                                                {isCalendarSyncing ? 'Checking' : 'Refresh calendar'}
                                                            </button>
                                                            <button
                                                                onClick={handleDisconnectCalendar}
                                                                disabled={isCalendarsLoading}
                                                                className="rounded-lg border border-border-subtle bg-transparent px-3 py-2 text-[12px] font-semibold text-text-secondary transition-all hover:bg-red-500/10 hover:text-red-400 active:scale-[0.98] disabled:opacity-50"
                                                            >
                                                                {isCalendarsLoading ? 'Disconnecting' : 'Disconnect'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="mt-5 rounded-2xl border border-border-subtle bg-bg-input/50 p-5">
                                                        <div className="max-w-[460px]">
                                                            <h5 className="text-[14px] font-semibold text-text-primary">Connect Calendar for trusted meeting context</h5>
                                                            <p className="mt-2 text-[12px] leading-relaxed text-text-secondary">
                                                                TeamSync can show the next meeting, prepare from event details, and keep Launcher focused on the call that matters now.
                                                            </p>
                                                        </div>
                                                        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                                                            {['Next meeting awareness', 'Relevant participants', 'Less manual setup'].map((benefit) => (
                                                                <div key={benefit} className="flex items-center gap-2 rounded-lg bg-bg-card px-3 py-2 text-[11px] font-medium text-text-secondary">
                                                                    <CheckCircle size={13} className="text-emerald-500" />
                                                                    <span className="truncate">{benefit}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        {calendarSyncError && (
                                                            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-500">
                                                                {calendarSyncError}
                                                            </div>
                                                        )}
                                                        <button
                                                            onClick={handleConnectCalendar}
                                                            disabled={isCalendarsLoading}
                                                            className={`mt-5 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-[12px] font-semibold transition-all active:scale-[0.98] disabled:opacity-50 ${isLight ? 'bg-bg-component hover:bg-bg-item-surface text-text-primary border border-border-subtle' : 'bg-[#303033] hover:bg-[#3A3A3D] text-white'}`}
                                                        >
                                                            <Calendar size={14} />
                                                            {isCalendarsLoading ? 'Connecting' : 'Connect Google Calendar'}
                                                        </button>
                                                    </div>
                                                )}
                                            </section>

                                            <section className="rounded-2xl border border-border-subtle bg-bg-card p-5">
                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                    <div className="flex min-w-0 items-start gap-3">
                                                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${getTrustChipClass(stealthTrustState)}`}>
                                                            <Ghost size={18} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <h4 className="text-[15px] font-semibold text-text-primary">Privacy during screen sharing</h4>
                                                            <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">
                                                                Controls how TeamSync windows behave when another app is sharing or recording the screen.
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <span className={`${statusChipBaseClass} ${getTrustChipClass(stealthTrustState)}`}>
                                                        {isUndetectable ? 'Protected' : 'Disabled'}
                                                    </span>
                                                </div>

                                                <div className="mt-5 space-y-3">
                                                    <div className="flex items-center justify-between gap-4 rounded-xl border border-border-subtle bg-bg-input/60 px-3 py-3">
                                                        <div>
                                                            <p className="text-[12px] font-semibold text-text-primary">Screen sharing privacy</p>
                                                            <p className="mt-0.5 text-[11px] text-text-secondary">
                                                                {isUndetectable ? 'TeamSync applies content protection to supported windows.' : 'TeamSync windows may be visible in screen sharing.'}
                                                            </p>
                                                        </div>
                                                        {renderSettingsSwitch({
                                                            checked: isUndetectable,
                                                            onToggle: handleToggleUndetectable,
                                                            label: 'Toggle screen sharing privacy',
                                                        })}
                                                    </div>

                                                    <div className="flex items-center justify-between gap-4 rounded-xl border border-border-subtle bg-bg-input/60 px-3 py-3">
                                                        <div>
                                                            <p className="text-[12px] font-semibold text-text-primary">Mouse passthrough</p>
                                                            <p className="mt-0.5 text-[11px] text-text-secondary">
                                                                {isMousePassthrough ? 'Clicks pass through TeamSync to the app underneath.' : 'TeamSync keeps normal overlay interaction.'}
                                                            </p>
                                                        </div>
                                                        {renderSettingsSwitch({
                                                            checked: isMousePassthrough,
                                                            onToggle: handleToggleMousePassthrough,
                                                            label: 'Toggle mouse passthrough',
                                                            tone: 'sky',
                                                        })}
                                                    </div>

                                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                        {[
                                                            ['Limitations', 'Protection depends on the meeting app and macOS capture path.'],
                                                            ['Recovery shortcut', shortcuts.toggleVisibility.length ? shortcuts.toggleVisibility.join(' ') : 'Set in Keybinds'],
                                                            ['Platform notes', permissionStatus?.platform === 'darwin' ? 'macOS privacy controls are active.' : 'Permission handling follows this OS.'],
                                                            ['Interaction', isMousePassthrough ? 'Pointer clicks pass through the overlay.' : 'Overlay controls remain clickable.'],
                                                        ].map(([label, value]) => (
                                                            <div key={label} className="rounded-xl border border-border-subtle bg-bg-input/50 px-3 py-2.5">
                                                                <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{label}</p>
                                                                <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">{value}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </section>
                                        </div>

                                        <section className="rounded-2xl border border-border-subtle bg-bg-card p-5">
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                <div>
                                                    <h4 className="text-[15px] font-semibold text-text-primary">Permission checklist</h4>
                                                    <p className="mt-1 max-w-[540px] text-[12px] leading-relaxed text-text-secondary">
                                                        Each permission has a clear reason, benefit, and repair path. Nothing here changes how permissions are requested.
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => refreshPermissions().catch(() => { })}
                                                    disabled={permissionsChecking}
                                                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-[12px] font-semibold text-text-primary transition-all hover:bg-bg-elevated active:scale-[0.98] disabled:opacity-50"
                                                >
                                                    {permissionsChecking ? <Activity size={13} /> : <RefreshCw size={13} />}
                                                    {permissionsChecking ? 'Checking' : 'Check again'}
                                                </button>
                                            </div>

                                            {permissionError && (
                                                <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-500">
                                                    {permissionError}
                                                </div>
                                            )}

                                            <div className="mt-5 divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle">
                                                {!permissionsInitialized && permissionsChecking ? (
                                                    <div className="space-y-4 bg-bg-item-surface p-4" aria-live="polite" aria-label="Checking permissions">
                                                        {[0, 1, 2].map((item) => (
                                                            <div key={item} className="grid grid-cols-1 gap-4">
                                                                <div className="flex items-start gap-3">
                                                                    <div className="h-9 w-9 shrink-0 rounded-xl bg-bg-input animate-pulse" />
                                                                    <div className="min-w-0 flex-1 space-y-2">
                                                                        <div className={`h-2.5 w-36 ${skeletonLineClass}`} />
                                                                        <div className={`h-2.5 w-56 max-w-full ${skeletonLineClass}`} />
                                                                    </div>
                                                                </div>
                                                                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                                                    <div className={`h-12 ${skeletonLineClass} rounded-lg`} />
                                                                    <div className={`h-12 ${skeletonLineClass} rounded-lg`} />
                                                                </div>
                                                                <div className={`h-9 w-20 ${skeletonLineClass} rounded-lg`} />
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : permissionChecklistItems.map((item) => {
                                                    const isBusy = activePermission === item.id || permissionsChecking;
                                                    const rawState = permissionStatus?.[item.id];
                                                    const actionLabel = item.state === 'healthy'
                                                        ? 'Review'
                                                        : rawState === 'not_requested'
                                                            ? 'Allow'
                                                            : item.state === 'disabled'
                                                                ? 'Unavailable'
                                                                : 'Fix';
                                                    return (
                                                        <div key={item.id} className="grid grid-cols-1 gap-4 bg-bg-item-surface p-4">
                                                            <div className="flex min-w-0 items-start gap-3">
                                                                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${getTrustChipClass(item.state)}`}>
                                                                    {item.icon}
                                                                </span>
                                                                <div className="min-w-0">
                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                        <h5 className="text-[13px] font-semibold text-text-primary">{item.label}</h5>
                                                                        <span className={`${statusChipBaseClass} ${getTrustChipClass(item.state)}`}>
                                                                            {getTrustStateLabel(item.state)}
                                                                        </span>
                                                                    </div>
                                                                    <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">{item.why}</p>
                                                                </div>
                                                            </div>
                                                            <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
                                                                <div className="rounded-lg bg-bg-input/60 px-3 py-2">
                                                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Unlocks</p>
                                                                    <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">{item.unlocks}</p>
                                                                </div>
                                                                <div className="rounded-lg bg-bg-input/60 px-3 py-2">
                                                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">How to fix</p>
                                                                    <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">{item.fix}</p>
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => handlePermissionAction(item.id)}
                                                                disabled={item.state === 'disabled' || isBusy}
                                                                className="justify-self-start rounded-lg border border-border-subtle bg-bg-input px-3 py-2 text-[12px] font-semibold text-text-primary transition-all hover:bg-bg-elevated active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                                                            >
                                                                {isBusy ? 'Checking' : actionLabel}
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </section>

                                        {hasResumeAndJd && renderDeleteProfileIntelligenceCard('privacy-trust')}
                                    </div>
                                )}
                                {activeTab === 'general' && (
                                    <div className="space-y-6 animated fadeIn">
                                        <div className="space-y-3.5">
                                            {/* UndetectableToggle */}
                                            <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle flex items-center justify-between transition-all ${isUndetectable ? 'shadow-lg shadow-blue-500/10' : ''}`}>
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-2">
                                                        {isUndetectable ? (
                                                            <svg
                                                                width="18"
                                                                height="18"
                                                                viewBox="0 0 24 24"
                                                                fill="none"
                                                                stroke="currentColor"
                                                                strokeWidth="2"
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                                className="text-text-primary"
                                                            >
                                                                <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" fill="currentColor" stroke="currentColor" />
                                                                <path d="M9 10h.01" stroke="var(--bg-item-surface)" strokeWidth="2.5" />
                                                                <path d="M15 10h.01" stroke="var(--bg-item-surface)" strokeWidth="2.5" />
                                                            </svg>
                                                        ) : (
                                                            <Ghost size={18} className="text-text-primary" />
                                                        )}
                                                        <h3 className="text-lg font-bold text-text-primary">{isUndetectable ? 'Undetectable' : 'Detectable'}</h3>
                                                    </div>
                                                    <p className="text-xs text-text-secondary">
                                                        TeamSync is currently {isUndetectable ? 'undetectable' : 'detectable'} by screen-sharing. <button className="text-blue-400 hover:underline">Supported apps here</button>
                                                    </p>
                                                </div>
                                                {renderSettingsSwitch({
                                                    checked: isUndetectable,
                                                    onToggle: handleToggleUndetectable,
                                                    label: 'Toggle undetectable mode',
                                                })}
                                            </div>

                                            {/* Mouse Passthrough Toggle — Adapted from public PR #113 */}
                                            <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle flex items-center justify-between transition-all ${isMousePassthrough ? 'shadow-lg shadow-sky-500/10' : ''}`}>
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-2">
                                                        <PointerOff size={18} className={isMousePassthrough ? 'text-sky-400' : 'text-text-primary'} />
                                                        <h3 className="text-lg font-bold text-text-primary">Mouse Passthrough</h3>
                                                    </div>
                                                    <p className="text-xs text-text-secondary">
                                                        Overlay stays visible but lets all mouse clicks pass through to the app beneath.
                                                    </p>
                                                </div>
                                                {renderSettingsSwitch({
                                                    checked: isMousePassthrough,
                                                    onToggle: handleToggleMousePassthrough,
                                                    label: 'Toggle mouse passthrough',
                                                    tone: 'sky',
                                                })}
                                            </div>

                                            {/* Pro UI Toggle — Premium/Trial only */}
                                            <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle flex items-center justify-between transition-all ${hasProAccess && useProUI ? 'shadow-lg shadow-purple-500/10' : ''} ${!hasProAccess ? 'opacity-80' : ''}`}>
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-2">
                                                        <Sparkles size={18} className={hasProAccess && useProUI ? 'text-purple-400' : 'text-text-primary'} />
                                                        <h3 className="text-lg font-bold text-text-primary">Pro UI</h3>
                                                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide bg-purple-500/10 text-purple-400 border border-purple-500/20">Beta</span>
                                                        {!hasProAccess && <Lock size={14} className="text-text-tertiary" />}
                                                    </div>
                                                    <p className="text-xs text-text-secondary">
                                                        {hasProAccess
                                                            ? 'Switch to the new floating panels layout with split insights and response surfaces.'
                                                            : 'Upgrade to Pro to unlock the new floating panels layout.'
                                                        }
                                                    </p>
                                                </div>
                                                {hasProAccess ? (
                                                    renderSettingsSwitch({
                                                        checked: useProUI,
                                                        onToggle: () => {
                                                            const newState = !useProUI;
                                                            setUseProUI(newState);
                                                            localStorage.setItem('teamsync_overlay_v2', String(newState));
                                                            window.dispatchEvent(new CustomEvent('teamsync-overlay-v2-changed', { detail: newState }));
                                                        },
                                                        label: 'Toggle Pro UI',
                                                        tone: 'purple',
                                                    })
                                                ) : (
                                                    <button
                                                        onClick={() => setIsPremiumModalOpen(true)}
                                                        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20 transition-colors whitespace-nowrap"
                                                    >
                                                        Upgrade
                                                    </button>
                                                )}
                                            </div>

                                            <div>
                                                <h3 className="text-lg font-bold text-text-primary mb-1">General settings</h3>
                                                <p className="text-xs text-text-secondary mb-2">Customize how TeamSync works for you</p>

                                                <div className={`rounded-xl border ${isLight ? 'bg-bg-card border-border-subtle divide-y divide-border-subtle' : 'bg-transparent border-transparent divide-y divide-border-subtle/20'}`}>
                                                    <div className="space-y-0">
                                                        {/* Open at Login */}
                                                        <div className="flex items-center justify-between px-4 py-3">
                                                            <div className="flex items-center gap-4">
                                                                <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary">
                                                                    <Power size={20} />
                                                                </div>
                                                                <div>
                                                                    <h3 className="text-sm font-bold text-text-primary">Open TeamSync when you log in</h3>
                                                                    <p className="text-xs text-text-secondary mt-0.5">TeamSync will open automatically when you log in to your computer</p>
                                                                </div>
                                                            </div>
                                                            {renderSettingsSwitch({
                                                                checked: openOnLogin,
                                                                onToggle: () => {
                                                                    const newState = !openOnLogin;
                                                                    setOpenOnLogin(newState);
                                                                    window.electronAPI?.setOpenAtLogin(newState);
                                                                },
                                                                label: 'Toggle open TeamSync at login',
                                                            })}
                                                        </div>

                                                        {/* Debug Logging */}
                                                        <div className="flex items-center justify-between px-4 py-3">
                                                            <div className="flex items-center gap-4">
                                                                <div className={`w-10 h-10 bg-bg-item-surface rounded-lg border flex items-center justify-center transition-colors ${verboseLogging ? 'border-amber-500/40 text-amber-400' : 'border-border-subtle text-text-tertiary'}`}>
                                                                    <Terminal size={20} />
                                                                </div>
                                                                <div>
                                                                    <h3 className="text-sm font-bold text-text-primary">Verbose debug logging</h3>
                                                                    <p className="text-xs text-text-secondary mt-0.5">Print detailed audio, STT, and pipeline diagnostics</p>
                                                                </div>
                                                            </div>
                                                            {renderSettingsSwitch({
                                                                checked: verboseLogging,
                                                                onToggle: () => {
                                                                    const newState = !verboseLogging;
                                                                    setVerboseLogging(newState);
                                                                    window.electronAPI?.setVerboseLogging?.(newState);
                                                                    if (newState) {
                                                                        setShowVerboseToast(true);
                                                                    }
                                                                },
                                                                label: 'Toggle verbose debug logging',
                                                                tone: 'amber',
                                                            })}
                                                        </div>

                                                        {/* Verbose logging toast */}
                                                        <AnimatePresence>
                                                            {showVerboseToast && (
                                                                <motion.div
                                                                    key="verbose-toast"
                                                                    initial={{ opacity: 0, y: -6, height: 0 }}
                                                                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                                                                    exit={{ opacity: 0, y: -4, height: 0 }}
                                                                    transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                                                                    className="mx-4 mb-1 overflow-hidden"
                                                                >
                                                                    <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                                            <Terminal size={14} className="text-amber-400 shrink-0" />
                                                                            <p className="text-xs text-amber-200/80 leading-snug truncate">
                                                                                Logs → <span className="font-mono text-amber-300">~/Documents/teamsync_debug.log</span>
                                                                            </p>
                                                                        </div>
                                                                        <button
                                                                            onClick={() => window.electronAPI?.openLogFile?.()}
                                                                            className="shrink-0 text-[11px] font-medium text-amber-400 hover:text-amber-300 transition-colors px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25"
                                                                        >
                                                                            Open
                                                                        </button>
                                                                    </div>
                                                                    {/* 5-second drain bar */}
                                                                    <motion.div
                                                                        className="h-[2px] bg-amber-500/40 rounded-b-xl"
                                                                        initial={{ scaleX: 1, originX: 0 }}
                                                                        animate={{ scaleX: 0 }}
                                                                        transition={{ duration: 5, ease: 'linear', delay: 0.2 }}
                                                                    />
                                                                </motion.div>
                                                            )}
                                                        </AnimatePresence>

                                                        {/* Interviewer Transcript */}
                                                        <div className="flex items-center justify-between px-4 py-3">
                                                            <div className="flex items-center gap-4">
                                                                <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary">
                                                                    <MessageSquare size={20} />
                                                                </div>
                                                                <div>
                                                                    <h3 className="text-sm font-bold text-text-primary">Interviewer Transcript</h3>
                                                                    <p className="text-xs text-text-secondary mt-0.5">Show real-time transcription of the interviewer</p>
                                                                </div>
                                                            </div>
                                                            {renderSettingsSwitch({
                                                                checked: showTranscript,
                                                                onToggle: () => {
                                                                    const newState = !showTranscript;
                                                                    setShowTranscript(newState);
                                                                    localStorage.setItem('teamsync_interviewer_transcript', String(newState));
                                                                    window.dispatchEvent(new Event('storage'));
                                                                },
                                                                label: 'Toggle interviewer transcript',
                                                            })}
                                                        </div>


                                                        {/* Theme */}
                                                        <div className="flex items-center justify-between px-4 py-3">
                                                            <div className="flex items-center gap-4">
                                                                <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary">
                                                                    <Palette size={20} />
                                                                </div>
                                                                <div>
                                                                    <h3 className="text-sm font-bold text-text-primary">Theme</h3>
                                                                    <p className="text-xs text-text-secondary mt-0.5">Customize how TeamSync looks on your device</p>
                                                                </div>
                                                            </div>

                                                            <div className="relative" ref={themeDropdownRef}>
                                                                <button
                                                                    onClick={() => setIsThemeDropdownOpen(!isThemeDropdownOpen)}
                                                                    className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 min-w-[110px] justify-between"
                                                                >
                                                                    <div className="flex items-center gap-2 overflow-hidden">
                                                                        <span className="text-text-secondary shrink-0">
                                                                            {themeMode === 'system' && <Monitor size={14} />}
                                                                            {themeMode === 'light' && <Sun size={14} />}
                                                                            {themeMode === 'dark' && <Moon size={14} />}
                                                                        </span>
                                                                        <span className="capitalize text-ellipsis overflow-hidden whitespace-nowrap">{themeMode}</span>
                                                                    </div>
                                                                    <ChevronDown size={12} className={`shrink-0 transition-transform ${isThemeDropdownOpen ? 'rotate-180' : ''}`} />
                                                                </button>

                                                                {/* Dropdown Menu */}
                                                                {isThemeDropdownOpen && (
                                                                    <div className="absolute right-0 top-full mt-1 min-w-full w-max bg-bg-elevated border border-border-subtle rounded-lg shadow-xl overflow-hidden z-20 p-1 animated fadeIn select-none">
                                                                        {[
                                                                            { mode: 'system', label: 'System', icon: <Monitor size={14} /> },
                                                                            { mode: 'light', label: 'Light', icon: <Sun size={14} /> },
                                                                            { mode: 'dark', label: 'Dark', icon: <Moon size={14} /> }
                                                                        ].map((option) => (
                                                                            <button
                                                                                key={option.mode}
                                                                                onClick={() => {
                                                                                    handleSetTheme(option.mode as any);
                                                                                    setIsThemeDropdownOpen(false);
                                                                                }}
                                                                                className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center gap-2 transition-colors ${themeMode === option.mode ? 'text-text-primary bg-bg-item-active/50' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                                                            >
                                                                                <span className={themeMode === option.mode ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}>{option.icon}</span>
                                                                                <span className="font-medium">{option.label}</span>
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* AI Response Language */}
                                                        <div className="flex items-center justify-between px-4 py-3">
                                                            <div className="flex items-center gap-4">
                                                                <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary">
                                                                    <Globe size={20} />
                                                                </div>
                                                                <div>
                                                                    <h3 className="text-sm font-bold text-text-primary">AI Response Language</h3>
                                                                    <p className="text-xs text-text-secondary mt-0.5">
                                                                        {aiResponseLanguage === 'auto'
                                                                            ? 'Mirrors user\'s language automatically'
                                                                            : 'Language for AI suggestions and notes'
                                                                        }
                                                                    </p>
                                                                </div>
                                                            </div>

                                                            <div className="relative" ref={aiLangDropdownRef}>
                                                                <button
                                                                    onClick={() => setIsAiLangDropdownOpen(!isAiLangDropdownOpen)}
                                                                    className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 min-w-[110px] justify-between"
                                                                >
                                                                    <span className="capitalize text-ellipsis overflow-hidden whitespace-nowrap flex items-center gap-1">
                                                                        {aiResponseLanguage === 'auto' ? 'Auto' : aiResponseLanguage}
                                                                    </span>
                                                                    <ChevronDown size={12} className={`shrink-0 transition-transform ${isAiLangDropdownOpen ? 'rotate-180' : ''}`} />
                                                                </button>

                                                                {/* Dropdown Menu */}
                                                                {isAiLangDropdownOpen && (
                                                                    <div className="absolute right-0 top-full mt-1 min-w-full w-max bg-bg-elevated border border-border-subtle rounded-lg shadow-xl overflow-hidden z-20 p-1 animated fadeIn select-none max-h-60 overflow-y-auto custom-scrollbar">
                                                                        {availableAiLanguages.map((option) => (
                                                                            <button
                                                                                key={option.code}
                                                                                onClick={() => {
                                                                                    handleAiLanguageChange(option.code);
                                                                                    setIsAiLangDropdownOpen(false);
                                                                                }}
                                                                                className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center gap-2 transition-colors ${aiResponseLanguage === option.code ? 'text-text-primary bg-bg-item-active/50' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}
                                                                            >
                                                                                {option.code === 'auto' ? (
                                                                                    <span className="font-medium">Auto</span>
                                                                                ) : (
                                                                                    <span className="font-medium">{option.label}</span>
                                                                                )}
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Personalization */}
                                                        <div className="flex items-start justify-between gap-4 px-4 py-3 flex-wrap">
                                                            <div className="flex items-start gap-4">
                                                                <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary shrink-0">
                                                                    <SlidersHorizontal size={20} />
                                                                </div>
                                                                <div>
                                                                    <h3 className="text-sm font-bold text-text-primary">Personalization</h3>
                                                                    <p className="text-xs text-text-secondary mt-0.5">
                                                                        Defaults for coding, routing, response depth, and interview focus
                                                                    </p>
                                                                </div>
                                                            </div>

                                                            <div className="grid grid-cols-2 gap-2 w-full max-w-[360px] min-w-[260px]">
                                                                <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                                                                    Code
                                                                    <select
                                                                        value={personalizationPreferences.preferredCodingLanguage ?? 'auto'}
                                                                        onChange={(event) => handlePersonalizationChange(
                                                                            'preferredCodingLanguage',
                                                                            event.target.value === 'auto' ? null : event.target.value as PreferredCodingLanguage,
                                                                        )}
                                                                        className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-2 py-1.5 rounded-lg text-xs font-medium outline-none"
                                                                    >
                                                                        {CODING_LANGUAGE_OPTIONS.map((option) => (
                                                                            <option key={option.value} value={option.value}>{option.label}</option>
                                                                        ))}
                                                                    </select>
                                                                </label>

                                                                <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                                                                    Provider
                                                                    <select
                                                                        value={personalizationPreferences.preferredProvider}
                                                                        onChange={(event) => handlePersonalizationChange('preferredProvider', event.target.value as PreferredProvider)}
                                                                        className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-2 py-1.5 rounded-lg text-xs font-medium outline-none"
                                                                    >
                                                                        {PROVIDER_PREFERENCE_OPTIONS.map((option) => (
                                                                            <option key={option.value} value={option.value}>{option.label}</option>
                                                                        ))}
                                                                    </select>
                                                                </label>

                                                                <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                                                                    Style
                                                                    <select
                                                                        value={personalizationPreferences.responseStyle}
                                                                        onChange={(event) => handlePersonalizationChange('responseStyle', event.target.value as ResponseStylePreference)}
                                                                        className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-2 py-1.5 rounded-lg text-xs font-medium outline-none"
                                                                    >
                                                                        {RESPONSE_STYLE_OPTIONS.map((option) => (
                                                                            <option key={option.value} value={option.value}>{option.label}</option>
                                                                        ))}
                                                                    </select>
                                                                </label>

                                                                <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                                                                    Focus
                                                                    <select
                                                                        value={personalizationPreferences.interviewFocus}
                                                                        onChange={(event) => handlePersonalizationChange('interviewFocus', event.target.value as InterviewFocusPreference)}
                                                                        className="bg-bg-component hover:bg-bg-elevated border border-border-subtle text-text-primary px-2 py-1.5 rounded-lg text-xs font-medium outline-none"
                                                                    >
                                                                        {INTERVIEW_FOCUS_OPTIONS.map((option) => (
                                                                            <option key={option.value} value={option.value}>{option.label}</option>
                                                                        ))}
                                                                    </select>
                                                                </label>
                                                            </div>
                                                        </div>

                                                        {/* Version */}
                                                        <div className="flex items-start justify-between gap-4 px-4 py-3">
                                                            <div className="flex items-start gap-4">
                                                                <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary shrink-0">
                                                                    <BadgeCheck size={20} />
                                                                </div>
                                                                <div>
                                                                    <h3 className="text-sm font-bold text-text-primary">Version</h3>
                                                                    <p className="text-xs text-text-secondary mt-0.5">
                                                                        {updateStatus === 'checking' ? 'Checking for updates...' :
                                                                            updateStatus === 'uptodate' ? `You're on the latest version (v${packageJson.version})` :
                                                                                updateStatus === 'available' ? 'A new update is available!' :
                                                                                    updateStatus === 'error' ? (updateErrorMessage || 'Could not check for updates') :
                                                                                        `You are currently using TeamSync version ${packageJson.version}`}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={async () => {
                                                                    if (updateStatus === 'available') {
                                                                        try {
                                                                            // @ts-ignore
                                                                            await window.electronAPI.downloadUpdate();
                                                                            onClose(); // Close settings to show the banner
                                                                        } catch (err) {
                                                                            console.error("Failed to start download:", err);
                                                                        }
                                                                    } else {
                                                                        handleCheckForUpdates();
                                                                    }
                                                                }}
                                                                disabled={updateStatus === 'checking'}
                                                                className={`px-5 py-2 rounded-lg text-[13px] font-bold transition-all flex items-center gap-2 shrink-0 ${updateStatus === 'checking' ? 'bg-bg-input text-text-tertiary cursor-wait' :
                                                                    updateStatus === 'available' ? 'bg-accent-primary text-white hover:bg-accent-secondary shadow-lg shadow-blue-500/20' :
                                                                        updateStatus === 'uptodate' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                                                                            updateStatus === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                                                                                'bg-bg-component hover:bg-bg-input text-text-primary'
                                                                    }`}
                                                            >
                                                                {updateStatus === 'checking' ? (
                                                                    <>
                                                                        <RefreshCw size={14} className="animate-spin" />
                                                                        Checking...
                                                                    </>
                                                                ) : updateStatus === 'available' ? (
                                                                    <>
                                                                        <ArrowDown size={14} />
                                                                        Update Available
                                                                    </>
                                                                ) : updateStatus === 'uptodate' ? (
                                                                    <>
                                                                        <Check size={14} />
                                                                        Up to date
                                                                    </>
                                                                ) : updateStatus === 'error' ? (
                                                                    <>
                                                                        <X size={14} />
                                                                        Error
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <RefreshCw size={14} />
                                                                        Check for updates
                                                                    </>
                                                                )}
                                                            </button>
                                                        </div>

                                                        {/* Update Diagnostics */}
                                                        <div className="px-4 py-4">
                                                            <div className="flex items-start justify-between gap-4 mb-3">
                                                                <div className="flex items-start gap-4 min-w-0">
                                                                    <div className="w-10 h-10 bg-bg-item-surface rounded-lg border border-border-subtle flex items-center justify-center text-text-tertiary shrink-0">
                                                                        <FolderOpen size={20} />
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <h3 className="text-sm font-bold text-text-primary">Update Diagnostics</h3>
                                                                        <p className="text-xs text-text-secondary mt-0.5">
                                                                            Download cache details for the current updater feed
                                                                        </p>
                                                                    </div>
                                                                </div>

                                                                <div className="flex items-center gap-2 shrink-0">
                                                                    <button
                                                                        onClick={refreshUpdaterCacheInfo}
                                                                        disabled={updaterCacheLoading}
                                                                        className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-bg-component hover:bg-bg-input text-text-primary transition-colors flex items-center gap-2 disabled:opacity-60 disabled:cursor-wait"
                                                                    >
                                                                        <RefreshCw size={13} className={updaterCacheLoading ? 'animate-spin' : ''} />
                                                                        Refresh
                                                                    </button>
                                                                    <button
                                                                        onClick={handleOpenUpdaterCacheFolder}
                                                                        disabled={!updaterCacheInfo?.cacheDir}
                                                                        className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-accent-primary hover:bg-accent-secondary text-white transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                    >
                                                                        <FolderOpen size={13} />
                                                                        Open Update Cache Folder
                                                                    </button>
                                                                </div>
                                                            </div>

                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                                <div className="rounded-lg bg-bg-component/70 border border-border-subtle px-3 py-2 min-w-0">
                                                                    <p className="text-[10px] uppercase tracking-wide text-text-tertiary font-semibold mb-1">Update Cache Location</p>
                                                                    <p className="text-[11px] font-mono text-text-primary truncate" title={updateDiagnosticsCacheDir}>
                                                                        {updateDiagnosticsCacheDir}
                                                                    </p>
                                                                </div>
                                                                <div className="rounded-lg bg-bg-component/70 border border-border-subtle px-3 py-2 min-w-0">
                                                                    <p className="text-[10px] uppercase tracking-wide text-text-tertiary font-semibold mb-1">Downloaded Update File</p>
                                                                    <p className="text-[11px] font-mono text-text-primary truncate" title={updateDiagnosticsFilePath}>
                                                                        {updateDiagnosticsFileName}
                                                                    </p>
                                                                </div>
                                                                <div className="rounded-lg bg-bg-component/70 border border-border-subtle px-3 py-2 min-w-0">
                                                                    <p className="text-[10px] uppercase tracking-wide text-text-tertiary font-semibold mb-1">Full Path</p>
                                                                    <p className="text-[11px] font-mono text-text-primary truncate" title={updateDiagnosticsFilePath}>
                                                                        {updateDiagnosticsFilePath}
                                                                    </p>
                                                                </div>
                                                                <div className="grid grid-cols-3 gap-2">
                                                                    <div className="rounded-lg bg-bg-component/70 border border-border-subtle px-3 py-2 min-w-0">
                                                                        <p className="text-[10px] uppercase tracking-wide text-text-tertiary font-semibold mb-1">Size</p>
                                                                        <p className="text-[11px] font-mono text-text-primary truncate">{updateDiagnosticsSize}</p>
                                                                    </div>
                                                                    <div className="rounded-lg bg-bg-component/70 border border-border-subtle px-3 py-2 min-w-0">
                                                                        <p className="text-[10px] uppercase tracking-wide text-text-tertiary font-semibold mb-1">Current Version</p>
                                                                        <p className="text-[11px] font-mono text-text-primary truncate">v{updateDiagnosticsCurrentVersion.replace(/^v/, '')}</p>
                                                                    </div>
                                                                    <div className="rounded-lg bg-bg-component/70 border border-border-subtle px-3 py-2 min-w-0">
                                                                        <p className="text-[10px] uppercase tracking-wide text-text-tertiary font-semibold mb-1">Latest Version</p>
                                                                        <p className="text-[11px] font-mono text-text-primary truncate">
                                                                            {updateDiagnosticsLatestVersion === 'Unknown' ? 'Unknown' : `v${updateDiagnosticsLatestVersion.replace(/^v/, '')}`}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {updaterCacheError && (
                                                                <div className="mt-2 flex items-center gap-2 text-[11px] text-red-400">
                                                                    <AlertCircle size={12} />
                                                                    <span className="truncate">{updaterCacheError}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* ------------------------------------------------------------------ */}
                                                {/* Interface Opacity (Stealth Mode)                                   */}
                                                {/* ------------------------------------------------------------------ */}
                                                <div
                                                    id="opacity-slider-card"
                                                    style={isPreviewingOpacity ? { visibility: 'visible', position: 'relative', zIndex: 9999 } : {}}
                                                    className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle mt-4`}
                                                >
                                                    <div className="flex items-center justify-between mb-3">
                                                        <label className="flex items-center gap-2 text-xs font-medium text-text-secondary uppercase tracking-wide">
                                                            <Eye size={13} className="text-text-secondary" />
                                                            Interface Opacity
                                                        </label>
                                                        <span className="opacity-percent-label text-xs font-semibold text-text-primary tabular-nums">
                                                            {Math.round(overlayOpacity * 100)}%
                                                        </span>
                                                    </div>

                                                    <input
                                                        type="range"
                                                        min={OVERLAY_OPACITY_MIN}
                                                        max={1.0}
                                                        step={0.01}
                                                        defaultValue={overlayOpacity}
                                                        onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
                                                        onPointerDown={startPreviewingOpacity}
                                                        onPointerUp={stopPreviewingOpacity}
                                                        onPointerCancel={stopPreviewingOpacity}
                                                        onPointerLeave={stopPreviewingOpacity}
                                                        className="w-full h-1.5 rounded-full appearance-none bg-bg-input accent-accent-primary"
                                                        style={{ WebkitAppearance: 'none' } as React.CSSProperties}
                                                    />

                                                    <div className="flex justify-between mt-1.5">
                                                        <span className="text-[10px] text-text-tertiary">More Stealth</span>
                                                        <span className="text-[10px] text-text-tertiary">Fully Visible</span>
                                                    </div>

                                                    <p className="text-xs text-text-tertiary mt-2">
                                                        Controls the visibility of the in-meeting overlay.{' '}
                                                        <span className="text-text-secondary">Hold the slider to preview.</span>
                                                    </p>
                                                </div>

                                            </div>

                                        </div>

                                        {/* Process Disguise */}
                                        {/* Process Disguise */}
                                        <div className={`${isLight ? 'bg-bg-card' : 'bg-bg-item-surface'} rounded-xl p-5 border border-border-subtle`}>
                                            <div className="flex flex-col gap-1 mb-3">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="text-lg font-bold text-text-primary">Process Disguise</h3>
                                                </div>
                                                <p className="text-xs text-text-secondary">
                                                    Disguise TeamSync as another application to prevent detection during screen sharing.
                                                    <span className="block mt-1 text-text-tertiary">
                                                        Select a disguise to be automatically applied when Undetectable mode is on.
                                                    </span>
                                                </p>
                                            </div>

                                            <div className={`grid grid-cols-2 gap-3 ${isUndetectable ? 'opacity-50 pointer-events-none' : ''}`}>
                                                {isUndetectable && (
                                                    <p className="col-span-2 text-xs text-yellow-500/80 -mt-1 mb-1">
                                                        ⚠️ Disable Undetectable mode first to change disguise.
                                                    </p>
                                                )}
                                                {[
                                                    { id: 'none', label: 'None (Default)', icon: <Layout size={14} /> },
                                                    { id: 'terminal', label: 'Terminal', icon: <Terminal size={14} /> },
                                                    { id: 'settings', label: 'System Settings', icon: <Settings size={14} /> },
                                                    { id: 'activity', label: 'Activity Monitor', icon: <Activity size={14} /> }
                                                ].map((option) => (
                                                    <button
                                                        key={option.id}
                                                        disabled={isUndetectable}
                                                        onClick={() => {
                                                            if (isUndetectable) return;
                                                            // @ts-ignore
                                                            setDisguiseMode(option.id);
                                                            // @ts-ignore
                                                            window.electronAPI?.setDisguise(option.id);
                                                            // Analytics
                                                            analytics.trackModeSelected(`disguise_${option.id}`);
                                                        }}
                                                        className={`p-3 rounded-lg border text-left flex items-center gap-3 transition-all ${disguiseMode === option.id
                                                            ? 'bg-accent-primary border-accent-primary text-white shadow-lg shadow-blue-500/20'
                                                            : 'bg-bg-input border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-subtle-hover'
                                                            } ${isUndetectable ? 'cursor-not-allowed' : ''}`}
                                                    >
                                                        <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${disguiseMode === option.id ? 'bg-white/20 text-white' : 'bg-bg-item-surface text-text-secondary'
                                                            }`}>
                                                            {option.icon}
                                                        </div>
                                                        <span className="text-xs font-medium">{option.label}</span>
                                                    </button>
                                                ))}
                                                    </div>
                                                        </div>

                                    </div>
                                )}
                                {activeTab === 'profile' && (
                                    <div className="space-y-6 animated fadeIn">
                                        {/* Introduction */}
                                        <div className="mb-5">
                                            <div className="flex items-center justify-between mb-1">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="text-sm font-bold text-text-primary">Professional Identity</h3>
                                                    {isPremium && premiumPlan && (
                                                        <span className="bg-[#FACC15]/10 text-[#FACC15] border border-[#FACC15]/20 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ml-1">
                                                            {premiumPlan.toUpperCase()} PLAN
                                                        </span>
                                                    )}
                                                    {isTrialActive && !isPremium && (
                                                        <span className="bg-violet-500/10 text-violet-400 border border-violet-500/20 text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ml-1">
                                                            FREE TRIAL
                                                        </span>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => setIsPremiumModalOpen(true)}
                                                    className={`text-[11px] font-semibold flex items-center gap-1.5 transition-all duration-200 px-2.5 py-1 rounded-full border shadow-[0_0_10px_rgba(250,204,21,0.2)] hover:shadow-[0_0_15px_rgba(250,204,21,0.3)] ${isPremium
                                                        ? (isLight ? 'bg-bg-component text-text-primary border-border-subtle hover:bg-bg-item-surface' : 'bg-zinc-800 text-white border-white/10 hover:bg-zinc-700')
                                                        : isTrialActive
                                                            ? 'bg-violet-500/15 text-violet-300 border-violet-500/30 hover:bg-violet-500/25 active:scale-[0.98]'
                                                            : 'bg-[#FACC15] text-black border-transparent hover:bg-[#FDE047] active:scale-[0.98]'
                                                        }`}
                                                >
                                                    {isPremium ? <CheckCircle size={12} className="text-green-400" /> : isTrialActive ? <Sparkles size={12} className="text-violet-400" /> : <Sparkles size={12} className="text-black/80" />}
                                                    {isPremium ? 'Manage Pro' : isTrialActive ? 'Upgrade' : 'Unlock Pro'}
                                                </button>
                                            </div>
                                            <p className="text-xs text-text-secondary mb-2">
                                                This engine constructs an intelligent representation of your career history.
                                            </p>
                                        </div>

                                        {!profileStatus.isReady && (
                                            <div className="mb-4 rounded-xl border border-border-subtle bg-bg-item-surface px-4 py-3 text-xs text-text-secondary">
                                                Restoring your saved profile intelligence and AOT outputs...
                                            </div>
                                        )}

                                        {/* Intelligence Graph Hero Card */}
                                        <div className="bg-bg-item-surface rounded-xl border border-border-subtle flex flex-col justify-between overflow-hidden">
                                            <div className="flex flex-col justify-between min-h-[160px]">

                                                {/* Header */}
                                                <div className="p-5 pb-4">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-10 h-10 rounded-full bg-bg-input border border-border-subtle flex items-center justify-center text-text-primary shadow-sm hover:scale-105 transition-transform duration-300">
                                                                <span className="font-bold text-sm tracking-tight">
                                                                    {profileData?.identity?.name ? profileData.identity.name.charAt(0).toUpperCase() : 'U'}
                                                                </span>
                                                            </div>
                                                            <div>
                                                                <h4 className="text-sm font-bold text-text-primary tracking-tight">
                                                                    {profileData?.identity?.name || 'Identity Node Inactive'}
                                                                </h4>
                                                                <p className="text-xs text-text-secondary mt-0.5 tracking-wide">
                                                                    {profileData?.identity?.email || 'Upload a resume to begin mapping.'}
                                                                </p>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-3">
                                                            {/* Profile Intelligence Toggle */}
                                                            <div
                                                                className={`flex items-center gap-2 bg-bg-input px-3 py-1.5 rounded-full border border-border-subtle ${!canEnableProfileIntelligence ? 'opacity-40 cursor-not-allowed' : ''}`}
                                                                title={!hasProfileAccess ? 'Requires Pro license' : !profileStatus.hasProfile ? 'Upload a resume to enable Profile Intelligence' : ''}
                                                            >
                                                                <span className="text-xs font-medium text-text-secondary">Profile Intelligence</span>
                                                                {renderSettingsSwitch({
                                                                    checked: Boolean(profileStatus.profileMode && canEnableProfileIntelligence),
                                                                    disabled: !canEnableProfileIntelligence,
                                                                    size: 'small',
                                                                    label: 'Toggle profile intelligence',
                                                                    onToggle: async () => {
                                                                        if (!canEnableProfileIntelligence) return;
                                                                        const newState = !profileStatus.profileMode;
                                                                        // Optimistic update — reflect change immediately
                                                                        setProfileStatus((prev) => ({ ...prev, profileMode: newState }));
                                                                        try {
                                                                            const result = await window.electronAPI?.profileSetMode?.(newState);
                                                                            if (!result?.success) {
                                                                                // Revert on failure
                                                                                setProfileStatus((prev) => ({ ...prev, profileMode: !newState }));
                                                                                console.error('Failed to toggle profile intelligence:', result?.error);
                                                                            }
                                                                        } catch (e) {
                                                                            setProfileStatus((prev) => ({ ...prev, profileMode: !newState }));
                                                                            console.error('Failed to toggle profile intelligence:', e);
                                                                        }
                                                                    },
                                                                })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Data Metrics & Extracted Skills */}
                                                <div className="p-5 pt-0 mt-auto">
                                                    <div className="flex items-center justify-between bg-bg-input border border-border-subtle py-4 px-6 rounded-2xl shadow-sm">
                                                        <div className="flex flex-col items-center justify-center flex-1">
                                                            <span className="text-[20px] font-bold text-text-primary tracking-tight leading-none mb-1">{profileData?.experienceCount || 0}</span>
                                                            <div className="flex items-center gap-1.5">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                                                                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">Experience</span>
                                                            </div>
                                                        </div>

                                                        <div className="h-8 w-px bg-border-subtle/60" />

                                                        <div className="flex flex-col items-center justify-center flex-1">
                                                            <span className="text-[20px] font-bold text-text-primary tracking-tight leading-none mb-1">{profileData?.projectCount || 0}</span>
                                                            <div className="flex items-center gap-1.5">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]" />
                                                                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">Projects</span>
                                                            </div>
                                                        </div>

                                                        <div className="h-8 w-px bg-border-subtle/60" />

                                                        <div className="flex flex-col items-center justify-center flex-1">
                                                            <span className="text-[20px] font-bold text-text-primary tracking-tight leading-none mb-1">{profileData?.nodeCount || 0}</span>
                                                            <div className="flex items-center gap-1.5">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]" />
                                                                <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">Nodes</span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {profileData?.skills && profileData.skills.length > 0 && (
                                                        <div className="mt-5">
                                                            <div className="text-[10px] font-bold text-text-primary uppercase tracking-wide mb-2">
                                                                Top Skills
                                                            </div>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {profileData.skills.slice(0, 15).map((skill: string, i: number) => (
                                                                    <span key={i} className="text-[10px] font-medium text-text-secondary px-2 py-1 rounded-md border border-border-subtle bg-bg-input">
                                                                        {skill}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Upload Area */}
                                        <div className="mt-5">
                                            <div className={`bg-bg-item-surface rounded-xl border transition-all ${profileUploading ? 'border-accent-primary/50 ring-1 ring-accent-primary/20' : 'border-border-subtle'}`}>
                                                <div className="p-5 flex items-center justify-between">
                                                    <div className="flex items-center gap-4 min-w-0">
                                                        <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-text-tertiary shrink-0">
                                                            {profileUploading ? <RefreshCw size={20} className="animate-spin text-accent-primary" /> : <Upload size={20} />}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <h4 className="text-sm font-bold text-text-primary mb-0.5 truncate pr-4">
                                                                {profileStatus.hasProfile ? 'Overwrite Source Document' : 'Initialize Knowledge Base'}
                                                            </h4>
                                                            {profileUploading ? (
                                                                <div className="flex items-center gap-2">
                                                                    <div className="h-[4px] w-[100px] bg-bg-input rounded-full overflow-hidden">
                                                                        <div className="h-full bg-accent-primary rounded-full animate-pulse" style={{ width: '50%' }} />
                                                                    </div>
                                                                    <span className="text-[10px] text-text-secondary tracking-wide">Processing structural semantics...</span>
                                                                </div>
                                                            ) : (
                                                                <p className="text-xs text-text-secondary truncate pr-4">
                                                                    Provide a resume file to seed the intelligence engine.
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <button
                                                        onClick={handleSelectResume}
                                                        disabled={profileViewStatus === 'processing'}
                                                        className={`px-4 py-2 rounded-full text-xs font-medium transition-all whitespace-nowrap shrink-0 ${profileViewStatus === 'processing' ? 'bg-bg-input text-text-tertiary cursor-wait border border-border-subtle' : 'bg-text-primary text-bg-main hover:opacity-90 shadow-sm'}`}
                                                    >
                                                        {profileUploading ? 'Ingesting...' : 'Select File'}
                                                    </button>
                                                </div>

                                                {profileError && (
                                                    <div className="px-5 pb-4">
                                                        <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-[11px] text-red-500 font-medium">
                                                            <X size={12} /> {profileError}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* JD Upload Card */}
                                        <div className="mt-5">
                                            <div className={`rounded-xl transition-all border ${jdUploading ? 'border-blue-500/50 ring-1 ring-blue-500/20 bg-bg-item-surface' : profileData?.hasActiveJD ? 'border-blue-500/30 bg-blue-500/5' : 'border-border-subtle bg-bg-item-surface'}`}>
                                                <div className="p-5 flex items-center justify-between">
                                                    <div className="flex items-center gap-4 min-w-0">
                                                        <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-text-tertiary shrink-0">
                                                            {jdUploading ? <RefreshCw size={20} className="animate-spin text-blue-500" /> : <Briefcase size={20} />}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <h4 className="text-sm font-bold text-text-primary mb-0.5 truncate pr-4">
                                                                {profileData?.hasActiveJD ? `${profileData.activeJD?.title} @ ${profileData.activeJD?.company}` : 'Upload Job Description'}
                                                            </h4>
                                                            {jdUploading ? (
                                                                <div className="flex items-center gap-2">
                                                                    <div className="h-[4px] w-[100px] bg-bg-input rounded-full overflow-hidden">
                                                                        <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '50%' }} />
                                                                    </div>
                                                                    <span className="text-[10px] text-text-secondary tracking-wide">Parsing JD structure...</span>
                                                                </div>
                                                            ) : profileData?.hasActiveJD ? (
                                                                <div className="flex items-center gap-3">
                                                                    <span className="text-[9px] font-bold text-blue-500 px-1.5 py-0.5 bg-blue-500/10 rounded uppercase tracking-wide border border-blue-500/20">
                                                                        {profileData.activeJD?.level || 'mid'}-level
                                                                    </span>
                                                                    <div className="flex gap-1.5">
                                                                        {profileData.activeJD?.technologies?.slice(0, 3).map((t: string, i: number) => (
                                                                            <span key={i} className="text-[10px] text-text-secondary">{t}</span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <p className="text-xs text-text-secondary">
                                                                    Upload a JD to enable persona tuning and company research.
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-2 shrink-0">
                                                        {profileData?.hasActiveJD && (
                                                            <button
                                                                onClick={async () => {
                                                                    await window.electronAPI?.profileDeleteJD?.();
                                                                    await refreshProfileStateRef.current?.();
                                                                }}
                                                                className="px-2.5 py-2 rounded-full text-xs text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-all border border-transparent hover:border-red-500/20"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={async () => {
                                                                let uploadGenerationId = 0;
                                                                setJdError('');
                                                                try {
                                                                    const fileResult = await window.electronAPI?.profileSelectFile?.();
                                                                    if (fileResult?.cancelled || !fileResult?.fileToken) return;

                                                                    setLastJdFileToken(fileResult.fileToken);
                                                                    setLastUploadKind('jd');
                                                                    uploadGenerationId = Date.now();
                                                                    uploadGenerationRef.current = uploadGenerationId;
                                                                    profileHardDeleteUiGuardRef.current = false;
                                                                    setJdUploading(true);
                                                                    updateProfileViewStatus('processing');
                                                                    setProfileData(null);
                                                                    profileGenerationRef.current = 0;
                                                                    setNegotiationScript(null);
                                                                    setProfileStatus(prev => ({
                                                                        ...prev,
                                                                        isReady: false
                                                                    }));
                                                                    const result = await window.electronAPI?.profileUploadJD?.(fileResult.fileToken);
                                                                    if (uploadGenerationRef.current !== uploadGenerationId) return;
                                                                    if (result?.success) {
                                                                        await refreshProfileStateRef.current?.(uploadGenerationId);
                                                                    } else if (result?.error === 'STALE_GENERATION') {
                                                                        return;
                                                                    } else {
                                                                        updateProfileViewStatus('error');
                                                                        setJdError(result?.error || 'JD upload failed');
                                                                    }
                                                                } catch (e: any) {
                                                                    updateProfileViewStatus('error');
                                                                    setJdError(e.message || 'JD upload failed');
                                                                } finally {
                                                                    if (uploadGenerationRef.current === uploadGenerationId) {
                                                                        setJdUploading(false);
                                                                    }
                                                                }
                                                            }}
                                                            disabled={profileViewStatus === 'processing'}
                                                            className={`px-4 py-2 rounded-full text-xs font-medium transition-all whitespace-nowrap shrink-0 ${profileViewStatus === 'processing' ? 'bg-bg-input text-text-tertiary cursor-wait border border-border-subtle' : 'bg-blue-600 text-white hover:bg-blue-500 shadow-sm'}`}
                                                        >
                                                            {jdUploading ? 'Parsing...' : profileData?.hasActiveJD ? 'Replace JD' : 'Upload JD'}
                                                        </button>
                                                    </div>
                                                </div>

                                                {jdError && (
                                                    <div className="px-5 pb-4">
                                                        <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-[11px] text-red-500 font-medium">
                                                            <X size={12} /> {jdError}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {hasResumeAndJd && (
                                            <div className="mt-5">
                                                {renderDeleteProfileIntelligenceCard('profile')}
                                            </div>
                                        )}

                                        {/* Custom Context Card — Pro only */}
                                        {hasProfileAccess && (
                                            <div className="mt-5">
                                                <div className="bg-bg-item-surface rounded-xl border border-border-subtle">
                                                    <div className="p-5">
                                                        <div className="flex items-center gap-4 mb-4">
                                                            <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-text-tertiary shrink-0">
                                                                <Pencil size={20} />
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <h4 className="text-sm font-bold text-text-primary">Custom Context</h4>
                                                                    {customNotesSaved && (
                                                                        <span className="text-[9px] font-bold text-emerald-500 px-1.5 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20 uppercase tracking-wide flex items-center gap-1">
                                                                            <Check size={8} /> Saved
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <p className="text-[11px] text-text-secondary mt-0.5">
                                                                    Add any context the AI should know about you — saved across all sessions.
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <div className="space-y-3">
                                                            <textarea
                                                                value={customNotes}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    if (val.length > 4000) return;
                                                                    setCustomNotes(val);
                                                                    setCustomNotesSaved(false);
                                                                    if (customNotesDebounceRef.current) clearTimeout(customNotesDebounceRef.current);
                                                                    customNotesDebounceRef.current = setTimeout(async () => {
                                                                        try {
                                                                            await window.electronAPI?.profileSaveNotes?.(val);
                                                                            setCustomNotesSaved(true);
                                                                            setTimeout(() => setCustomNotesSaved(false), 2000);
                                                                        } catch (_) { }
                                                                    }, 800);
                                                                }}
                                                                placeholder={`Examples:\n• Q4 ARR was $2.1M, grew 40% YoY — use when pitching growth story\n• Solved LRU Cache (LeetCode 146) with O(1) get/put using HashMap + doubly linked list\n• I prefer concise, direct answers without filler phrases\n• My target salary is $180k base — don't go below $160k`}
                                                                rows={6}
                                                                className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2.5 text-xs text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary/50 focus:ring-1 focus:ring-accent-primary/20 transition-all resize-none leading-relaxed"
                                                            />
                                                            <div className="flex items-center justify-between px-0.5">
                                                                <p className="text-[10px] text-text-tertiary">
                                                                    Auto-saved · Works with all modes and providers
                                                                </p>
                                                                <span className={`text-[10px] tabular-nums ${customNotes.length > 3600 ? 'text-amber-500' : 'text-text-tertiary'}`}>
                                                                    {customNotes.length}/4000
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Google Search API Card */}
                                        <div className="mt-5">
                                            <div className="bg-bg-item-surface rounded-xl border border-border-subtle">
                                                <div className="p-5">
                                                    <div className="flex items-center gap-4 mb-4">
                                                        <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-emerald-500 shrink-0">
                                                            <Globe size={20} />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <h4 className="text-sm font-bold text-text-primary">Tavily Search API</h4>
                                                                {hasStoredTavilyKey && (
                                                                    <span className="text-[9px] font-bold text-emerald-500 px-1.5 py-0.5 bg-emerald-500/10 rounded-full border border-emerald-500/20 uppercase tracking-wide">Connected</span>
                                                                )}
                                                            </div>
                                                            <p className="text-[11px] text-text-secondary mt-0.5">
                                                                Powers live web search for company research.
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="space-y-3">
                                                        <div>
                                                            <div className="flex justify-between items-center mb-1.5">
                                                                <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide block">API Key</label>
                                                                {hasStoredTavilyKey && (
                                                                    <button
                                                                        onClick={handleRemoveTavilyKey}
                                                                        className="text-[10px] flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors bg-red-500/10 hover:bg-red-500/20 px-1.5 py-0.5 rounded"
                                                                        title="Remove API Key"
                                                                    >
                                                                        <Trash2 size={10} strokeWidth={2} /> Remove
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <input
                                                                type="password"
                                                                value={tavilyApiKey}
                                                                onChange={(e) => { setTavilyApiKey(e.target.value); setTavilyError(''); }}
                                                                placeholder={hasStoredTavilyKey ? '••••••••••••' : 'Enter Tavily API key (tvly-...)'}
                                                                className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary/50 focus:ring-1 focus:ring-accent-primary/20 transition-all"
                                                            />
                                                        </div>
                                                        {tavilyError && (
                                                            <p className="text-[10px] text-red-400 px-1">{tavilyError}</p>
                                                        )}
                                                        <button
                                                            onClick={async () => {
                                                                if (!tavilyApiKey.trim()) return;
                                                                setTavilyError('');
                                                                setTavilySaving(true);
                                                                try {
                                                                    const result = await window.electronAPI?.setTavilyApiKey?.(tavilyApiKey.trim());
                                                                    if (result && !result.success) {
                                                                        setTavilyError(result.error ?? 'Failed to save API key.');
                                                                    } else {
                                                                        setHasStoredTavilyKey(true);
                                                                        setTavilyApiKey('');
                                                                    }
                                                                } catch (e: any) {
                                                                    setTavilyError(e?.message ?? 'Unexpected error saving API key.');
                                                                } finally {
                                                                    setTavilySaving(false);
                                                                }
                                                            }}
                                                            disabled={tavilySaving || !tavilyApiKey.trim()}
                                                            className={`w-full px-4 py-2 rounded-lg text-xs font-medium transition-all ${tavilySaving ? 'bg-bg-input text-text-tertiary cursor-wait' : !tavilyApiKey.trim() ? 'bg-bg-input text-text-tertiary cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm'}`}
                                                        >
                                                            {tavilySaving ? 'Saving...' : 'Save API Key'}
                                                        </button>
                                                    </div>

                                                    <div className="mt-3 flex items-start gap-2 px-3 py-2.5 bg-bg-input/50 rounded-lg">
                                                        <Info size={12} className="text-text-tertiary shrink-0 mt-0.5" />
                                                        <p className="text-[10px] text-text-tertiary leading-relaxed">
                                                            If not provided, LLM general knowledge is used for company research, which may be outdated. Get your free API key at <span className="text-emerald-500/80 hover:text-emerald-400 underline underline-offset-2 cursor-pointer" onClick={() => window.electronAPI?.openExternal?.('https://app.tavily.com/home')}>app.tavily.com</span>. Keys start with <code className="text-emerald-500/80">tvly-</code>.
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Company Research Section */}
                                        {profileData?.hasActiveJD && profileData?.activeJD?.company && (
                                            <div className="mt-5">
                                                <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5">
                                                    <div className="flex items-center justify-between mb-4">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-10 h-10 rounded-lg bg-bg-input border border-border-subtle flex items-center justify-center text-purple-500">
                                                                <Building2 size={20} />
                                                            </div>
                                                            <div>
                                                                <div className="flex items-center gap-2">
                                                                    <h4 className="text-sm font-bold text-text-primary">
                                                                        Company Intel: <span className="text-purple-400">{profileData.activeJD.company}</span>
                                                                    </h4>
                                                                </div>
                                                                <p className="text-[11px] text-text-secondary mt-0.5">
                                                                    {profileData?.research ? 'Research complete — company intelligence is synced in this panel.' : 'Click Research to generate hiring strategy, salary, culture, and interview intelligence.'}
                                                                </p>
                                                            </div>
                                                        </div>

                                                        <button
                                                            onClick={handleRunCompanyResearch}
                                                            disabled={companyResearching}
                                                            className={`px-4 py-2 rounded-full text-xs font-medium transition-all flex items-center gap-2 ${companyResearching ? 'bg-bg-input text-text-tertiary cursor-wait border border-border-subtle' : 'bg-purple-600/10 text-purple-500 hover:bg-purple-600/20 border border-purple-500/20'}`}
                                                        >
                                                            {companyResearching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                                                            {companyResearching ? 'Researching...' : profileData?.research ? 'Refresh Research' : 'Research'}
                                                        </button>
                                                    </div>

                                                    {companyResearchToast && (
                                                        <div className={`mb-4 flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-[11px] leading-relaxed ${companyResearchToast.variant === 'success'
                                                            ? 'bg-emerald-500/8 border-emerald-500/20 text-emerald-400'
                                                            : companyResearchToast.variant === 'error'
                                                                ? 'bg-red-500/8 border-red-500/20 text-red-400'
                                                                : 'bg-purple-500/8 border-purple-500/20 text-purple-300'
                                                            }`}>
                                                            <span className="shrink-0 mt-[1px]">
                                                                {companyResearchToast.variant === 'success' ? '✓' : companyResearchToast.variant === 'error' ? '!' : '•'}
                                                            </span>
                                                            <div>
                                                                <div className="font-semibold">{companyResearchToast.title}</div>
                                                                <div className="mt-0.5 opacity-90">{companyResearchToast.description}</div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    <ResearchPanel
                                                        research={profileData?.research ?? null}
                                                        loading={companyResearching}
                                                        currentGenerationId={profileData?.generationId}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        {profileViewStatus === 'processing' ? (
                                            <div className="mt-6 rounded-2xl border border-border-subtle bg-bg-item-surface p-5 shadow-sm" aria-live="polite">
                                                <div className="flex items-center justify-between gap-4">
                                                    <div>
                                                        <p className="text-[13px] font-semibold text-text-primary">
                                                            {profileUploading ? 'Building profile intelligence' : 'Refreshing role intelligence'}
                                                        </p>
                                                        <p className="mt-1 text-[12px] text-text-secondary">
                                                            TeamSync is preparing the context surface for your meetings.
                                                        </p>
                                                    </div>
                                                    <span className={`${statusChipBaseClass} border-border-subtle bg-bg-input text-text-secondary`}>
                                                        Processing
                                                    </span>
                                                </div>
                                                <div className="mt-4 space-y-2">
                                                    <div className={`h-2.5 w-3/4 ${skeletonLineClass}`} />
                                                    <div className={`h-2.5 w-1/2 ${skeletonLineClass}`} />
                                                    <div className={`h-2.5 w-2/3 ${skeletonLineClass}`} />
                                                </div>
                                            </div>
                                        ) : profileViewStatus === 'error' ? (
                                            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-600 shadow-sm">
                                                <div className="font-medium">Profile generation failed.</div>
                                                <div className="mt-1 text-red-500/90">
                                                    {profileError || jdError || 'Please try the upload again.'}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => { void retryLastUpload(); }}
                                                    className="mt-4 rounded-xl bg-red-600 px-4 py-2 text-xs font-medium text-white transition-all hover:bg-red-500"
                                                >
                                                    Retry
                                                </button>
                                            </div>
                                        ) : profileData ? (
                                            <ProfileVisualizer
                                                profileData={profileData}
                                                currentGenerationId={profileData?.generationId}
                                            />
                                        ) : (
                                            <div className="mt-6 rounded-2xl border border-dashed border-border-subtle bg-bg-item-surface p-6 shadow-sm">
                                                <div className="max-w-[520px]">
                                                    <p className="text-[14px] font-semibold text-text-primary">Create your profile intelligence</p>
                                                    <p className="mt-2 text-[12px] leading-relaxed text-text-secondary">
                                                        Add a resume once so TeamSync can personalize answers, interview framing, and role-specific preparation.
                                                    </p>
                                                </div>
                                                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                                                    {['Personal context', 'Role-aware answers', 'Reusable memory'].map((benefit) => (
                                                        <div key={benefit} className="flex items-center gap-2 rounded-lg bg-bg-input/60 px-3 py-2 text-[11px] font-medium text-text-secondary">
                                                            <CheckCircle size={13} className="text-emerald-500" />
                                                            <span className="truncate">{benefit}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={handleSelectResume}
                                                    className="mt-5 rounded-lg bg-text-primary px-4 py-2 text-[12px] font-semibold text-bg-main transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
                                                >
                                                    Select resume
                                                </button>
                                            </div>
                                        )}

                                        {/* Salary Negotiation Script */}
                                        {profileData?.hasActiveJD && (
                                            <div className="mt-6 animated fadeIn">
                                                <div className="relative rounded-xl border border-border-subtle overflow-hidden bg-bg-item-surface">

                                                    <div className="p-5">
                                                        {/* Header row */}
                                                        <div className="flex items-center justify-between mb-5">
                                                            <div className="flex items-center gap-3">
                                                                <div className="relative">
                                                                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(6,182,212,0.1) 100%)', border: '1px solid rgba(16,185,129,0.25)' }}>
                                                                        <Briefcase size={15} className="text-emerald-400" />
                                                                    </div>
                                                                    {negotiationScript && (
                                                                        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-bg-item-surface" />
                                                                    )}
                                                                </div>
                                                                <div>
                                                                    <h3 className="text-[13px] font-bold text-text-primary tracking-tight">Negotiation Script</h3>
                                                                    <p className="text-[10px] text-text-tertiary mt-0.5 tracking-wide uppercase">
                                                                        {negotiationScript ? `Tailored for ${profileData?.activeJD?.company || 'this role'}` : 'AI-powered salary coaching'}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                {negotiationScript && (
                                                                    <button
                                                                        onClick={async () => {
                                                                            setNegotiationGenerating(true);
                                                                            setNegotiationError('');
                                                                            try {
                                                                                const result = await window.electronAPI?.profileGenerateNegotiation?.(true);
                                                                                if (result?.success) {
                                                                                    await refreshProfileStateRef.current?.();
                                                                                } else {
                                                                                    setNegotiationError(result?.error || 'Failed to regenerate');
                                                                                }
                                                                            } catch { setNegotiationError('Generation failed'); }
                                                                            finally { setNegotiationGenerating(false); }
                                                                        }}
                                                                        disabled={negotiationGenerating}
                                                                        title="Regenerate script"
                                                                        className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-input transition-all border border-border-subtle"
                                                                    >
                                                                        <RefreshCw size={12} className={negotiationGenerating ? 'animate-spin' : ''} />
                                                                    </button>
                                                                )}
                                                                {!negotiationScript && (
                                                                    <button
                                                                        onClick={async () => {
                                                                            setNegotiationGenerating(true);
                                                                            setNegotiationError('');
                                                                            try {
                                                                                const result = await window.electronAPI?.profileGenerateNegotiation?.(false);
                                                                                if (result?.success) {
                                                                                    await refreshProfileStateRef.current?.();
                                                                                } else {
                                                                                    setNegotiationError(result?.error || 'Failed to generate');
                                                                                }
                                                                            } catch { setNegotiationError('Generation failed'); }
                                                                            finally { setNegotiationGenerating(false); }
                                                                        }}
                                                                        disabled={negotiationGenerating}
                                                                        className="px-4 py-1.5 rounded-full text-[11px] font-semibold transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-wait"
                                                                        style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.2) 0%, rgba(6,182,212,0.15) 100%)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399' }}
                                                                    >
                                                                        {negotiationGenerating ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
                                                                        {negotiationGenerating ? 'Generating…' : 'Generate Script'}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {negotiationError && (
                                                            <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                                                                <AlertCircle size={12} className="text-red-400 shrink-0" />
                                                                <p className="text-[11px] text-red-400">{negotiationError}</p>
                                                            </div>
                                                        )}

                                                        {/* Empty state */}
                                                        {!negotiationScript && !negotiationGenerating && !negotiationError && (
                                                            <div className="flex flex-col items-center justify-center py-8 gap-3">
                                                                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(6,182,212,0.06) 100%)', border: '1px solid rgba(16,185,129,0.15)' }}>
                                                                    <Briefcase size={20} className="text-emerald-500/50" />
                                                                </div>
                                                                <div className="text-center">
                                                                    <p className="text-[12px] font-medium text-text-secondary">No script yet</p>
                                                                    <p className="text-[10px] text-text-tertiary mt-0.5">Generate a personalized opening, justification &amp; counter-offer</p>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Generating skeleton */}
                                                        {negotiationGenerating && (
                                                            <div className="space-y-3 py-2">
                                                                {[40, 70, 55].map((w, i) => (
                                                                    <div key={i} className="h-3 rounded-full bg-bg-input animate-pulse" style={{ width: `${w}%`, animationDelay: `${i * 150}ms` }} />
                                                                ))}
                                                                <div className="h-12 rounded-lg bg-bg-input animate-pulse mt-2" style={{ animationDelay: '450ms' }} />
                                                            </div>
                                                        )}

                                                        {negotiationScript && !negotiationGenerating && (
                                                            <div className="space-y-3">
                                                                {/* Salary Range Hero */}
                                                                {negotiationScript.salary_range && (
                                                                    <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(6,182,212,0.06) 100%)', border: '1px solid rgba(16,185,129,0.18)' }}>
                                                                        <div>
                                                                            <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/70 mb-1">Target Compensation</div>
                                                                            <div className="text-xl font-bold tracking-tight" style={{ color: '#34d399' }}>
                                                                                {negotiationScript.salary_range.currency} {negotiationScript.salary_range.min.toLocaleString()}
                                                                                <span className="text-text-tertiary font-normal mx-2">–</span>
                                                                                {negotiationScript.salary_range.max.toLocaleString()}
                                                                            </div>
                                                                            {negotiationScript.sources?.length > 0 && (
                                                                                <div className="text-[9px] text-text-tertiary mt-1">{negotiationScript.sources.length} market source{negotiationScript.sources.length > 1 ? 's' : ''}</div>
                                                                            )}
                                                                        </div>
                                                                        <span className={`text-[9px] font-bold px-2 py-1 rounded-full tracking-wide ${negotiationScript.salary_range.confidence === 'high' ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/25' :
                                                                            negotiationScript.salary_range.confidence === 'medium' ? 'text-yellow-400 bg-yellow-500/15 border border-yellow-500/25' :
                                                                                'text-text-tertiary bg-bg-input border border-border-subtle'
                                                                            }`}>
                                                                            {(negotiationScript.salary_range.confidence || 'low').toUpperCase()}
                                                                        </span>
                                                                    </div>
                                                                )}

                                                                {/* Step cards */}
                                                                {[
                                                                    {
                                                                        step: '01',
                                                                        label: 'Your Opening Answer',
                                                                        sublabel: 'Say this when HR asks about salary expectations',
                                                                        content: negotiationScript.opening_line,
                                                                        accent: '#10b981',
                                                                        accentBg: 'rgba(16,185,129,0.07)',
                                                                        accentBorder: 'rgba(16,185,129,0.2)',
                                                                        quote: true,
                                                                    },
                                                                    {
                                                                        step: '02',
                                                                        label: 'Your Justification',
                                                                        sublabel: 'Say this to explain and defend your range',
                                                                        content: negotiationScript.justification,
                                                                        accent: '#60a5fa',
                                                                        accentBg: 'rgba(96,165,250,0.07)',
                                                                        accentBorder: 'rgba(96,165,250,0.2)',
                                                                        quote: false,
                                                                    },
                                                                    {
                                                                        step: '03',
                                                                        label: 'Your Counter & Hold',
                                                                        sublabel: 'Say this if they come back lower than your range',
                                                                        content: negotiationScript.counter_offer_fallback,
                                                                        accent: '#fb923c',
                                                                        accentBg: 'rgba(251,146,60,0.07)',
                                                                        accentBorder: 'rgba(251,146,60,0.2)',
                                                                        quote: true,
                                                                    },
                                                                ].filter(s => s.content).map((s) => ({ ...s, content: s.content.replace(/^["'"']+|["'"']+$/g, '').trim() })).map((s) => (
                                                                    <div key={s.step} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${s.accentBorder}`, background: s.accentBg }}>
                                                                        <div className="flex items-center justify-between px-3.5 pt-3 pb-2">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="text-[10px] font-black tracking-widest" style={{ color: s.accent, opacity: 0.6 }}>STEP {s.step}</span>
                                                                                <span className="text-[11px] font-bold text-text-primary">{s.label}</span>
                                                                            </div>
                                                                            <button
                                                                                onClick={() => navigator.clipboard?.writeText(s.content)}
                                                                                title="Copy to clipboard"
                                                                                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-medium transition-all hover:bg-bg-input text-text-tertiary hover:text-text-secondary"
                                                                            >
                                                                                <Check size={9} />
                                                                                Copy
                                                                            </button>
                                                                        </div>
                                                                        <p className="text-[10px] text-text-tertiary px-3.5 pb-2 -mt-1 tracking-wide">{s.sublabel}</p>
                                                                        <div className="mx-3.5 mb-3.5">
                                                                            <p className={`text-[12px] leading-relaxed text-text-primary ${s.quote ? 'pl-3 italic' : ''}`}>
                                                                                {s.content}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                    </div>
                                )}
                                {activeTab === 'ai-providers' && (
                                    <AIProvidersSettings />
                                )}
                                {activeTab === 'account' && (
                                    <div className="space-y-6 animated fadeIn select-text pb-4">
                                        <div>
                                            <h3 className="text-lg font-bold text-text-primary mb-1">Account</h3>
                                            <p className="text-xs text-text-secondary">Manage your signed-in Google account.</p>
                                        </div>

                                        {authUser ? (
                                            <div className="bg-bg-card rounded-xl border border-border-subtle p-5 space-y-4">
                                                <div className="flex items-center gap-4">
                                                    {authUser.picture ? (
                                                        <img src={authUser.picture} alt="" className="w-12 h-12 rounded-full ring-2 ring-border-subtle" referrerPolicy="no-referrer" />
                                                    ) : (
                                                        <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-lg font-bold">
                                                            {(authUser.name || authUser.email || '?')[0].toUpperCase()}
                                                        </div>
                                                    )}
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-semibold text-text-primary truncate">{authUser.name || 'User'}</p>
                                                        <p className="text-xs text-text-secondary truncate">{authUser.email}</p>
                                                    </div>
                                                </div>
                                                <div className="pt-3 border-t border-border-subtle">
                                                    <button
                                                        onClick={async () => {
                                                            await window.electronAPI?.googleLogout?.();
                                                            localStorage.removeItem('teamsync_auth_token');
                                                            localStorage.removeItem('teamsync_auth_user');
                                                            setAuthUser(null);
                                                            setCalendarStatus({ connected: false });
                                                        }}
                                                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-red-400 hover:bg-red-500/10 border border-red-500/20 hover:border-red-500/40 transition-all"
                                                    >
                                                        <LogOut size={14} /> Sign Out
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="bg-bg-card rounded-xl border border-border-subtle p-5 text-center">
                                                <p className="text-sm text-text-secondary mb-3">Not signed in</p>
                                                <button
                                                    onClick={() => window.location.reload()}
                                                    className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                                                >
                                                    Sign In with Google
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {activeTab === 'keybinds' && (
                                    <div className="space-y-5 animated fadeIn select-text pb-4">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <h3 className="text-lg font-bold text-text-primary mb-1">Keyboard shortcuts</h3>
                                                <p className="text-xs text-text-secondary">TeamSync works with these easy to remember commands.</p>
                                            </div>
                                            <button
                                                onClick={resetShortcuts}
                                                className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-border-subtle bg-bg-subtle/30 hover:bg-bg-subtle hover:border-green-500/30 transition-all duration-200 text-xs font-medium text-text-secondary hover:text-green-500 active:scale-95 mt-1"
                                            >
                                                <RotateCcw size={13} strokeWidth={2.5} />
                                                Restore Default
                                            </button>
                                        </div>

                                        <div className="grid gap-6">
                                            {/* General Category */}
                                            <div>
                                                <h4 className="text-sm font-bold text-text-primary mb-3">General</h4>
                                                <div className="space-y-1">
                                                    <div className="flex items-center justify-between py-1.5 group">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Eye size={14} /></span>
                                                            <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Toggle Visibility</span>
                                                        </div>
                                                        <KeyRecorder
                                                            currentKeys={shortcuts.toggleVisibility}
                                                            onSave={(keys) => updateShortcut('toggleVisibility', keys)}
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between py-1.5 group">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><PointerOff size={14} /></span>
                                                            <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Toggle Mouse Passthrough</span>
                                                        </div>
                                                        <KeyRecorder
                                                            currentKeys={shortcuts.toggleMousePassthrough}
                                                            onSave={(keys) => updateShortcut('toggleMousePassthrough', keys)}
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between py-1.5 group">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><MessageSquare size={14} /></span>
                                                            <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Process Screenshots</span>
                                                        </div>
                                                        <KeyRecorder
                                                            currentKeys={shortcuts.processScreenshots}
                                                            onSave={(keys) => updateShortcut('processScreenshots', keys)}
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between py-1.5 group">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Sparkles size={14} /></span>
                                                            <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Capture Screen & Ask AI</span>
                                                        </div>
                                                        <KeyRecorder
                                                            currentKeys={shortcuts.captureAndProcess}
                                                            onSave={(keys) => updateShortcut('captureAndProcess', keys)}
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between py-1.5 group">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><RotateCcw size={14} /></span>
                                                            <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Reset / Cancel</span>
                                                        </div>
                                                        <KeyRecorder
                                                            currentKeys={shortcuts.resetCancel}
                                                            onSave={(keys) => updateShortcut('resetCancel', keys)}
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between py-1.5 group">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Camera size={14} /></span>
                                                            <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Take Screenshot</span>
                                                        </div>
                                                        <KeyRecorder
                                                            currentKeys={shortcuts.takeScreenshot}
                                                            onSave={(keys) => updateShortcut('takeScreenshot', keys)}
                                                        />
                                                    </div>
                                                    <div className="flex items-center justify-between py-1.5 group">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center"><Crop size={14} /></span>
                                                            <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">Selective Screenshot</span>
                                                        </div>
                                                        <KeyRecorder
                                                            currentKeys={shortcuts.selectiveScreenshot}
                                                            onSave={(keys) => updateShortcut('selectiveScreenshot', keys)}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Chat Category */}
                                            <div>
                                                <div className="mb-3">
                                                    <h4 className="text-sm font-bold text-text-primary">Chat</h4>
                                                </div>
                                                <div className="space-y-1">
                                                    {[
                                                        { id: 'whatToAnswer', label: 'What to Answer', icon: <Sparkles size={14} /> },
                                                        { id: 'clarify', label: 'Clarify', icon: <MessageSquare size={14} /> },
                                                        { id: 'followUp', label: 'Follow Up', icon: <MessageSquare size={14} /> },
                                                        { id: 'dynamicAction4', label: 'Recap / Brainstorm', icon: <RefreshCw size={14} /> },
                                                        { id: 'answer', label: 'Answer / Record', icon: <Mic size={14} /> },
                                                        { id: 'codeHint', label: 'Get Code Hint', icon: <Zap size={14} /> },
                                                        { id: 'brainstorm', label: 'Brainstorm Approaches', icon: <Zap size={14} /> },
                                                        { id: 'scrollUp', label: 'Scroll Up', icon: <ArrowUp size={14} /> },
                                                        { id: 'scrollDown', label: 'Scroll Down', icon: <ArrowDown size={14} /> },
                                                    ].map((item, i) => (
                                                        <div key={i} className="flex items-center justify-between py-1.5 group">
                                                            <div className="flex items-center gap-3">
                                                                <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center">{item.icon}</span>
                                                                <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{item.label}</span>
                                                            </div>
                                                            <KeyRecorder
                                                                currentKeys={shortcuts[item.id as keyof typeof shortcuts]}
                                                                onSave={(keys) => updateShortcut(item.id as any, keys)}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Window Category */}
                                            <div>
                                                <h4 className="text-sm font-bold text-text-primary mb-3">Window</h4>
                                                <div className="space-y-1">
                                                    {[
                                                        { id: 'moveWindowUp', label: 'Move Window Up', icon: <ArrowUp size={14} /> },
                                                        { id: 'moveWindowDown', label: 'Move Window Down', icon: <ArrowDown size={14} /> },
                                                        { id: 'moveWindowLeft', label: 'Move Window Left', icon: <ArrowLeft size={14} /> },
                                                        { id: 'moveWindowRight', label: 'Move Window Right', icon: <ArrowRight size={14} /> }
                                                    ].map((item, i) => (
                                                        <div key={i} className="flex items-center justify-between py-1.5 group">
                                                            <div className="flex items-center gap-3">
                                                                <span className="text-text-tertiary group-hover:text-text-primary transition-colors w-5 flex justify-center">{item.icon}</span>
                                                                <span className="text-sm text-text-secondary font-medium group-hover:text-text-primary transition-colors">{item.label}</span>
                                                            </div>
                                                            <KeyRecorder
                                                                currentKeys={shortcuts[item.id as keyof typeof shortcuts]}
                                                                onSave={(keys) => updateShortcut(item.id as any, keys)}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'audio' && (
                                    <div className="space-y-6 animated fadeIn">
                                        {/* ── Speech Provider Section ── */}
                                        <div>
                                            <h3 className="text-lg font-bold text-text-primary mb-1">Speech Provider</h3>
                                            <p className="text-xs text-text-secondary mb-5">Choose the engine that transcribes audio to text.</p>

                                            <div className="space-y-4">
                                                <div className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-3">
                                                    <label className="text-xs font-medium text-text-secondary block">Speech Provider</label>
                                                    <div className="relative">
                                                        <ProviderSelect
                                                            value={sttProvider}
                                                            onChange={(val) => handleSttProviderChange(val as any)}
                                                            options={sttProviderOptions}
                                                        />
                                                    </div>
                                                    <p className="text-[10px] text-text-tertiary">
                                                        {sttFallbackChainLabel}
                                                    </p>
                                                </div>

                                                {/* Google Cloud Service Account */}
                                                {sttProvider === 'google' && (
                                                    <div className="bg-bg-card rounded-xl border border-border-subtle p-4">
                                                        <label className="text-xs font-medium text-text-secondary mb-2 block">Service Account JSON</label>
                                                        <div className="flex gap-2">
                                                            <div className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-secondary font-mono truncate">
                                                                {googleServiceAccountPath
                                                                    ? <span className="text-text-primary">{googleServiceAccountPath.split('/').pop()}</span>
                                                                    : <span className="text-text-tertiary italic">No file selected</span>}
                                                            </div>
                                                            <button
                                                                onClick={async () => {
                                                                    // @ts-ignore
                                                                    const result = await window.electronAPI?.selectServiceAccount?.();
                                                                    if (result?.success && result.path) {
                                                                        setGoogleServiceAccountPath(result.path);
                                                                    }
                                                                }}
                                                                className="px-3 py-2 bg-bg-input hover:bg-bg-elevated border border-border-subtle rounded-lg text-xs font-medium text-text-primary transition-colors flex items-center gap-2"
                                                            >
                                                                <Upload size={14} /> Select File
                                                            </button>
                                                        </div>
                                                        <p className="text-[10px] text-text-tertiary mt-2">
                                                            Google can be your active provider or the first live fallback when the selected primary provider fails.
                                                        </p>
                                                    </div>
                                                )}

                                                {(sttProvider === 'deepgram') && renderSttApiKeyCard({
                                                    provider: 'deepgram',
                                                    label: 'Deepgram API Key',
                                                    value: sttDeepgramKey,
                                                    onChange: setSttDeepgramKey,
                                                    hasStoredKey: hasStoredDeepgramKey,
                                                    maskedKey: sttKeyStatuses.deepgram.masked,
                                                    placeholder: 'Enter Deepgram API key',
                                                    docsUrl: 'https://console.deepgram.com',
                                                    helperText: 'Deepgram remains the default recommended primary provider.',
                                                })}

                                                {(sttProvider === 'groq') && renderSttApiKeyCard({
                                                    provider: 'groq',
                                                    label: 'Groq STT API Key',
                                                    value: sttGroqKey,
                                                    onChange: setSttGroqKey,
                                                    hasStoredKey: hasStoredSttGroqKey,
                                                    maskedKey: sttKeyStatuses.groq.masked,
                                                    placeholder: 'Enter Groq STT API key',
                                                    docsUrl: 'https://console.groq.com/keys',
                                                    extraFields: (
                                                        <div className="space-y-2">
                                                            <label className="text-[10px] uppercase tracking-wide text-text-tertiary block">Model</label>
                                                            <select
                                                                value={groqSttModel}
                                                                onChange={async (e) => {
                                                                    const nextModel = e.target.value;
                                                                    setGroqSttModel(nextModel);
                                                                    try {
                                                                        // @ts-ignore
                                                                        await window.electronAPI?.setGroqSttModel?.(nextModel);
                                                                    } catch (error) {
                                                                        console.error('Failed to update Groq STT model:', error);
                                                                    }
                                                                }}
                                                                className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                                                            >
                                                                <option value="whisper-large-v3-turbo">Whisper Large V3 Turbo</option>
                                                                <option value="whisper-large-v3">Whisper Large V3</option>
                                                            </select>
                                                        </div>
                                                    ),
                                                    helperText: 'Saving the key switches the live meeting pipeline to Groq immediately.',
                                                })}

                                                {(sttProvider === 'openai') && renderSttApiKeyCard({
                                                    provider: 'openai',
                                                    label: 'OpenAI STT API Key',
                                                    value: sttOpenaiKey,
                                                    onChange: setSttOpenaiKey,
                                                    hasStoredKey: hasStoredSttOpenaiKey,
                                                    maskedKey: sttKeyStatuses.openai.masked,
                                                    placeholder: 'Enter OpenAI API key',
                                                    docsUrl: 'https://platform.openai.com/api-keys',
                                                    helperText: 'OpenAI runs as the primary path and still falls back to Google, then Whisper.',
                                                })}

                                                {(sttProvider === 'elevenlabs') && renderSttApiKeyCard({
                                                    provider: 'elevenlabs',
                                                    label: 'ElevenLabs API Key',
                                                    value: sttElevenLabsKey,
                                                    onChange: setSttElevenLabsKey,
                                                    hasStoredKey: hasStoredElevenLabsKey,
                                                    maskedKey: sttKeyStatuses.elevenlabs.masked,
                                                    placeholder: 'Enter ElevenLabs API key',
                                                    docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
                                                    helperText: 'Uses the realtime Scribe path when available, with the same recovery chain behind it.',
                                                })}

                                                {(sttProvider === 'azure') && renderSttApiKeyCard({
                                                    provider: 'azure',
                                                    label: 'Azure Speech API Key',
                                                    value: sttAzureKey,
                                                    onChange: setSttAzureKey,
                                                    hasStoredKey: hasStoredAzureKey,
                                                    maskedKey: sttKeyStatuses.azure.masked,
                                                    placeholder: 'Enter Azure Speech API key',
                                                    docsUrl: 'https://portal.azure.com',
                                                    extraFields: (
                                                        <div className="space-y-2">
                                                            <label className="text-[10px] uppercase tracking-wide text-text-tertiary block">Azure Region</label>
                                                            <input
                                                                type="text"
                                                                value={sttAzureRegion}
                                                                onChange={(e) => setSttAzureRegion(e.target.value)}
                                                                placeholder="eastus"
                                                                className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
                                                            />
                                                        </div>
                                                    ),
                                                    helperText: 'The selected region is saved live and used immediately after the key is stored.',
                                                })}

                                                {(sttProvider === 'ibmwatson') && renderSttApiKeyCard({
                                                    provider: 'ibmwatson',
                                                    label: 'IBM Watson API Key',
                                                    value: sttIbmKey,
                                                    onChange: setSttIbmKey,
                                                    hasStoredKey: hasStoredIbmWatsonKey,
                                                    maskedKey: sttKeyStatuses.ibmwatson.masked,
                                                    placeholder: 'Enter IBM Watson API key',
                                                    docsUrl: 'https://cloud.ibm.com/catalog/services/speech-to-text',
                                                    extraFields: (
                                                        <div className="space-y-2">
                                                            <label className="text-[10px] uppercase tracking-wide text-text-tertiary block">IBM Region</label>
                                                            <input
                                                                type="text"
                                                                value={sttIbmRegion}
                                                                onChange={(e) => setSttIbmRegion(e.target.value)}
                                                                placeholder="us-south"
                                                                className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
                                                            />
                                                        </div>
                                                    ),
                                                    helperText: 'IBM Watson stays hot-swappable during a live meeting once the key is saved.',
                                                })}

                                                {(sttProvider === 'soniox') && renderSttApiKeyCard({
                                                    provider: 'soniox',
                                                    label: 'Soniox API Key',
                                                    value: sttSonioxKey,
                                                    onChange: setSttSonioxKey,
                                                    hasStoredKey: hasStoredSonioxKey,
                                                    maskedKey: sttKeyStatuses.soniox.masked,
                                                    placeholder: 'Enter Soniox API key',
                                                    docsUrl: 'https://app.soniox.com',
                                                    helperText: 'Soniox uses its streaming path first, then drops into Google and Whisper recovery if needed.',
                                                })}

                                                {sttProvider === 'teamsync' && (
                                                    <div className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-2">
                                                        <label className="text-xs font-medium text-text-secondary block">Managed TeamSync STT</label>
                                                        <p className="text-xs text-text-secondary">
                                                            Your TeamSync key is already connected. Runtime switching happens automatically as soon as that key is saved in the TeamSync API section.
                                                        </p>
                                                        <p className="text-[10px] text-text-tertiary">
                                                            This selection still keeps the Google and Whisper recovery path available locally if the managed stream drops.
                                                        </p>
                                                    </div>
                                                )}

                                                {sttProvider === 'whisper' && (
                                                    <div className="bg-bg-card rounded-xl border border-border-subtle p-4 space-y-2">
                                                        <label className="text-xs font-medium text-text-secondary block">Local Fallback</label>
                                                        <p className="text-xs text-text-secondary">
                                                            Whisper is only used after the active provider and Google fail. It does not replace the primary realtime stream.
                                                        </p>
                                                        <p className="text-[10px] text-text-tertiary">
                                                            No API key is required here. If local Whisper is unavailable, TeamSync enters degraded mode and warns that speech recognition is temporarily unavailable.
                                                        </p>
                                                    </div>
                                                )}

                                                {/* Recognition Language Family */}
                                                <CustomSelect
                                                    label="Language"
                                                    icon={<Globe size={14} />}
                                                    value={selectedSttGroup}
                                                    options={languageGroups.map(g => ({
                                                        deviceId: g,
                                                        label: g,
                                                        kind: 'audioinput' as MediaDeviceKind,
                                                        groupId: '',
                                                        toJSON: () => ({})
                                                    }))}
                                                    onChange={handleGroupChange}
                                                    placeholder="Select Language"
                                                />

                                                {/* Variant/Accent Selector (Conditional) */}
                                                {currentGroupVariants.length > 1 && (
                                                    <div className="mt-3 animated fadeIn">
                                                        <CustomSelect
                                                            label="Accent / Region"
                                                            icon={<MapPin size={14} />}
                                                            value={recognitionLanguage}
                                                            options={currentGroupVariants}
                                                            onChange={handleLanguageChange}
                                                            placeholder="Select Region"
                                                        />
                                                    </div>
                                                )}

                                                <div className="flex gap-2 items-center mt-2 px-1">
                                                    <Info size={14} className="text-text-secondary shrink-0" />
                                                    <p className="text-xs text-text-secondary">
                                                        {recognitionLanguage === 'auto'
                                                            ? autoDetectedLanguage
                                                                ? (() => {
                                                                    const label = Object.values(availableLanguages).find((l: any) =>
                                                                        l.bcp47 === autoDetectedLanguage || l.iso639 === autoDetectedLanguage
                                                                    )?.label as string | undefined;
                                                                    return `Auto mode — detected: ${label ?? autoDetectedLanguage}`;
                                                                })()
                                                                : 'Auto mode — language will be detected from the first few seconds of audio.'
                                                            : 'Select the primary language being spoken in the meeting.'
                                                        }
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="h-px bg-border-subtle" />

                                        {/* ── Audio Configuration Section ── */}
                                        <div>
                                            <h3 className="text-lg font-bold text-text-primary mb-1">Audio Configuration</h3>
                                            <p className="text-xs text-text-secondary mb-5">Manage input and output devices.</p>

                                            <div className="space-y-4">
                                                <CustomSelect
                                                    label="Input Device"
                                                    icon={<Mic size={16} />}
                                                    value={selectedInput}
                                                    options={inputDevices}
                                                    onChange={(id) => {
                                                        setSelectedInput(id);
                                                        localStorage.setItem('preferredInputDeviceId', id);
                                                    }}
                                                    placeholder="Default Microphone"
                                                />

                                                <div>
                                                    <div className="flex justify-between text-xs text-text-secondary mb-2 px-1">
                                                        <span>Input Level</span>
                                                        <button
                                                            onClick={() => setMicTestActive(prev => !prev)}
                                                            className={`text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors ${
                                                                micTestActive
                                                                    ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25'
                                                                    : 'bg-bg-item-surface text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50 border border-border-subtle'
                                                            }`}
                                                        >
                                                            {micTestActive ? 'Stop Test' : 'Test Mic'}
                                                        </button>
                                                    </div>
                                                    <div className="h-1.5 bg-bg-input rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full transition-all duration-100 ease-out ${micTestActive ? 'bg-green-500' : 'bg-gray-600'}`}
                                                            style={{ width: `${micLevel}%` }}
                                                        />
                                                    </div>
                                                    {!micTestActive && (
                                                        <p className="text-[10px] text-text-tertiary mt-1.5 px-1">Click "Test Mic" to check your microphone input level</p>
                                                    )}
                                                </div>

                                                <div className="h-px bg-border-subtle my-2" />

                                                <CustomSelect
                                                    label="Output Device"
                                                    icon={<Speaker size={16} />}
                                                    value={selectedOutput}
                                                    options={outputDevices}
                                                    onChange={(id) => {
                                                        setSelectedOutput(id);
                                                        localStorage.setItem('preferredOutputDeviceId', id);
                                                    }}
                                                    placeholder="Default Speakers"
                                                />

                                                <div className="flex justify-end">
                                                    <button
                                                        onClick={async () => {
                                                            try {
                                                                const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
                                                                if (!AudioContext) {
                                                                    console.error("Web Audio API not supported");
                                                                    return;
                                                                }

                                                                const ctx = new AudioContext();

                                                                if (ctx.state === 'suspended') {
                                                                    await ctx.resume();
                                                                }

                                                                const oscillator = ctx.createOscillator();
                                                                const gainNode = ctx.createGain();

                                                                oscillator.connect(gainNode);
                                                                gainNode.connect(ctx.destination);

                                                                oscillator.type = 'sine';
                                                                oscillator.frequency.setValueAtTime(523.25, ctx.currentTime);
                                                                gainNode.gain.setValueAtTime(0.5, ctx.currentTime);
                                                                gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.0);

                                                                if (selectedOutput && (ctx as any).setSinkId) {
                                                                    try {
                                                                        await (ctx as any).setSinkId(selectedOutput);
                                                                    } catch (e) {
                                                                        console.warn("Error setting sink for AudioContext", e);
                                                                    }
                                                                }

                                                                oscillator.start();
                                                                oscillator.stop(ctx.currentTime + 1.0);
                                                            } catch (e) {
                                                                console.error("Error playing test sound", e);
                                                            }
                                                        }}
                                                        className="text-xs bg-bg-input hover:bg-bg-elevated text-text-primary px-3 py-1.5 rounded-md transition-colors flex items-center gap-2"
                                                    >
                                                        <Speaker size={12} /> Test Sound
                                                    </button>
                                                </div>

                                                <div className="h-px bg-border-subtle my-2" />

                                                {/* SCK Backend Toggle */}
                                                <div className="bg-amber-500/5 rounded-xl border border-amber-500/20 p-4">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-start gap-3">
                                                            <div className="mt-0.5 p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                                                                <FlaskConical size={18} />
                                                            </div>
                                                            <div>
                                                                <div className="flex items-center gap-2 mb-0.5">
                                                                    <h3 className="text-sm font-bold text-text-primary">SCK Backend</h3>
                                                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-400 uppercase tracking-wide">Alternative</span>
                                                                </div>
                                                                <p className="text-xs text-text-secondary leading-relaxed max-w-[300px]">
                                                                    Use the ScreenCaptureKit backend. An optimized alternative to CoreAudio if you experience any capture issues.
                                                                </p>
                                                            </div>
                                                        </div>
                                                        {renderSettingsSwitch({
                                                            checked: useExperimentalSck,
                                                            onToggle: () => {
                                                                const newState = !useExperimentalSck;
                                                                setUseExperimentalSck(newState);
                                                                window.localStorage.setItem('useExperimentalSckBackend', newState ? 'true' : 'false');
                                                            },
                                                            label: 'Toggle ScreenCaptureKit backend',
                                                            tone: 'amber',
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}


                                {activeTab === 'calendar' && (
                                    <div className="space-y-6 animated fadeIn h-full">
                                        <div>
                                            <h3 className="text-lg font-bold text-text-primary mb-2">Visible Calendars</h3>
                                            <p className="text-xs text-text-secondary mb-4">Upcoming meetings are synchronized from these calendars</p>
                                        </div>

                                        <div className="bg-bg-card rounded-xl p-6 border border-border-subtle flex flex-col items-start gap-4">
                                            {calendarStatus.connected ? (
                                                <div className="w-full flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500">
                                                            <Calendar size={20} />
                                                        </div>
                                                        <div>
                                                            <h4 className="text-sm font-medium text-text-primary">Google Calendar</h4>
                                                            <p className="text-xs text-text-secondary">Connected as {calendarStatus.email || 'User'}</p>
                                                        </div>
                                                    </div>

                                                    <button
                                                        onClick={handleDisconnectCalendar}
                                                        disabled={isCalendarsLoading}
                                                        className="px-3 py-1.5 bg-bg-input hover:bg-bg-elevated border border-border-subtle text-text-primary rounded-md text-xs font-medium transition-colors"
                                                    >
                                                        {isCalendarsLoading ? 'Disconnecting...' : 'Disconnect'}
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="w-full rounded-2xl border border-dashed border-border-subtle bg-bg-input/35 p-5">
                                                    <div className="max-w-[480px]">
                                                        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle bg-bg-card text-text-tertiary">
                                                            <Calendar size={20} />
                                                        </div>
                                                        <h4 className="text-sm font-bold text-text-primary mb-1">Connect Calendar for meeting context</h4>
                                                        <p className="text-xs leading-relaxed text-text-secondary">
                                                            TeamSync can surface your next meeting, attendees, and preparation context before capture starts.
                                                        </p>
                                                    </div>
                                                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                                                        {['Next meeting', 'Participants', 'Preparation notes'].map((benefit) => (
                                                            <div key={benefit} className="flex items-center gap-2 rounded-lg bg-bg-card px-3 py-2 text-[11px] font-medium text-text-secondary">
                                                                <CheckCircle size={13} className="text-emerald-500" />
                                                                <span className="truncate">{benefit}</span>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    <button
                                                        onClick={handleConnectCalendar}
                                                        disabled={isCalendarsLoading}
                                                        className={`mt-5 px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2.5 active:scale-[0.98] disabled:opacity-60 ${isLight ? 'bg-bg-component hover:bg-bg-item-surface text-text-primary border border-border-subtle' : 'bg-[#303033] hover:bg-[#3A3A3D] text-white'}`}
                                                    >
                                                        <svg viewBox="0 0 24 24" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
                                                            <g transform="matrix(1, 0, 0, 1, 27.009001, -39.238998)">
                                                                <path fill="#4285F4" d="M -3.264 51.509 C -3.264 50.719 -3.334 49.969 -3.454 49.239 L -14.754 49.239 L -14.754 53.749 L -8.284 53.749 C -8.574 55.229 -9.424 56.479 -10.684 57.329 L -10.684 60.329 L -6.824 60.329 C -4.564 58.239 -3.264 55.159 -3.264 51.509 Z" />
                                                                <path fill="#34A853" d="M -14.754 63.239 C -11.514 63.239 -8.804 62.159 -6.824 60.329 L -10.684 57.329 C -11.764 58.049 -13.134 58.489 -14.754 58.489 C -17.884 58.489 -20.534 56.379 -21.484 53.529 L -25.464 53.529 L -25.464 56.619 C -23.494 60.539 -19.444 63.239 -14.754 63.239 Z" />
                                                                <path fill="#FBBC05" d="M -21.484 53.529 C -21.734 52.809 -21.864 52.039 -21.864 51.239 C -21.864 50.439 -21.734 49.669 -21.484 48.949 L -21.484 45.859 L -25.464 45.859 C -26.284 47.479 -26.754 49.299 -26.754 51.239 C -26.754 53.179 -26.284 54.999 -25.464 56.619 L -21.484 53.529 Z" />
                                                                <path fill="#EA4335" d="M -14.754 43.989 C -12.984 43.989 -11.404 44.599 -10.154 45.789 L -6.734 42.369 C -8.804 40.429 -11.514 39.239 -14.754 39.239 C -19.444 39.239 -23.494 41.939 -25.464 45.859 L -21.484 48.949 C -20.534 46.099 -17.884 43.989 -14.754 43.989 Z" />
                                                            </g>
                                                        </svg>
                                                        {isCalendarsLoading ? 'Connecting...' : 'Connect Google'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'help' && (
                                    <HelpSettings onNavigate={setActiveTab} />
                                )}

                                {activeTab === 'about' && (
                                    <AboutSection />
                                )}
                                    </motion.div>
                                </AnimatePresence>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )
            }
            {isOpen && deleteProfileConfirmOpen && (
                <motion.div
                    key="delete-profile-intelligence-confirmation"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                    className="fixed inset-0 z-[3200] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
                >
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="delete-profile-intelligence-title"
                        aria-describedby="delete-profile-intelligence-description"
                        initial={{ opacity: 0, scale: 0.96, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 12 }}
                        transition={{ duration: 0.16 }}
                        className="w-full max-w-[460px] rounded-2xl border border-red-500/25 bg-bg-elevated p-5 shadow-[0_24px_70px_rgba(0,0,0,0.45)]"
                    >
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 text-red-400">
                                <AlertCircle size={18} />
                            </div>
                            <div className="min-w-0">
                                <h3 id="delete-profile-intelligence-title" className="text-[16px] font-semibold text-text-primary">
                                    Delete Profile Intelligence?
                                </h3>
                                <p id="delete-profile-intelligence-description" className="mt-2 text-[12px] leading-relaxed text-text-secondary">
                                    This permanently removes Resume, Job Description, AOT results, Snapshots, Dossiers, Notes, and Profile Intelligence from this device.
                                </p>
                            </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {deleteProfileScopeItems.map((item) => (
                                <div key={item} className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-input/60 px-3 py-2 text-[11px] font-medium text-text-secondary">
                                    <CheckCircle size={12} className="text-text-tertiary" />
                                    <span>{item}</span>
                                </div>
                            ))}
                        </div>

                        {deleteProfileStatus?.variant === 'error' && (
                            <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-400" role="alert">
                                <AlertCircle size={13} />
                                {deleteProfileStatus.message}
                            </div>
                        )}

                        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={() => setDeleteProfileConfirmOpen(false)}
                                disabled={deleteProfileDeleting}
                                className="rounded-lg border border-border-subtle bg-bg-input px-4 py-2 text-[12px] font-semibold text-text-secondary transition-all hover:bg-bg-item-surface hover:text-text-primary active:scale-[0.98] disabled:opacity-60"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteProfileIntelligence}
                                disabled={deleteProfileDeleting}
                                className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500 px-4 py-2 text-[12px] font-semibold text-white transition-all hover:bg-red-400 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
                            >
                                {deleteProfileDeleting ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                {deleteProfileDeleting ? 'Deleting...' : 'Delete Profile Intelligence'}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
            <PremiumUpgradeModal
                isOpen={isPremiumModalOpen}
                onClose={() => setIsPremiumModalOpen(false)}
                isPremium={isPremium}
                onActivated={async () => {
                    setIsPremium(true);
                    const status = await window.electronAPI?.profileGetStatus?.();
                    if (status) setProfileStatus(status);
                }}
                onDeactivated={() => {
                    setIsPremium(false);
                    // Auto-disable profile mode in UI when license is removed
                    setProfileStatus(prev => ({ ...prev, profileMode: false }));
                }}
            />

            {/* ------------------------------------------------------------------ */}
            {/* Live Preview — mockup sits below the z-50 modal                    */}
            {/* ------------------------------------------------------------------ */}
            {/* ------------------------------------------------------------------ */}
            {/* Live Preview — mockup sits below the z-50 modal                    */}
            {/* ALWAYS MOUNTED to prevent React AnimatePresence lag spikes         */}
            {/* ------------------------------------------------------------------ */}
            <div
                id="settings-mockup-wrapper"
                className="fixed inset-0 z-[49] pointer-events-none transition-opacity duration-150"
                style={{ opacity: isPreviewingOpacity ? 1 : 0 }}
            >
                <MockupTeamSyncInterface opacity={previewOverlayOpacity} />
            </div>
        </AnimatePresence >
    );
};

export default SettingsOverlay;
