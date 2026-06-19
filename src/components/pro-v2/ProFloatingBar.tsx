/**
 * ProFloatingBar.tsx — Surface 1
 * 
 * Floating command pill. Most opaque glass surface.
 * Contains: pause, waveform, timer, Ask AI input, screen scan, show/hide, end.
 */

import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { motion } from 'framer-motion';
import {
    Maximize2,
    Minimize2,
    Pause,
    Play,
    ScanSearch,
    SendHorizontal,
    Sparkles,
    Square,
} from 'lucide-react';
import icon from '../icon.png';
import { AnimatePresence } from 'framer-motion';

interface ProFloatingBarProps {
    isExpanded: boolean;
    isProcessing: boolean;
    isMeetingActive: boolean;
    isTranscriptPaused: boolean;
    hasAttachments?: boolean;
    meetingStartTime: number;
    inputValue: string;
    onToggleExpanded: () => void;
    onEndMeeting: () => void;
    onReset: () => void;
    onSubmit: (text: string) => void;
    onInputChange: (val: string) => void;
    onScreenScan: () => void;
    onToggleTranscriptPause: () => void;
    onOpenLauncher: () => void;
    stealthTapActive?: boolean;
    // Skill picker
    showSkillPicker?: boolean;
    filteredSkills?: Array<{ id: string; name: string; description: string }>;
    skillPickerIndex?: number;
    onSkillPickerIndexChange?: (index: number | ((prev: number) => number)) => void;
    onSelectSkill?: (skillId: string) => void;
}

