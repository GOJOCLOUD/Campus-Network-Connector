#!/usr/bin/env bash
# 下载 python-build-standalone（install_only），解压到 repo/python-runtime，并安装 backend 依赖。
# 支持 Apple Silicon (arm64) 与 Intel (x86_64)。产物供 electron-builder extraResources 打进 .app。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="$ROOT/python-runtime"
PY_RELEASE_TAG="20251120"
PY_VERSION="3.12.12"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) PY_ARCH="aarch64-apple-darwin" ;;
  x86_64) PY_ARCH="x86_64-apple-darwin" ;;
  *)
    echo "Unsupported arch: $ARCH (need arm64 or x86_64 macOS)"
    exit 1
    ;;
esac

PY_FILE="cpython-${PY_VERSION}+${PY_RELEASE_TAG}-${PY_ARCH}-install_only.tar.gz"
# URL 中 + 需编码
URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PY_RELEASE_TAG}/${PY_FILE//+/%2B}"

echo "Bundling Python ${PY_VERSION} (${PY_ARCH}) into ${RUNTIME_DIR} ..."
rm -rf "$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR"

TMP_TAR="$(mktemp -t cnc-python-embed)"
trap 'rm -f "$TMP_TAR"' EXIT

curl -fL "$URL" -o "$TMP_TAR"
tar -xzf "$TMP_TAR" -C "$RUNTIME_DIR"

PY="$RUNTIME_DIR/python/bin/python3"
if [[ ! -x "$PY" ]]; then
  echo "Expected executable not found: $PY"
  exit 1
fi

export PYTHONHOME="$RUNTIME_DIR/python"
export PYTHONNOUSERSITE=1
"$PY" -m pip install --no-warn-script-location --upgrade pip
"$PY" -m pip install --no-warn-script-location -r "$ROOT/backend/requirements.txt"

echo "Done. Python: $("$PY" -c 'import sys; print(sys.executable)')"
