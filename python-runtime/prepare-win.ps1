# ---------------------------------------------------------------------------
# prepare-win.ps1 — Build a portable Python runtime for Windows OCR
# ---------------------------------------------------------------------------
#
# Downloads a FULL portable Python (NOT the embedded/minimal distribution)
# and installs PaddleOCR + dependencies into it.
#
# Uses python-build-standalone for a relocatable, self-contained runtime
# that reliably supports native extensions (paddlepaddle, numpy, etc.).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File prepare-win.ps1
#
# Output directory:
#   python-runtime/windows-x64/
#
# IMPORTANT: PaddleOCR models are NOT downloaded here.  They must be
#            pre-committed in python-runtime/models/ for offline-first
#            deterministic builds.  See README.md.
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutDir = Join-Path $ScriptDir "windows-x64"
$PythonVersion = "3.11.9"
$PbsTag = "20240726"

# ── Clean previous build ─────────────────────────────────────────────────
if (Test-Path $OutDir) {
    Write-Host "[prepare-win] Removing previous build..."
    Remove-Item $OutDir -Recurse -Force
}
New-Item -ItemType Directory -Path $OutDir | Out-Null

# ── Download python-build-standalone (full, NOT embedded) ─────────────────
# The official "embedded" Python distribution lacks pip, distutils, and has
# broken DLL resolution for native extensions like paddlepaddle/numpy.
# python-build-standalone provides a relocatable full Python.
$Triple = "x86_64-pc-windows-msvc"
$Tarball = "cpython-${PythonVersion}+${PbsTag}-${Triple}-install_only_stripped.tar.gz"
$Url = "https://github.com/indygreg/python-build-standalone/releases/download/${PbsTag}/${Tarball}"
$CachePath = Join-Path $env:TEMP $Tarball

if (Test-Path $CachePath) {
    Write-Host "[prepare-win] Using cached download: $CachePath"
} else {
    Write-Host "[prepare-win] Downloading Python $PythonVersion (full portable)..."
    Invoke-WebRequest -Uri $Url -OutFile $CachePath -UseBasicParsing
}

Write-Host "[prepare-win] Extracting..."
# tar is available on modern Windows (10+)
tar xzf $CachePath -C $OutDir --strip-components=1

# ── Verify the binary runs ───────────────────────────────────────────────
$PythonExe = Join-Path $OutDir "python.exe"
if (-not (Test-Path $PythonExe)) {
    Write-Error "[prepare-win] ERROR: python.exe not found at $PythonExe"
    exit 1
}
$PyVersion = & $PythonExe --version
Write-Host "[prepare-win] Python version: $PyVersion"

# ── Install PaddleOCR + dependencies ─────────────────────────────────────
Write-Host "[prepare-win] Installing PaddleOCR and dependencies..."
& $PythonExe -m pip install --no-cache-dir --upgrade pip
& $PythonExe -m pip install --no-cache-dir `
    paddlepaddle `
    paddleocr `
    numpy `
    opencv-python-headless `
    Pillow

# ── Verify imports work ──────────────────────────────────────────────────
Write-Host "[prepare-win] Verifying PaddleOCR import..."
& $PythonExe -c "from paddleocr import PaddleOCR; print('PaddleOCR import OK')"

# ── Strip unnecessary files to reduce size ───────────────────────────────
Write-Host "[prepare-win] Stripping unnecessary files..."
$StripDirs = @(
    "Doc", "share\doc", "share\man",
    "Lib\test", "Lib\ensurepip", "Lib\idlelib",
    "Lib\tkinter", "Lib\turtledemo", "Lib\lib2to3"
)
foreach ($dir in $StripDirs) {
    $fullPath = Join-Path $OutDir $dir
    if (Test-Path $fullPath) {
        Remove-Item $fullPath -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Remove __pycache__ directories
Get-ChildItem -Path $OutDir -Directory -Recurse -Filter "__pycache__" -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# ── Report ────────────────────────────────────────────────────────────────
$Size = "{0:N0} MB" -f ((Get-ChildItem $OutDir -Recurse | Measure-Object Length -Sum).Sum / 1MB)
Write-Host ""
Write-Host "[prepare-win] Done."
Write-Host "[prepare-win] Runtime: $OutDir"
Write-Host "[prepare-win] Size: $Size"
Write-Host ""
Write-Host "[prepare-win] NEXT: Ensure python-runtime\models\ contains pre-downloaded"
Write-Host "               PaddleOCR models. See README.md for instructions."
