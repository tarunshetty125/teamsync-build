import { useCallback, useEffect, useRef, useState } from 'react';
import type { OverlayCopilotModeId, OverlayQuickActionId } from '../modes/overlayCopilotConfig';
import { resolveRecommendedOverlayAction } from './overlayRecommendationResolver';
import type { DetectedQuestionType } from './overlayIntent';
import { normalizeTranscript } from './overlayIntent';
import type { InterviewFocusPreference } from '../personalization/preferences';

type UseOverlayRecommendationOptions = {
    overlayCopilotMode: OverlayCopilotModeId;
    detectedQuestionType: DetectedQuestionType;
    isMeetingActive: boolean;
    lastFinalSentenceRef: React.RefObject<string>;
    finalizedTranscriptRef: React.RefObject<string>;
    currentQuestionTurnId: string;
    activeQuickActionIds: OverlayQuickActionId[];
    interviewFocus?: InterviewFocusPreference;
    /** Bumps on each finalized transcript line so highlight updates without a new turn id. */
    transcriptRevision: string;
};

/**
 * Auto-highlight for the best quick action in the current visible set.
 * Works for every copilot mode (sales, lecture, coding, etc.) using transcript
 * pattern rules + intent classification fallback.
 */
export function useOverlayRecommendation({
    overlayCopilotMode,
    detectedQuestionType,
    isMeetingActive,
    lastFinalSentenceRef,
    finalizedTranscriptRef,
    currentQuestionTurnId,
    activeQuickActionIds,
    interviewFocus,
    transcriptRevision,
}: UseOverlayRecommendationOptions) {
    const visibleIdsRef = useRef(activeQuickActionIds);
    visibleIdsRef.current = activeQuickActionIds;

    const [recommendedButton, setRecommendedButton] = useState<OverlayQuickActionId>('what_to_answer');
    const recommendedButtonRef = useRef<OverlayQuickActionId>('what_to_answer');
    const recommendationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const recommendationLockTurnIdRef = useRef<string | null>(null);

    const buildCombinedTranscript = useCallback(() => {
        const recentFinalized = (finalizedTranscriptRef.current || '')
            .split('  ·  ')
            .filter(Boolean)
            .slice(-8)
            .join(' ')
            .slice(-1200)
            .trim();
        const latest = lastFinalSentenceRef.current?.trim() || '';
        return normalizeTranscript([recentFinalized, latest].filter(Boolean).join(' '));
    }, [finalizedTranscriptRef, lastFinalSentenceRef]);

    const applyRecommendation = useCallback(() => {
        const visible = visibleIdsRef.current;
        if (visible.length === 0) return;

        const combined = buildCombinedTranscript();
        const nextRecommendation = resolveRecommendedOverlayAction(
            overlayCopilotMode,
            combined,
            visible,
            { detectedQuestionType, interviewFocus },
        );

        if (nextRecommendation !== recommendedButtonRef.current) {
            recommendedButtonRef.current = nextRecommendation;
            setRecommendedButton(nextRecommendation);
        }
    }, [overlayCopilotMode, detectedQuestionType, interviewFocus, buildCombinedTranscript]);

    const resetRecommendation = useCallback(() => {
        if (recommendationTimerRef.current) {
            clearTimeout(recommendationTimerRef.current);
            recommendationTimerRef.current = null;
        }
        recommendationLockTurnIdRef.current = null;

        const visible = visibleIdsRef.current;
        const fallback = resolveRecommendedOverlayAction(overlayCopilotMode, '', visible, {
            detectedQuestionType: 'general',
            interviewFocus,
        });
        recommendedButtonRef.current = fallback;
        setRecommendedButton(fallback);
    }, [overlayCopilotMode, interviewFocus]);

    useEffect(() => {
        if (!isMeetingActive) return;
        if (currentQuestionTurnId && recommendationLockTurnIdRef.current === currentQuestionTurnId) return;
        applyRecommendation();
    }, [
        overlayCopilotMode,
        detectedQuestionType,
        isMeetingActive,
        applyRecommendation,
        currentQuestionTurnId,
        activeQuickActionIds.join(','),
        transcriptRevision,
    ]);

    useEffect(() => {
        if (!currentQuestionTurnId) return;
        if (recommendationLockTurnIdRef.current === currentQuestionTurnId) return;

        if (recommendationTimerRef.current) {
            clearTimeout(recommendationTimerRef.current);
        }

        recommendationTimerRef.current = setTimeout(() => {
            if (recommendationLockTurnIdRef.current === currentQuestionTurnId) return;
            applyRecommendation();
        }, 300);

        return () => {
            if (recommendationTimerRef.current) {
                clearTimeout(recommendationTimerRef.current);
                recommendationTimerRef.current = null;
            }
        };
    }, [currentQuestionTurnId, applyRecommendation]);

    return {
        recommendedButton,
        recommendedButtonRef,
        resetRecommendation,
        pinRecommendationForTurn: (buttonId: OverlayQuickActionId, turnId?: string | null) => {
            recommendationLockTurnIdRef.current = turnId || currentQuestionTurnId || null;
            recommendedButtonRef.current = buttonId;
            setRecommendedButton(buttonId);
        },
        unlockRecommendationForTurn: () => {
            recommendationLockTurnIdRef.current = null;
        },
    };
}
