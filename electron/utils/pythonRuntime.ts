// electron/utils/pythonRuntime.ts
// ---------------------------------------------------------------------------
// Central resolver for the bundled Python runtime used by PaddleOCR.
//
// In dev mode every function falls through to the existing system-Python
// behaviour so there is zero regression.
//
// In packaged mode the runtime lives at:
//   process.resourcesPath/python/
//
// The correct platform+arch runtime is selected at *build* time by
// electron-builder's extraResources (see package.json).  This module only
// needs to know the canonical layout inside `python/`.
// ---------------------------------------------------------------------------

import { app } from 'electron';
import path from 'path';

// ---------------------------------------------------------------------------
// Python binary
// ---------------------------------------------------------------------------

/**
 * Resolve the Python binary path.
 *
 * Packaged (macOS):  process.resourcesPath/python/bin/python3
 * Packaged (Windows): process.resourcesPath/python/python.exe
 * Dev (macOS/Linux):  'python3'  (system)
 * Dev (Windows):      'python'   (system)
 */
export function getPythonPath(): string {
  if (app.isPackaged) {
    const base = path.join(process.resourcesPath, 'python');
    return process.platform === 'win32'
      ? path.join(base, 'python.exe')
      : path.join(base, 'bin', 'python3');
  }
  // Dev mode — use system Python (existing behaviour, zero regression)
  return process.platform === 'win32' ? 'python' : 'python3';
}

// ---------------------------------------------------------------------------
// OCR worker script
// ---------------------------------------------------------------------------

/**
 * Resolve the OCR worker script path.
 *
 * Packaged: process.resourcesPath/python/ocr/ocr_worker.py
 * Dev:      <project_root>/ocr_worker.py
 *
 * In dev the esbuild output lands at dist-electron/electron/<file>.js so
 * __dirname is <project>/dist-electron/electron/ (or a subdirectory).
 * Walking up two levels reaches the project root where ocr_worker.py lives.
 */
export function getOCRScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'python', 'ocr', 'ocr_worker.py');
  }
  // Dev mode — ocr_worker.py sits at the project root.
  // __dirname = <project>/dist-electron/electron/  (LLMHelper)
  //           = <project>/dist-electron/electron/llm/ (VisionPipeline)
  // We find the project root by looking for ocr_worker.py walking upward.
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'ocr_worker.py');
    try {
      require('fs').accessSync(candidate);
      return candidate;
    } catch { /* keep walking */ }
    dir = path.dirname(dir);
  }
  // Final fallback — legacy path (works for the current build layout)
  return path.join(__dirname, '..', '..', 'ocr_worker.py');
}

// ---------------------------------------------------------------------------
// Environment variables for Python subprocess
// ---------------------------------------------------------------------------

/**
 * Build an env block for the Python subprocess.
 *
 * In packaged mode we set PYTHONHOME, PYTHONPATH, and PADDLEOCR_HOME so the
 * bundled runtime is fully self-contained and PaddleOCR uses pre-bundled
 * models instead of attempting a network download.
 *
 * In dev mode we return the current process.env unchanged.
 */
export function getPythonEnv(): NodeJS.ProcessEnv {
  if (!app.isPackaged) {
    return { ...process.env };
  }

  const pythonBase = path.join(process.resourcesPath, 'python');

  // Site-packages layout differs between macOS and Windows.
  const sitePackages = process.platform === 'win32'
    ? path.join(pythonBase, 'Lib', 'site-packages')
    : path.join(pythonBase, 'lib', 'python3.11', 'site-packages');

  return {
    ...process.env,
    PYTHONHOME: pythonBase,
    PYTHONPATH: sitePackages,
    // Point PaddleOCR at pre-bundled models — prevents any network download.
    PADDLEOCR_HOME: path.join(pythonBase, 'ocr', 'models'),
  };
}
