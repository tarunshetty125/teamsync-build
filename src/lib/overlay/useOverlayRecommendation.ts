import { useCallback, useEffect, useRef, useState } from 'react';
import {
    getRecommendedOverlayAction,
    type OverlayCopilotModeId,
    type OverlayRecommendationId,
} from '../modes/overlayCopilotConfig';
import { normalizeTranscript } from './overlayIntent';

type UseOverlayRecommendationOptions = {
    overlayCopilotMode: OverlayCopilotModeId;
    detectedQuestionType: string;
    isMeetingActive: boolean;
    lastFinalSentenceRef: React.RefObject<string>;
    currentQuestionTurnId: string;
};

/**
 * Debounced recommended-action highlight (V1 parity).
 * Recomputes when copilot mode / detection changes, not only on new transcript turns.
 */
export function useOverlayRecommendation({
    overlayCopilotMode,
    detectedQuestionType,
    isMeetingActive,
    lastFinalSentenceRef,
    currentQuestionTurnId,
}: UseOverlayRecommendationOptions) {
    const [recommendedButton, setRecommendedButton] =
        useState<OverlayRecommendationId>('what_to_answer');
    const recommendedButtonRef = useRef<OverlayRecommendationId>('what_to_answer');
    const recommendationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const recommendationLockTurnIdRef = useRef<string | null>(null);

    const applyRecommendation = useCallback(() => {
        const combined = normalizeTranscript(lastFinalSentenceRef.current?.trim() || '');
        const nextRecommendation = getRecommendedOverlayAction(overlayCopilotMode, combined);
        if (nextRecommendation !== recommendedButtonRef.current) {
            recommendedButtonRef.current = nextRecommendation;
            setRecommendedButton(nextRecommendation);
        }
    }, [overlayCopilotMode, lastFinalSentenceRef]);

    const resetRecommendation = useCallback(() => {
        if (recommendationTimerRef.current) {
            clearTimeout(recommendationTimerRef.current);
            recommendationTimerRef.current = null;
        }
        recommendationLockTurnIdRef.current = null;
        recommendedButtonRef.current = 'what_to_answer';
        setRecommendedButton('what_to_answer');
    }, []);

    useEffect(() => {
        if (!isMeetingActive) return;
        applyRecommendation();
    }, [overlayCopilotMode, detectedQuestionType, isMeetingActive, applyRecommendation]);

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
        unlockRecommendationForTurn: () => {
            recommendationLockTurnIdRef.current = null;
        },
    };
}
