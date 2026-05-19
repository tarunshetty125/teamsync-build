import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { MessageSquare, Camera, Zap } from 'lucide-react';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

const SettingsPopup = () => {
    const { shortcuts } = useShortcuts();
    const isLightTheme = useResolvedTheme() === 'light';
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [useGroqFastText, setUseGroqFastText] = useState(() => {
        return localStorage.getItem('teamsync_groq_fast_text') === 'true';
    });
    const isFirstRender = React.useRef(true);

    const [hasStoredKey, setHasStoredKey] = useState<Record<string, boolean>>({});

    // Load credentials func
    const loadCredentials = async () => {
        try {
            // @ts-ignore
            const creds = await window.electronAPI?.getStoredCredentials?.();
            if (creds) {
                setHasStoredKey({
                    gemini: !!creds.hasGeminiKey,
                    groq: !!creds.hasGroqKey,
                    openai: !!creds.hasOpenaiKey,
                    claude: !!creds.hasClaudeKey,
                    teamsync: !!creds.hasTeamSyncKey
                });
            }
        } catch (e) {
            console.error("Failed to load settings:", e);
        }
    };

    // Load Initial Data and refresh on focus
    useEffect(() => {
        loadCredentials();
        const handleFocus = () => loadCredentials();
        window.addEventListener('focus', handleFocus);

        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    // Fetch initial undetectable state from main process (source of truth)
    useEffect(() => {
        if (window.electronAPI?.getUndetectable) {
            window.electronAPI.getUndetectable().then((state: boolean) => {
                setIsUndetectable(state);
            });
        }
    }, []);

    // One-way listener: receive state changes from main process, never echo back
    useEffect(() => {
        if (window.electronAPI?.onUndetectableChanged) {
            const unsubscribe = window.electronAPI.onUndetectableChanged((newState: boolean) => {
                setIsUndetectable(newState);
                localStorage.setItem('teamsync_undetectable', String(newState));
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        // Listen for changes from other windows (2-way sync)
        if (window.electronAPI?.onGroqFastTextChanged) {
            const unsubscribe = window.electronAPI.onGroqFastTextChanged((enabled: boolean) => {
                setUseGroqFastText(enabled);
                localStorage.setItem('teamsync_groq_fast_text', String(enabled));
            });
            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        // Skip initial render to avoid unnecessary IPC calls
        if (isFirstRender.current) {
            isFirstRender.current = false;
            // Ensure backend is synced on mount (even if no change)
            try {
                // @ts-ignore
                window.electronAPI?.invoke('set-groq-fast-text-mode', useGroqFastText);
            } catch (e) {
                console.error(e);
            }
            return;
        }

        // Apply Groq Text Mode
        localStorage.setItem('teamsync_groq_fast_text', String(useGroqFastText));
        try {
            // @ts-ignore - electronAPI not typed in this file yet
            window.electronAPI?.invoke('set-groq-fast-text-mode', useGroqFastText);
        } catch (e) {
            console.error(e);
        }
    }, [useGroqFastText]);

    const [actionButtonMode, setActionButtonModeState] = useState<'recap' | 'brainstorm'>('recap');

    // Interview Mode (Brainstorm/Recap) — synced via localStorage
    const [brainstormEnabled, setBrainstormEnabled] = useState(() => {
        try { return localStorage.getItem('teamsync_brainstorm_enabled') !== 'false'; } catch { return true; }
    });

    const [showTranscript, setShowTranscript] = useState(() => {
        const stored = localStorage.getItem('teamsync_interviewer_transcript');
        return stored !== 'false'; // Default to true if not set
    });

    // Profile Intelligence state — synced with Settings panel via IPC
    const [profileModeOn, setProfileModeOn] = useState(false);
    const [profileAvailable, setProfileAvailable] = useState(false);

    // Shared refresh: re-fetch authoritative status from main process
    const refreshProfileStatus = React.useCallback(() => {
        window.electronAPI?.profileGetStatus?.().then((status) => {
            if (status) {
                setProfileModeOn(status.profileMode ?? false);
                setProfileAvailable(status.hasProfile ?? false);
            }
        }).catch(() => {});
    }, []);

    // Load profile status on mount
    useEffect(() => { refreshProfileStatus(); }, [refreshProfileStatus]);

    // Unidirectional: reflect profile mode changes broadcast by main process
    useEffect(() => {
        if (!window.electronAPI?.onProfileModeChanged) return;
        const unsubscribe = window.electronAPI.onProfileModeChanged((enabled: boolean) => {
            setProfileModeOn(enabled);
            // Re-fetch full status so profileAvailable stays consistent
            refreshProfileStatus();
        });
        return () => unsubscribe();
    }, [refreshProfileStatus]);

    // Refresh when a resume is uploaded / deleted in the Settings panel
    useEffect(() => {
        if (!window.electronAPI?.onProfileUpdated) return;
        const unsubscribe = window.electronAPI.onProfileUpdated(() => {
            refreshProfileStatus();
        });
        return () => unsubscribe();
    }, [refreshProfileStatus]);

    // Refresh when the knowledge engine finishes restoring on startup
    useEffect(() => {
        if (!window.electronAPI?.onKnowledgeEngineReady) return;
        const unsubscribe = window.electronAPI.onKnowledgeEngineReady(() => {
            refreshProfileStatus();
        });
        return () => unsubscribe();
    }, [refreshProfileStatus]);

    useEffect(() => {
        const handleStorage = () => {
            const stored = localStorage.getItem('teamsync_interviewer_transcript');
            setShowTranscript(stored !== 'false');
        };

        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    // Load action button mode and subscribe to changes from other windows
    useEffect(() => {
        // @ts-ignore
        window.electronAPI?.getActionButtonMode?.()?.then((mode: 'recap' | 'brainstorm') => {
            setActionButtonModeState(mode ?? 'recap');
        }).catch(() => { });
        // @ts-ignore
        if (!window.electronAPI?.onActionButtonModeChanged) return;
        // @ts-ignore
        const unsubscribe = window.electronAPI.onActionButtonModeChanged((mode: 'recap' | 'brainstorm') => {
            setActionButtonModeState(mode);
        });
        return () => unsubscribe();
    }, []);

    const contentRef = useRef<HTMLDivElement>(null);

    // Auto-resize Window
    useLayoutEffect(() => {
        if (!contentRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const rect = entry.target.getBoundingClientRect();
                // Send exact dimensions to Electron
                try {
                    // @ts-ignore
                    window.electronAPI?.updateContentDimensions({
                        width: Math.ceil(rect.width),
                        height: Math.ceil(rect.height)
                    });
                } catch (e) {
                    console.warn("Failed to update dimensions", e);
                }
            }
        });

        observer.observe(contentRef.current);
        return () => observer.disconnect();
    }, []);

    // Use global liquid-glass class for frosted effect
    const popupPanelClass = 'liquid-glass';
    const itemHoverClass = isLightTheme ? 'hover:bg-black/[0.04]' : 'hover:bg-white/5';
    const labelInactiveClass = 'text-[#e63946] group-hover:text-[#d32f3b] transition-colors';
    const iconInactiveClass = 'text-[#e63946]/90 group-hover:text-[#d32f3b] transition-colors';
    const dividerClass = isLightTheme ? 'bg-black/[0.06]' : 'bg-white/[0.04]';
    const shortcutKeyClass = isLightTheme
        ? 'border-black/10 bg-black/[0.04] text-slate-600'
        : 'border-white/10 bg-white/5 text-slate-500';
    const defaultToggleTrackClass = isLightTheme ? 'bg-black/[0.22]' : 'bg-white/10';
    const toggleKnobClass = isLightTheme ? 'bg-white shadow-[0_1px_4px_rgba(0,0,0,0.18)]' : 'bg-black shadow-sm';

    return (
        <div className="w-fit h-fit bg-transparent flex flex-col">
            <div ref={contentRef} className={`w-[200px] max-h-[100vh] p-2 flex flex-col animate-scale-in origin-top-left ${popupPanelClass}`}>
                <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col min-h-0">

                    {/* Undetectability */}
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group cursor-default ${itemHoverClass}`}>
                        <div className="flex items-center gap-3">
                            <CustomGhost
                                className={`w-4 h-4 transition-colors ${isUndetectable ? (isLightTheme ? 'text-slate-900' : 'text-white') : iconInactiveClass}`}
                                fill={isUndetectable ? "currentColor" : "none"}
                                stroke={isUndetectable ? "none" : "currentColor"}
                                eyeColor={isUndetectable ? (isLightTheme ? "white" : "black") : (isLightTheme ? "#334155" : "white")}
                            />
                            <span className={`text-[12px] font-medium transition-colors ${isUndetectable ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>{isUndetectable ? 'Undetectable' : 'Detectable'}</span>
                        </div>
                        <button
                            onClick={() => {
                                const newState = !isUndetectable;
                                setIsUndetectable(newState);
                                localStorage.setItem('teamsync_undetectable', String(newState));
                                window.electronAPI?.setUndetectable(newState);
                            }}
                            className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${isUndetectable
                                ? (isLightTheme ? 'bg-slate-900 shadow-[0_2px_8px_rgba(15,23,42,0.18)]' : 'bg-white shadow-[0_2px_8px_rgba(255,255,255,0.2)]')
                                : defaultToggleTrackClass}`}
                        >
                            <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${isUndetectable ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                        </button>
                    </div>


                    {/* Groq (Fast Text) Toggle — enabled with Groq key OR TeamSync API key */}
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group ${!(hasStoredKey.groq || hasStoredKey.teamsync) ? 'opacity-50 grayscale cursor-not-allowed' : `${itemHoverClass} cursor-default`}`} title={!(hasStoredKey.groq || hasStoredKey.teamsync) ? "Requires Groq or TeamSync API key" : ""}>
                        <div className="flex items-center gap-3">
                            <Zap
                                className={`w-4 h-4 transition-colors ${useGroqFastText ? 'text-orange-500' : iconInactiveClass}`}
                                fill={useGroqFastText ? "currentColor" : "none"}
                            />
                            <span className={`text-[12px] font-medium transition-colors ${useGroqFastText ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Fast Response</span>
                        </div>
                        <button
                            onClick={() => {
                                if (!(hasStoredKey.groq || hasStoredKey.teamsync)) return;
                                setUseGroqFastText(!useGroqFastText);
                            }}
                            className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${useGroqFastText ? 'bg-orange-500 shadow-[0_2px_10px_rgba(249,115,22,0.3)]' : defaultToggleTrackClass}`}
                            disabled={!(hasStoredKey.groq || hasStoredKey.teamsync)}
                        >
                            <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${useGroqFastText ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    {/* Interviewer Transcript Toggle */}
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group cursor-default ${itemHoverClass}`}>
                        <div className="flex items-center gap-3">
                            <MessageSquare
                                className={`w-3.5 h-3.5 transition-colors ${showTranscript ? 'text-emerald-400' : iconInactiveClass}`}
                                fill={showTranscript ? "currentColor" : "none"}
                            />
                            <span className={`text-[12px] font-medium transition-colors ${showTranscript ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Transcript</span>
                        </div>
                        <button
                            onClick={() => {
                                const newState = !showTranscript;
                                setShowTranscript(newState);
                                localStorage.setItem('teamsync_interviewer_transcript', String(newState));
                                // Dispatch event for same-window listeners
                                window.dispatchEvent(new Event('storage'));
                            }}
                            className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${showTranscript ? 'bg-emerald-500 shadow-[0_2px_10px_rgba(16,185,129,0.3)]' : defaultToggleTrackClass}`}
                        >
                            <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${showTranscript ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                        </button>
                    </div>



                    {/* Profile Intelligence Toggle */}
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group ${!profileAvailable ? 'opacity-50 grayscale cursor-not-allowed' : `${itemHoverClass} cursor-default`}`} title={!profileAvailable ? 'Upload resume & JD in Settings first' : ''}>
                        <div className="flex items-center gap-3">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={`w-3.5 h-3.5 transition-colors ${profileModeOn ? 'text-blue-400' : iconInactiveClass}`}
                            >
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                <circle cx="12" cy="7" r="4" />
                            </svg>
                            <span className={`text-[12px] font-medium transition-colors ${profileModeOn ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Profile Intel</span>
                        </div>
                        <button
                            onClick={async () => {
                                if (!profileAvailable) return;
                                const newState = !profileModeOn;
                                setProfileModeOn(newState); // optimistic
                                try {
                                    const result = await window.electronAPI?.profileSetMode?.(newState);
                                    if (!result?.success) {
                                        setProfileModeOn(!newState); // revert
                                        console.error('Failed to toggle profile intelligence:', result?.error);
                                    }
                                } catch (e) {
                                    setProfileModeOn(!newState); // revert
                                    console.error('Failed to toggle profile intelligence:', e);
                                }
                            }}
                            className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${profileModeOn ? 'bg-blue-500 shadow-[0_2px_10px_rgba(59,130,246,0.3)]' : defaultToggleTrackClass}`}
                            disabled={!profileAvailable}
                        >
                            <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${profileModeOn ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    {/* Interview Mode Toggle — swaps Recap ↔ Brainstorm in action buttons */}
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group cursor-default ${itemHoverClass}`}>
                        <div className="flex items-center gap-3">
                            <span className={`text-[14px] transition-opacity ${brainstormEnabled ? 'opacity-100' : 'opacity-50'}`}>🧠</span>
                            <span className={`text-[12px] font-medium transition-colors ${brainstormEnabled ? (isLightTheme ? 'text-slate-950' : 'text-white') : labelInactiveClass}`}>Interview Mode</span>
                        </div>
                        <button
                            onClick={() => {
                                const next = !brainstormEnabled;
                                setBrainstormEnabled(next);
                                localStorage.setItem('teamsync_brainstorm_enabled', String(next));
                                window.dispatchEvent(new Event('storage'));
                            }}
                            className={`w-[30px] h-[18px] rounded-full p-[1.5px] transition-all duration-300 ease-spring active:scale-[0.92] ${brainstormEnabled ? 'bg-amber-500 shadow-[0_2px_10px_rgba(245,158,11,0.3)]' : defaultToggleTrackClass}`}
                        >
                            <div className={`w-[15px] h-[15px] rounded-full transition-transform duration-300 ease-spring ${toggleKnobClass} ${brainstormEnabled ? 'translate-x-[12px]' : 'translate-x-0'}`} />
                        </button>
                    </div>

                    <div className={`h-px my-0.5 mx-2 ${dividerClass}`} />

                    {/* Show/Hide TeamSync */}
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group interaction-base interaction-press ${itemHoverClass}`}>
                        <div className="flex items-center gap-3">
                            <MessageSquare className={`w-3.5 h-3.5 transition-colors ${iconInactiveClass}`} />
                            <span className={`text-[12px] transition-colors ${labelInactiveClass}`}>Show/Hide</span>
                        </div>
                        <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            {/* Dynamic Keys for Toggle Visibility */}
                            {(shortcuts.toggleVisibility || ['⌘', 'B']).map((key, index) => (
                                <div key={index} className={`px-1.5 py-0.5 rounded border text-[10px] font-medium min-w-[20px] text-center ${shortcutKeyClass}`}>
                                    {key}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Screenshot */}
                    <div className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors duration-200 group interaction-base interaction-press ${itemHoverClass}`}>
                        <div className="flex items-center gap-3">
                            <Camera className={`w-3.5 h-3.5 transition-colors ${iconInactiveClass}`} />
                            <span className={`text-[12px] transition-colors ${labelInactiveClass}`}>Screenshot</span>
                        </div>
                        <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            {/* Dynamic Keys for Take Screenshot */}
                            {(shortcuts.takeScreenshot || ['⌘', 'H']).map((key, index) => (
                                <div key={index} className={`px-1.5 py-0.5 rounded border text-[10px] font-medium min-w-[20px] text-center ${shortcutKeyClass}`}>
                                    {key}
                                </div>
                            ))}
                        </div>
                    </div>




                </div>
            </div>
        </div>
    );
};

interface CustomGhostProps {
    className?: string;
    fill?: string;
    stroke?: string;
    eyeColor?: string;
}

// Custom Ghost with dynamic eye color support
const CustomGhost = ({ className, fill, stroke, eyeColor }: CustomGhostProps) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill={fill || "none"}
        stroke={stroke || "currentColor"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        {/* Body */}
        <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
        {/* Eyes - No stroke, just fill */}
        <path
            d="M9 10h.01 M15 10h.01"
            stroke={eyeColor || "currentColor"}
            strokeWidth="2.5" // Slightly bolder for visibility
            fill="none"
        />
    </svg>
);

export default SettingsPopup;
