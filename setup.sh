#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is not installed."
  echo "Install it first: https://docs.astral.sh/uv/getting-started/installation/"
  exit 1
fi

echo "Installing required packages..."
uv sync

echo "Setup complete. Run ./start.sh to launch the application."
