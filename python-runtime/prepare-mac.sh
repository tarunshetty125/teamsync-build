#!/bin/bash
# ---------------------------------------------------------------------------
# prepare-mac.sh — Build a portable Python runtime for macOS OCR
# ---------------------------------------------------------------------------
#
# Downloads python-build-standalone (relocatable Python by indygreg/Astral)
# and installs PaddleOCR + dependencies into it.
#
# Usage:
#   ./prepare-mac.sh            # auto-detect current arch
#   ./prepare-mac.sh arm64      # force ARM64
#   ./prepare-mac.sh x64        # force x86_64
#
# Output directory:
#   python-runtime/mac-arm64/   or   python-runtime/mac-x64/
#
# IMPORTANT: PaddleOCR models are NOT downloaded here.  They must be
#            pre-committed in python-runtime/models/ for offline-first
#            deterministic builds.  See README.md.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_VERSION="3.11.9"
PBS_TAG="20240726"

# ── Determine target architecture ──────────────────────────────────────────
REQUESTED_ARCH="${1:-}"
if [ -z "$REQUESTED_ARCH" ]; then
    HW_ARCH="$(uname -m)"
    if [ "$HW_ARCH" = "arm64" ]; then
        REQUESTED_ARCH="arm64"
    else
        REQUESTED_ARCH="x64"
    fi
fi

if [ "$REQUESTED_ARCH" = "arm64" ]; then
    TRIPLE="aarch64-apple-darwin"
    OUT_DIR="$SCRIPT_DIR/mac-arm64"
elif [ "$REQUESTED_ARCH" = "x64" ]; then
    TRIPLE="x86_64-apple-darwin"
    OUT_DIR="$SCRIPT_DIR/mac-x64"
else
    echo "[prepare-mac] ERROR: Unknown architecture '$REQUESTED_ARCH'. Use 'arm64' or 'x64'."
    exit 1
fi

echo "[prepare-mac] Target: macOS ${REQUESTED_ARCH} (${TRIPLE})"
echo "[prepare-mac] Output: ${OUT_DIR}"

# ── Clean previous build ──────────────────────────────────────────────────
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

# ── Download python-build-standalone ──────────────────────────────────────
TARBALL="cpython-${PYTHON_VERSION}+${PBS_TAG}-${TRIPLE}-install_only_stripped.tar.gz"
URL="https://github.com/indygreg/python-build-standalone/releases/download/${PBS_TAG}/${TARBALL}"
CACHE="/tmp/${TARBALL}"

if [ -f "$CACHE" ]; then
    echo "[prepare-mac] Using cached download: ${CACHE}"
else
    echo "[prepare-mac] Downloading Python ${PYTHON_VERSION} for ${REQUESTED_ARCH}..."
    curl -L --retry 3 --retry-delay 5 -o "$CACHE" "$URL"
fi

echo "[prepare-mac] Extracting..."
tar xzf "$CACHE" -C "$OUT_DIR" --strip-components=1

# ── Verify the binary runs ───────────────────────────────────────────────
PYTHON_BIN="$OUT_DIR/bin/python3"
if [ ! -x "$PYTHON_BIN" ]; then
    echo "[prepare-mac] ERROR: Python binary not found or not executable at $PYTHON_BIN"
    exit 1
fi
echo "[prepare-mac] Python version: $("$PYTHON_BIN" --version)"

# ── Install PaddleOCR + dependencies ─────────────────────────────────────
echo "[prepare-mac] Installing PaddleOCR and dependencies..."
"$PYTHON_BIN" -m pip install --no-cache-dir --upgrade pip
"$PYTHON_BIN" -m pip install --no-cache-dir \
    paddlepaddle \
    paddleocr \
    numpy \
    opencv-python-headless \
    Pillow

# ── Verify imports work ──────────────────────────────────────────────────
echo "[prepare-mac] Verifying PaddleOCR import..."
"$PYTHON_BIN" -c "from paddleocr import PaddleOCR; print('PaddleOCR import OK')"

# ── Strip unnecessary files to reduce size ───────────────────────────────
echo "[prepare-mac] Stripping unnecessary files..."
rm -rf \
    "$OUT_DIR/share/doc" \
    "$OUT_DIR/share/man" \
    "$OUT_DIR/lib/python3.11/test" \
    "$OUT_DIR/lib/python3.11/ensurepip" \
    "$OUT_DIR/lib/python3.11/idlelib" \
    "$OUT_DIR/lib/python3.11/tkinter" \
    "$OUT_DIR/lib/python3.11/turtle*" \
    "$OUT_DIR/lib/python3.11/turtledemo" \
    "$OUT_DIR/lib/python3.11/lib2to3"

find "$OUT_DIR" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
find "$OUT_DIR" -name "*.pyc" -delete 2>/dev/null || true
find "$OUT_DIR" -name "*.pyo" -delete 2>/dev/null || true

# ── Report ────────────────────────────────────────────────────────────────
SIZE=$(du -sh "$OUT_DIR" | awk '{print $1}')
echo ""
echo "[prepare-mac] ✅ Done."
echo "[prepare-mac] Runtime: ${OUT_DIR}"
echo "[prepare-mac] Size: ${SIZE}"
echo ""
echo "[prepare-mac] NEXT: Ensure python-runtime/models/ contains pre-downloaded"
echo "               PaddleOCR models. See README.md for instructions."
