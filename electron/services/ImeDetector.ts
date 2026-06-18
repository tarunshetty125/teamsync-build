import { execFileSync } from 'child_process';

/**
 * Probes the OS input sources to detect if an IME-based input method
 * (Japanese, Chinese, Korean, etc.) is currently active.
 *
 * CGEventTap (macOS) / SetWindowsHookEx (Windows) captures keystrokes
 * BEFORE they reach the IME composition engine, so stealth typing
 * produces raw Latin characters instead of composed CJK text. When an
 * IME is detected, auto-engage is disabled and users must explicitly
 * opt-in via the hotkey.
 */

// ── macOS ────────────────────────────────────────────────────────────

function probeMacOS(): boolean {
  try {
    const raw = execFileSync(
      'defaults',
      ['read', 'com.apple.HIToolbox'],
      { encoding: 'utf8', timeout: 1500 },
    );
    // "Keyboard Input Method" indicates an active IME (not just a keyboard layout)
    if (/InputSourceKind\s*=\s*"?Keyboard Input Method"?/i.test(raw)) {
      return true;
    }
    // com.apple.inputmethod.* covers Apple's built-in IMEs
    if (/com\.apple\.inputmethod\./i.test(raw)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Windows ──────────────────────────────────────────────────────────

function probeWindows(): boolean {
  try {
    // Query the default input profile from the registry.
    // IME-based layouts have a TIP CLSID appended (e.g. "0411:00000411{...}")
    // while simple keyboard layouts are just "XXXX:XXXXXXXX".
    const raw = execFileSync(
      'reg',
      ['query', 'HKCU\\Keyboard Layout\\Preload', '/v', '1'],
      { encoding: 'utf8', timeout: 2000 },
    );
    // If we find a CLSID-style value, an IME is likely the default
    if (/\{[0-9a-fA-F-]+\}/.test(raw)) {
      return true;
    }

    // Fallback: check InputMethod registry for active TIP
    try {
      const tipRaw = execFileSync(
        'reg',
        ['query', 'HKCU\\Software\\Microsoft\\CTF\\SortOrder\\AssemblyItem\\0x00000000'],
        { encoding: 'utf8', timeout: 2000 },
      );
      // CJK TIP CLSIDs indicate IME presence
      if (/CLSID/i.test(tipRaw)) {
        return true;
      }
    } catch {
      // Registry key may not exist — not an IME system
    }

    return false;
  } catch {
    return false;
  }
}

// ── Cross-platform API ───────────────────────────────────────────────

function probeOnce(): boolean {
  if (process.platform === 'darwin') return probeMacOS();
  if (process.platform === 'win32') return probeWindows();
  // Linux: no stealth tap support yet — always allow auto-engage
  return false;
}

let cached: boolean | null = null;

/**
 * Returns `true` if stealth tap should auto-engage on mousedown.
 * Returns `false` when an IME is detected (stealth typing would produce garbage).
 *
 * The result is cached until `refreshImeDetection()` is called.
 */
export function shouldAutoEngageStealthTap(): boolean {
  if (cached === null) cached = !probeOnce();
  return cached;
}

/**
 * Clear the cached IME detection result. Call this when the overlay
 * regains focus (user may have switched input sources).
 */
export function refreshImeDetection(): void {
  cached = null;
}
