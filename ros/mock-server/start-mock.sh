#!/bin/bash
# Run the mock Foxglove WebSocket server for local testing
# Publishes nvblox, image, path, scan, pointcloud, marker, and TF topics
#
# Usage: ./start-mock.sh
# Then connect Lichtblick to ws://localhost:8765

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${REPO_DIR}"
exec npx ts-node "${SCRIPT_DIR}/mock-topics.ts"
