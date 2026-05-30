#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/runtime/appstate.json"
VOLUME_NAME="bot-mess_bot_runtime"

if [ ! -f "$SRC" ]; then
  echo "❌ Source file not found: $SRC"
  exit 1
fi

echo "⏳ Copying $SRC -> volume $VOLUME_NAME..."
# Use a short-lived container to copy the file into the Docker volume
docker run --rm -v ${VOLUME_NAME}:/data -v "$ROOT/runtime":/src alpine sh -c 'cp /src/appstate.json /data/appstate.json && chmod 644 /data/appstate.json'

echo "✅ Copied to volume: $VOLUME_NAME"