const ProFloatingBar = memo<ProFloatingBarProps>(function ProFloatingBar({
    isExpanded,
    isProcessing,
    isMeetingActive,
    isTranscriptPaused,
    hasAttachments = false,
    meetingStartTime,
    inputValue,
    onToggleExpanded,
    onEndMeeting,
    onReset: _onReset,
    onSubmit,
    onInputChange,
    onScreenScan: onScreenScanProp,
    onToggleTranscriptPause,
    onOpenLauncher,
    stealthTapActive: _stealthTapActive = false,
    showSkillPicker = false,
    filteredSkills = [],
    skillPickerIndex = 0,
    onSkillPickerIndexChange,
    onSelectSkill,
}) {
    const [elapsed, setElapsed] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const scanTriggeredRef = useRef(false);

    // Reset scan trigger when processing finishes
    useEffect(() => {
        if (!isProcessing) scanTriggeredRef.current = false;
    }, [isProcessing]);

    const isScanActive = isProcessing && scanTriggeredRef.current;

    // Timer
    useEffect(() => {
        const interval = setInterval(() => {
            setElapsed(Math.floor((Date.now() - meetingStartTime) / 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, [meetingStartTime]);

    const formatTime = (secs: number): string => {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
        e.stopPropagation();

        // Skill picker keyboard navigation
        if (showSkillPicker && filteredSkills.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                onSkillPickerIndexChange?.((i: number) => Math.min(i + 1, filteredSkills.length - 1));
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                onSkillPickerIndexChange?.((i: number) => Math.max(i - 1, 0));
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                onSelectSkill?.(filteredSkills[skillPickerIndex]?.id);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                onInputChange('');
                return;
            }
        }

        if (e.key === 'Enter' && (inputValue.trim() || hasAttachments)) {
            e.preventDefault();
            onSubmit(inputValue);
        } else if (e.key === 'Escape') {
            onInputChange('');
            inputRef.current?.blur();
        }
    }, [hasAttachments, inputValue, onSubmit, onInputChange, showSkillPicker, filteredSkills, skillPickerIndex, onSkillPickerIndexChange, onSelectSkill]);

    const handleSendClick = useCallback(() => {
        if (inputValue.trim() || hasAttachments) {
            onSubmit(inputValue);
        } else {
            inputRef.current?.focus();
        }
    }, [hasAttachments, inputValue, onSubmit]);

    return (
        <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className={`v2-surface-bar v2-draggable ${!isMeetingActive ? 'v2-surface-bar--paused' : ''}`}
        >
            {/* Pause/Resume */}
            <div className="relative group" style={{ display: 'flex', alignItems: 'center' }}>
                <button
                    type="button"
                    onClick={onToggleTranscriptPause}
                    className={`v2-no-drag v2-transcript-pause-btn ${isTranscriptPaused ? 'v2-transcript-pause-btn--paused' : 'v2-transcript-pause-btn--listening'}`}
                    aria-pressed={isTranscriptPaused}
                    aria-label={isTranscriptPaused ? 'Resume Listening' : 'Pause Listening'}
                >
                    <span className="v2-transcript-pause-btn__icon" aria-hidden="true">
                        {isTranscriptPaused ? (
                            <Play size={12} strokeWidth={2.2} />
                        ) : (
                            <Pause size={12} strokeWidth={2.2} />
                        )}
                    </span>
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    {isTranscriptPaused ? 'Resume Listening' : 'Pause Listening'}
                </div>
            </div>

            {/* Waveform + Timer */}
            <div className="v2-bar-status">
                <div className={`v2-waveform ${!isMeetingActive ? 'v2-waveform-paused' : ''}`} aria-hidden="true">
                    <div className="v2-waveform-bar" />
                    <div className="v2-waveform-bar" />
                    <div className="v2-waveform-bar" />
                    <div className="v2-waveform-bar" />
                    <div className="v2-waveform-bar" />
                </div>
                <span className="v2-bar-timer">
                    {formatTime(elapsed)}
                </span>
            </div>

            {/* Logo — Back to Launcher */}
            <div className="relative group" style={{ display: 'flex', alignItems: 'center' }}>
                <button
                    type="button"
                    className="v2-no-drag v2-bar-logo-btn"
                    onClick={onOpenLauncher}
                    aria-label="Back to Launcher"
                >
                    <img src={icon} alt="" className="v2-bar-logo-img" draggable="false" />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    Back to Launcher
                </div>
            </div>

            <div className="v2-bar-sep" />

            {/* Ask AI input */}
            <div className="v2-no-drag v2-bar-input-shell" data-stealth-engage="true" style={{ position: 'relative' }}>
                {/* Skill picker dropdown */}
                <AnimatePresence>
                    {showSkillPicker && (
                        <div
                            style={{
                                position: 'absolute',
                                bottom: 'calc(100% + 6px)',
                                left: 0,
                                right: 0,
                                borderRadius: 12,
                                border: '1px solid rgba(255,255,255,0.12)',
                                background: 'rgba(28,28,30,0.96)',
                                backdropFilter: 'blur(20px)',
                                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                                overflow: 'hidden',
                                zIndex: 100,
                                maxHeight: 220,
                                overflowY: 'auto',
                            }}
                        >
                            <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.3)' }}>Skills</div>
                            {filteredSkills.map((skill, idx) => (
                                <button
                                    key={skill.id}
                                    type="button"
                                    onClick={() => onSelectSkill?.(skill.id)}
                                    onMouseEnter={() => onSkillPickerIndexChange?.(idx)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 10,
                                        width: '100%',
                                        padding: '8px 12px',
                                        border: 'none',
                                        background: idx === skillPickerIndex ? 'rgba(255,255,255,0.08)' : 'transparent',
                                        color: 'inherit',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        transition: 'background 100ms ease',
                                        fontSize: 12,
                                    }}
                                >
                                    <div style={{
                                        width: 24, height: 24, borderRadius: 6,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                        background: 'rgba(139,92,246,0.15)', color: 'rgba(167,139,250,0.9)',
                                        fontSize: 11,
                                    }}>
                                        ⚡
                                    </div>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ fontWeight: 600, color: 'rgba(255,255,255,0.9)', fontSize: 12 }}>{skill.name}</div>
                                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill.description}</div>
                                    </div>
                                    <span style={{ fontSize: 10, fontFamily: 'monospace', flexShrink: 0, color: 'rgba(255,255,255,0.2)' }}>${skill.id}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </AnimatePresence>
                <Sparkles size={13} strokeWidth={2} className="v2-bar-input-icon" aria-hidden="true" />
                <input
                    ref={inputRef}
                    className="v2-bar-input"
                    value={inputValue}
                    onChange={e => onInputChange(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    onKeyUp={e => e.stopPropagation()}
                    onKeyPress={e => e.stopPropagation()}
                    placeholder={hasAttachments ? 'Ask with context...' : 'Ask AI'}
                />
                {(inputValue.trim() || hasAttachments) ? (
                    <button
                        type="button"
                        onClick={handleSendClick}
                        className="v2-bar-send-btn"
                        aria-label="Send message"
                    >
                        <SendHorizontal size={12} strokeWidth={2.4} />
                    </button>
                ) : (
                    <span className="v2-bar-shortcut-hint" aria-hidden="true">
                        <kbd>↵</kbd>
                    </span>
                )}
            </div>

            <div className="v2-bar-sep" />

            {/* Screen Scan */}
            <div className="relative group">
                <button
                    type="button"
                    onClick={() => { scanTriggeredRef.current = true; onScreenScanProp(); }}
                    className={`v2-no-drag v2-bar-btn v2-bar-btn--scan ${isScanActive ? 'v2-bar-btn--scanning' : ''}`}
                    aria-label="Analyse screen"
                    disabled={isProcessing}
                >
                    <ScanSearch size={14} strokeWidth={2.1} style={isScanActive ? { animation: 'spin 1.2s linear infinite' } : undefined} />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    {isScanActive ? 'Analysing…' : 'Analyse Screen'}
                </div>
            </div>

            {/* Show/Hide */}
            <div className="relative group">
                <button
                    type="button"
                    onClick={onToggleExpanded}
                    className="v2-no-drag v2-bar-btn"
                    aria-label={isExpanded ? 'Hide panels' : 'Show panels'}
                >
                    {isExpanded ? (
                        <Minimize2 size={14} strokeWidth={2.1} />
                    ) : (
                        <Maximize2 size={14} strokeWidth={2.1} />
                    )}
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    {isExpanded ? 'Hide panels' : 'Show panels'}
                </div>
            </div>

            {/* End Meeting */}
            <div className="relative group">
                <button
                    type="button"
                    onClick={onEndMeeting}
                    className="v2-no-drag v2-bar-btn v2-bar-btn--end"
                    aria-label="End meeting"
                >
                    <Square size={12} strokeWidth={2.3} fill="currentColor" />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    End Meeting
                </div>
            </div>
        </motion.div>
    );
});

export default ProFloatingBar;
