#!/usr/bin/env bash
#
# Build TrikHub worker Docker images for local development.
#
# Usage:
#   ./docker/build-images.sh          # Build both images
#   ./docker/build-images.sh node     # Build only Node.js image
#   ./docker/build-images.sh python   # Build only Python image
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Read version from root package.json
VERSION=$(node -p "require('$PROJECT_ROOT/package.json').version")

echo "Building TrikHub worker images (version: $VERSION)"
echo "================================================="

build_node() {
  echo ""
  echo "Building trikhub/worker-node:22..."
  docker build \
    -f "$SCRIPT_DIR/worker-node.Dockerfile" \
    -t "trikhub/worker-node:22" \
    -t "trikhub/worker-node:22-v$VERSION" \
    "$PROJECT_ROOT"
  echo "Done: trikhub/worker-node:22"
}

build_python() {
  echo ""
  echo "Building trikhub/worker-python:3.12..."
  docker build \
    -f "$SCRIPT_DIR/worker-python.Dockerfile" \
    -t "trikhub/worker-python:3.12" \
    -t "trikhub/worker-python:3.12-v$VERSION" \
    "$PROJECT_ROOT"
  echo "Done: trikhub/worker-python:3.12"
}

case "${1:-all}" in
  node)
    build_node
    ;;
  python)
    build_python
    ;;
  all)
    build_node
    build_python
    ;;
  *)
    echo "Usage: $0 [node|python|all]"
    exit 1
    ;;
esac

echo ""
echo "All done! Images built:"
docker images --filter "reference=trikhub/worker-*" --format "  {{.Repository}}:{{.Tag}} ({{.Size}})"
