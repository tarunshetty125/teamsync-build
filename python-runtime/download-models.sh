#!/bin/bash
# ---------------------------------------------------------------------------
# download-models.sh — Pre-download PaddleOCR models for offline bundling
# ---------------------------------------------------------------------------
#
# Run this ONCE locally.  The downloaded models are committed to the repo
# in python-runtime/models/ so that:
#   1. CI builds are fully deterministic (no network downloads)
#   2. Packaged apps work offline from first launch
#
# This script bootstraps its own Python 3.11 environment to avoid
# compatibility issues with system Python (paddlepaddle requires ≤3.12).
#
# Usage:
#   cd python-runtime && bash download-models.sh
#
# Output:  python-runtime/models/  (commit this directory)
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODELS_DIR="$SCRIPT_DIR/models"
PYTHON_VERSION="3.11.9"
PBS_TAG="20240726"

echo "[download-models] Downloading PaddleOCR English models..."
echo "[download-models] Output: ${MODELS_DIR}"
echo ""

# ── Bootstrap a temporary Python 3.11 (paddlepaddle needs ≤3.12) ──────────
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
    TRIPLE="aarch64-apple-darwin"
else
    TRIPLE="x86_64-apple-darwin"
fi

TEMP_PYTHON="/tmp/paddleocr-bootstrap-python"
TARBALL="cpython-${PYTHON_VERSION}+${PBS_TAG}-${TRIPLE}-install_only_stripped.tar.gz"
URL="https://github.com/indygreg/python-build-standalone/releases/download/${PBS_TAG}/${TARBALL}"
CACHE="/tmp/${TARBALL}"

if [ -d "$TEMP_PYTHON" ] && [ -x "$TEMP_PYTHON/bin/python3" ]; then
    echo "[download-models] Using cached bootstrap Python at $TEMP_PYTHON"
else
    rm -rf "$TEMP_PYTHON"
    mkdir -p "$TEMP_PYTHON"

    if [ ! -f "$CACHE" ]; then
        echo "[download-models] Downloading Python ${PYTHON_VERSION} for model download..."
        curl -L --retry 3 --retry-delay 5 -o "$CACHE" "$URL"
    fi

    echo "[download-models] Extracting bootstrap Python..."
    tar xzf "$CACHE" -C "$TEMP_PYTHON" --strip-components=1
fi

PYTHON_BIN="$TEMP_PYTHON/bin/python3"
echo "[download-models] Bootstrap Python: $("$PYTHON_BIN" --version)"

# ── Install paddleocr + paddlepaddle into the bootstrap env ───────────────
echo "[download-models] Installing paddleocr + paddlepaddle..."
"$PYTHON_BIN" -m pip install --no-cache-dir --quiet \
    paddlepaddle paddleocr numpy Pillow 2>&1 | grep -v "already satisfied" || true

# ── Download models ──────────────────────────────────────────────────────
mkdir -p "$MODELS_DIR"

"$PYTHON_BIN" -c "
import os

# New PaddleOCR (v3+) stores models via PaddleX in ~/.paddlex/official_models/
# We also set PADDLEOCR_HOME for older versions.
os.environ['PADDLEOCR_HOME'] = '$MODELS_DIR'

from paddleocr import PaddleOCR

print('[download-models] Initialising PaddleOCR (this downloads models)...')
try:
    ocr = PaddleOCR(use_textline_orientation=True, lang='en')
except (TypeError, ValueError):
    ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False)

# Sanity check — run on a blank image
import numpy as np
blank = np.zeros((100, 300, 3), dtype=np.uint8)
blank[:] = 255  # white

# .ocr() API changed: new versions don't accept cls= kwarg
try:
    result = ocr.ocr(blank)
except Exception:
    try:
        result = ocr.predict(blank)
    except Exception:
        pass

print('[download-models] PaddleOCR initialised and models downloaded.')
"

# ── Copy models from PaddleX cache to our models directory ────────────────
# New PaddleOCR stores models in ~/.paddlex/official_models/ via PaddleX.
# Copy them into our models/ dir for offline bundling.
PADDLEX_CACHE="$HOME/.paddlex/official_models"
if [ -d "$PADDLEX_CACHE" ]; then
    echo "[download-models] Copying PaddleX models from cache..."
    cp -R "$PADDLEX_CACHE"/* "$MODELS_DIR/" 2>/dev/null || true
fi

# Also copy any models stored in the old PADDLEOCR_HOME location
OLD_CACHE="$HOME/.paddleocr"
if [ -d "$OLD_CACHE" ]; then
    echo "[download-models] Copying legacy PaddleOCR models from cache..."
    cp -R "$OLD_CACHE"/* "$MODELS_DIR/" 2>/dev/null || true
fi

echo ""
echo "[download-models] ✅ Done."
echo ""
echo "Contents of ${MODELS_DIR}:"
find "$MODELS_DIR" -type f | head -40
echo ""
SIZE=$(du -sh "$MODELS_DIR" | awk '{print $1}')
echo "Total size: ${SIZE}"
echo ""
echo "NEXT: git add python-runtime/models/ && git commit"
