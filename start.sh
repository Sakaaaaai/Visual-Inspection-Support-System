#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is not installed."
  echo "Install it first: https://docs.astral.sh/uv/getting-started/installation/"
  exit 1
fi

if [ ! -d ".venv" ]; then
  echo "Setting up the application environment..."
  uv sync
fi

echo "Starting Animal Image Review Assistant..."
echo "Press Ctrl+C to stop the application."
uv run python app.py
