/**
 * ProFloatingBar.tsx — Surface 1
 * 
 * Floating command pill. Most opaque glass surface.
 * Contains: recording dot, waveform, timer, Ask TeamSync input, screen scan, show/hide, end.
 */

import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { motion } from 'framer-motion';

interface ProFloatingBarProps {
    isExpanded: boolean;
    isProcessing: boolean;
    isMeetingActive: boolean;
    meetingStartTime: number;
    inputValue: string;
    onToggleExpanded: () => void;
    onEndMeeting: () => void;
    onReset: () => void;
    onSubmit: (text: string) => void;
    onInputChange: (val: string) => void;
    onScreenScan: () => void;
}

const ProFloatingBar = memo<ProFloatingBarProps>(function ProFloatingBar({
    isExpanded,
    isProcessing: _isProcessing,
    isMeetingActive,
    meetingStartTime,
    inputValue,
    onToggleExpanded,
    onEndMeeting,
    onReset: _onReset,
    onSubmit,
    onInputChange,
    onScreenScan,
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

        if (e.key === 'Enter' && inputValue.trim()) {
            e.preventDefault();
            onSubmit(inputValue);
        } else if (e.key === 'Escape') {
            onInputChange('');
            inputRef.current?.blur();
        }
    }, [inputValue, onSubmit, onInputChange]);

    const handleSendClick = useCallback(() => {
        if (inputValue.trim()) {
            onSubmit(inputValue);
        } else {
            inputRef.current?.focus();
        }
    }, [inputValue, onSubmit]);

    return (
        <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="v2-surface-bar v2-draggable"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 8px 6px 14px',
                height: '44px',
                willChange: 'transform, opacity',
            }}
        >
            {/* Recording Dot */}
            <div className={`v2-recording-dot ${!isMeetingActive ? 'v2-recording-dot--paused' : ''}`} />

            {/* Waveform */}
            <div className={`v2-waveform v2-no-drag ${!isMeetingActive ? 'v2-waveform-paused' : ''}`}>
                <div className="v2-waveform-bar" />
                <div className="v2-waveform-bar" />
                <div className="v2-waveform-bar" />
                <div className="v2-waveform-bar" />
                <div className="v2-waveform-bar" />
            </div>

            {/* Timer */}
            <span className="v2-no-drag v2-bar-timer">
                {formatTime(elapsed)}
            </span>

            <div className="v2-bar-sep" />

            {/* Ask TeamSync — fixed width inline input */}
            <div
                className="v2-no-drag"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    position: 'relative',
                    flexShrink: 0,
                }}
            >
                {/* Search icon */}
                <div style={{
                    position: 'absolute',
                    left: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    pointerEvents: 'none',
                    color: 'rgba(255, 255, 255, 0.28)',
                    display: 'flex',
                    alignItems: 'center',
                    zIndex: 1,
                }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                    </svg>
                </div>

                <input
                    ref={inputRef}
                    className="v2-bar-input"
                    value={inputValue}
                    onChange={e => onInputChange(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    onKeyUp={e => e.stopPropagation()}
                    onKeyPress={e => e.stopPropagation()}
                    placeholder="Ask TeamSync..."
                />

                {/* Send button */}
                {inputValue.trim() && (
                    <button
                        onClick={handleSendClick}
                        style={{
                            position: 'absolute',
                            right: '3px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: '22px',
                            height: '22px',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            border: 'none',
                            background: 'rgba(139, 92, 246, 0.60)',
                            cursor: 'pointer',
                        }}
                    >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13" />
                            <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                    </button>
                )}
            </div>

            <div className="v2-bar-sep" />

            {/* Screen Scan — compact icon button */}
            <div className="relative group">
                <button
                    onClick={onScreenScan}
                    className="v2-no-drag v2-bar-btn"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                    </svg>
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    Analyse Screen
                </div>
            </div>

            {/* Show/Hide */}
            <div className="relative group">
                <button
                    onClick={onToggleExpanded}
                    className="v2-no-drag v2-bar-btn"
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {isExpanded ? (
                            <><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" /></>
                        ) : (
                            <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>
                        )}
                    </svg>
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    {isExpanded ? 'Hide panels' : 'Show panels'}
                </div>
            </div>

            {/* End Meeting */}
            <div className="relative group">
                <button
                    onClick={onEndMeeting}
                    className="v2-no-drag v2-bar-btn v2-bar-btn--end"
                >
                    <div style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '2px',
                        background: 'currentColor',
                    }} />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    End Meeting
                </div>
            </div>
        </motion.div>
    );
});

export default ProFloatingBar;
