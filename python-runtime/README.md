# Python Runtime for TeamSync OCR

Portable Python runtime bundled inside TeamSync so PaddleOCR works in
packaged `.dmg` and `.exe` builds without requiring users to install Python.

## Architecture

```
Tesseract.js (primary, WASM)   ← always works in packaged builds
         ↓ low-quality text
PaddleOCR (Python fallback)    ← requires this bundled runtime
```

## Directory Layout

```
python-runtime/
├── mac-arm64/           ← macOS Apple Silicon runtime (built by prepare-mac.sh)
├── mac-x64/             ← macOS Intel runtime (built by prepare-mac.sh)
├── windows-x64/         ← Windows x64 runtime (built by prepare-win.ps1)
├── ocr/
│   └── ocr_worker.py    ← copy of project-root ocr_worker.py (bundled into app)
├── models/              ← pre-downloaded PaddleOCR models (committed to repo)
├── prepare-mac.sh       ← builds mac-arm64/ or mac-x64/
├── prepare-win.ps1      ← builds windows-x64/
├── download-models.sh   ← one-time model download (run locally, commit result)
└── README.md
```

## Setup (One-Time)

### 1. Download PaddleOCR Models

Models must be committed to the repo for offline-first deterministic builds.

```bash
# Requires: pip install paddleocr
cd python-runtime
bash download-models.sh
git add models/
git commit -m "chore: pre-bundle PaddleOCR models for offline OCR"
```

### 2. Build Platform Runtimes

#### macOS

```bash
cd python-runtime

# For Apple Silicon (arm64)
bash prepare-mac.sh arm64

# For Intel (x64)
bash prepare-mac.sh x64
```

#### Windows

```powershell
cd python-runtime
powershell -ExecutionPolicy Bypass -File prepare-win.ps1
```

### 3. CI builds these automatically

The GitHub Actions workflows (`build-mac.yml`, `build-windows.yml`) call the
prepare scripts before `electron-builder` runs.

## How It Works

1. **electron-builder** copies the correct platform runtime into `extraResources`
   at build time using platform-specific config in `package.json`.

2. **`electron/utils/pythonRuntime.ts`** resolves paths at runtime:
   - `getPythonPath()` → bundled Python binary or system `python3` (dev)
   - `getOCRScriptPath()` → bundled `ocr_worker.py` or project-root copy (dev)
   - `getPythonEnv()` → env vars pointing at bundled site-packages and models

3. **`LLMHelper.ts`** and **`VisionPipeline.ts`** use the resolver when spawning
   the OCR worker subprocess.

## Dev Mode

Dev mode is **unchanged**. The resolver falls through to system `python3` and the
project-root `ocr_worker.py`. No bundled runtime is needed for development.

## Size Impact

| Component            | Approx. Size |
|----------------------|-------------|
| Python runtime       | ~40 MB      |
| PaddleOCR + paddle   | ~100 MB     |
| numpy + opencv + PIL | ~30 MB      |
| PaddleOCR models     | ~60 MB      |
| **Total per platform** | **~230 MB** |
