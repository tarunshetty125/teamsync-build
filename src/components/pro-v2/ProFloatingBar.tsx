/**
 * ProFloatingBar.tsx — Surface 1
 * 
 * Floating command pill. Most opaque glass surface.
 * Contains: recording dot, waveform, timer, Ask TeamSync input, screen scan, show/hide, end.
 */

import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { motion } from 'framer-motion';
import {
    Maximize2,
    Minimize2,
    Pause,
    Play,
    ScanSearch,
    Search,
    SendHorizontal,
    Square,
} from 'lucide-react';
import icon from '../icon.png';

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
}

const ProFloatingBar = memo<ProFloatingBarProps>(function ProFloatingBar({
    isExpanded,
    isProcessing: _isProcessing,
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
    onScreenScan,
    onToggleTranscriptPause,
    onOpenLauncher,
}) {
    const [elapsed, setElapsed] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

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
        // Important for overlay: prevent any window-level key handlers from also
        // acting on keystrokes while the user is typing in the input.
        e.stopPropagation();

        if (e.key === 'Enter' && (inputValue.trim() || hasAttachments)) {
            e.preventDefault();
            onSubmit(inputValue);
        } else if (e.key === 'Escape') {
            onInputChange('');
            inputRef.current?.blur();
        }
    }, [hasAttachments, inputValue, onSubmit, onInputChange]);

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
            <div className="v2-bar-status">
                <button
                    type="button"
                    className="v2-no-drag v2-bar-logo-btn"
                    onClick={onOpenLauncher}
                    aria-label="Open launcher"
                    title="Open launcher"
                >
                    <img src={icon} alt="" className="v2-bar-logo-img" draggable="false" />
                </button>

                {/* Recording Dot */}
                <span className="v2-recording-dot-shell" aria-hidden="true">
                    <span className={`v2-recording-dot ${!isMeetingActive ? 'v2-recording-dot--paused' : ''}`} />
                </span>

                {/* Waveform */}
                <div className={`v2-waveform ${!isMeetingActive ? 'v2-waveform-paused' : ''}`} aria-hidden="true">
                    <div className="v2-waveform-bar" />
                    <div className="v2-waveform-bar" />
                    <div className="v2-waveform-bar" />
                    <div className="v2-waveform-bar" />
                    <div className="v2-waveform-bar" />
                </div>

                {/* Timer */}
                <span className="v2-bar-timer">
                    {formatTime(elapsed)}
                </span>
            </div>

            <div className="relative group">
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

            <div className="v2-bar-sep" />

            {/* Ask TeamSync — fixed width inline input */}
            <div className="v2-no-drag v2-bar-input-shell">
                <Search size={13} strokeWidth={2.2} className="v2-bar-input-icon" aria-hidden="true" />
                <input
                    ref={inputRef}
                    className="v2-bar-input"
                    value={inputValue}
                    onChange={e => onInputChange(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    onKeyUp={e => e.stopPropagation()}
                    onKeyPress={e => e.stopPropagation()}
                    placeholder={hasAttachments ? 'Ask with context...' : 'Ask TeamSync...'}
                />

                {/* Send button */}
                {(inputValue.trim() || hasAttachments) && (
                    <button
                        type="button"
                        onClick={handleSendClick}
                        className="v2-bar-send-btn"
                        aria-label="Send message"
                    >
                        <SendHorizontal size={12} strokeWidth={2.4} />
                    </button>
                )}
            </div>

            <div className="v2-bar-sep" />

            {/* Screen Scan — compact icon button */}
            <div className="relative group">
                <button
                    type="button"
                    onClick={onScreenScan}
                    className="v2-no-drag v2-bar-btn v2-bar-btn--scan"
                    aria-label="Analyse screen"
                >
                    <ScanSearch size={14} strokeWidth={2.1} />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    Analyse Screen
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
