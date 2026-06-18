import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useStealthKeyboard — shared hook for stealth keyboard tap integration.
 *
 * Captures keystrokes from the native CGEventTap (macOS) or hook
 * (Windows, future) and injects them into the chat input using the
 * append-only model (no cursor, no selection, no arrow navigation).
 *
 * TeamSync enhancement: Cmd+V paste support (not in production).
 *
 * Used by both TeamSyncInterface (V1) and TeamSyncCluelyOverlay (V2).
 */

export interface UseStealthKeyboardOptions {
  /** Current value of the text input. */
  inputValue: string;
  /** Setter for the text input value (React state setter). */
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  /** Setter to expand the overlay when stealth engages. */
  setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  /**
   * Submit function. Called when user presses Return while stealth is active.
   * Receives the current inputValue so both V1 (closure-based) and V2
   * (parameter-based) submit patterns work.
   */
  onSubmit: (text: string) => void;
}

export interface UseStealthKeyboardReturn {
  /** True when the native tap is actively capturing keystrokes. */
  stealthTapActive: boolean;
  /** True when the native tap failed to start due to missing macOS Accessibility permission. */
  stealthTapPermissionDenied: boolean;
  /** Opens macOS System Settings → Accessibility. */
  openAccessibilitySettings: () => void;
  /** Dismiss the permission warning (hides the toast until next session). */
  dismissPermissionWarning: () => void;
}

export function useStealthKeyboard({
  inputValue,
  setInputValue,
  setIsExpanded,
  onSubmit,
}: UseStealthKeyboardOptions): UseStealthKeyboardReturn {
  const [stealthTapActive, setStealthTapActive] = useState(false);
  const [stealthTapPermissionDenied, setStealthTapPermissionDenied] = useState(false);
  const stealthTapActiveRef = useRef(false);
  const stealthAutoEngageOkRef = useRef(false);
  const permissionWarningShownRef = useRef(false);

  // Keep a ref to the latest submit + inputValue so the keydown handler
  // always calls the most recent version without re-subscribing.
  const submitRef = useRef(onSubmit);
  const inputValueRef = useRef(inputValue);

  useEffect(() => {
    submitRef.current = onSubmit;
  });

  useEffect(() => {
    inputValueRef.current = inputValue;
  });

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onStealthKeyCaptured || !api?.onStealthTapState) return;

    // Subscribe to tap state changes
    const unsubState = api.onStealthTapState((state) => {
      setStealthTapActive(state.active);
      stealthTapActiveRef.current = state.active;
      if (state.active) {
        setIsExpanded(true);
        // Clear permission denied on successful activation
        setStealthTapPermissionDenied(false);
        permissionWarningShownRef.current = false;
      } else if (state.reason === 'permission' && !permissionWarningShownRef.current) {
        // Tap failed due to missing Accessibility permission — notify once per session
        setStealthTapPermissionDenied(true);
        permissionWarningShownRef.current = true;
      }
    });

    // Subscribe to captured key events
    const unsubKey = api.onStealthKeyCaptured((ev) => {
      // Escape → clear input, let main process disengage the tap
      if (ev.isKeyDown && ev.keyCode === 53) {
        setInputValue('');
        return;
      }

      // Only process keyDown events while tap is active
      if (!stealthTapActiveRef.current || !ev.isKeyDown) return;

      switch (ev.keyCode) {
        case 36:  // Return
        case 76:  // Numpad Enter
          submitRef.current(inputValueRef.current);
          api.stealthTapStop?.().catch(() => {});
          return;
        case 51:  // Backspace
          setInputValue(prev => prev.slice(0, -1));
          return;
        case 9:   // V key — Cmd+V paste (TeamSync enhancement)
          // CGEventTap sends empty chars for Cmd+key combos.
          // Detect keyCode 9 (V) with empty chars → paste.
          if (!ev.chars || ev.chars.length === 0) {
            try {
              navigator.clipboard.readText().then(text => {
                if (text) {
                  // Strip newlines to keep single-line model
                  const cleaned = text.replace(/[\r\n]+/g, ' ').trim();
                  if (cleaned) setInputValue(prev => prev + cleaned);
                }
              }).catch(() => {});
            } catch {}
            return;
          }
          break;
      }

      // Printable characters — append to input
      if (ev.chars && ev.chars.length > 0 && ev.chars !== '\r' && ev.chars !== '\n' && ev.chars !== '\t') {
        setInputValue(prev => prev + ev.chars);
      }
    });

    // Check auto-engage availability
    api.stealthTapShouldAutoEngage?.().then(ok => {
      stealthAutoEngageOkRef.current = !!ok;
    }).catch(() => {});

    // Auto-engage on mousedown inside the input
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target?.closest?.('[data-stealth-engage="true"]')) return;
      if (stealthTapActiveRef.current || !stealthAutoEngageOkRef.current) return;
      api.stealthTapStart?.().catch(err => {
        console.warn('[stealth] tap start IPC failed', err);
      });
    };

    // Refresh IME detection on window focus
    const handleFocus = () => {
      api.stealthTapRefreshIme?.().then(ok => {
        stealthAutoEngageOkRef.current = !!ok;
      }).catch(() => {});
    };

    document.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('focus', handleFocus);

    return () => {
      unsubState();
      unsubKey();
      document.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('focus', handleFocus);
    };
  }, [setInputValue, setIsExpanded]);

  const openAccessibilitySettings = useCallback(() => {
    window.electronAPI?.stealthTapOpenSettings?.();
  }, []);

  const dismissPermissionWarning = useCallback(() => {
    setStealthTapPermissionDenied(false);
  }, []);

  return { stealthTapActive, stealthTapPermissionDenied, openAccessibilitySettings, dismissPermissionWarning };
}
