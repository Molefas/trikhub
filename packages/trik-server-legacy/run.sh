#!/usr/bin/env bashrc
set -e

# Read options from Home Assistant
CONFIG_PATH=/data/options.json

SKILLS_DIR=$(jq -r '.skills_dir' $CONFIG_PATH)
PORT=$(jq -r '.port' $CONFIG_PATH)
LOG_LEVEL=$(jq -r '.log_level' $CONFIG_PATH)
LINT_ON_LOAD=$(jq -r '.lint_on_load' $CONFIG_PATH)
AUTH_TOKEN=$(jq -r '.auth_token // empty' $CONFIG_PATH)

# Export environment variables
export SKILLS_DIR
export PORT
export LOG_LEVEL
export LINT_ON_LOAD
export AUTH_TOKEN

echo "[skill-gateway] Starting with configuration:"
echo "  Skills directory: $SKILLS_DIR"
echo "  Port: $PORT"
echo "  Log level: $LOG_LEVEL"
echo "  Lint on load: $LINT_ON_LOAD"
echo "  Auth: ${AUTH_TOKEN:+enabled}"

# Create skills directory if it doesn't exist
mkdir -p "$SKILLS_DIR"

# Run the server
exec node /app/packages/skill-server/dist/index.js
