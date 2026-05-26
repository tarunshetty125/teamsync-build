export type OverlaySessionMode =
    | 'coding'
    | 'system_design'
    | 'behavioral'
    | 'follow_up'
    | 'general';

export type ScreenScanMode = 'coding' | 'interview_question' | 'ui_general';

export function getScreenScanModeForSessionMode(mode: OverlaySessionMode): ScreenScanMode {
    if (mode === 'coding') return 'coding';
    if (mode === 'general') return 'ui_general';
    return 'interview_question';
}
