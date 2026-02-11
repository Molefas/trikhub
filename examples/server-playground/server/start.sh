#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Set environment variables
export SKILLS_DIR="$SCRIPT_DIR/skills"
export PORT="${PORT:-3002}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export LINT_ON_LOAD=false  # Disable linting for pre-compiled skills

echo "Starting trik-server..."
echo "Skills directory: $SKILLS_DIR"
echo "Port: $PORT"

# Change to trik-server directory and start
cd ../../../packages/trik-server && pnpm start
