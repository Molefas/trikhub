#!/usr/bin/env bash
set -euo pipefail

# Install smoke tests — runs clean Docker containers to verify end-user install paths.
# Usage:
#   ./scripts/test-install.sh          # test published packages
#   ./scripts/test-install.sh --local  # test local tarballs (pre-release)

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

LOCAL=false
PASSED=0
FAILED=0
FAILURES=()

for arg in "$@"; do
  case "$arg" in
    --local) LOCAL=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# Check Docker is available
if ! command -v docker &> /dev/null; then
  echo -e "${RED}Error: Docker is not installed or not in PATH${RESET}"
  exit 1
fi

# run_test NAME IMAGE COMMANDS [DOCKER_ARGS...]
run_test() {
  local name="$1"
  local image="$2"
  local commands="$3"
  shift 3

  echo -e "\n${BOLD}━━━ ${name} ━━━${RESET}"
  echo -e "${YELLOW}Image: ${image}${RESET}"

  if docker run --rm "$@" "$image" sh -c "$commands" 2>&1; then
    echo -e "${GREEN}✓ PASS: ${name}${RESET}"
    PASSED=$((PASSED + 1))
  else
    echo -e "${RED}✗ FAIL: ${name}${RESET}"
    FAILED=$((FAILED + 1))
    FAILURES+=("$name")
  fi
}

# Python one-liner to verify the gateway loads installed triks
VERIFY_AGENT='python3 -c "
import asyncio
from trikhub.gateway import TrikGateway

async def check():
    gw = TrikGateway()
    await gw.initialize()
    await gw.load_triks_from_config()
    triks = gw.get_loaded_triks()
    assert len(triks) > 0, \"No triks loaded\"
    print(f\"Gateway loaded {len(triks)} trik(s)\")

asyncio.run(check())
"'

echo -e "${BOLD}TrikHub Install Smoke Tests${RESET}"
echo "Mode: $(if $LOCAL; then echo 'local tarballs'; else echo 'published packages'; fi)"
echo ""

# --- JS tests ---

JS_DOCKER_ARGS=()
if $LOCAL; then
  echo -e "${YELLOW}Packing local JS tarball...${RESET}"
  # Use pnpm pack to resolve workspace:* protocols to real versions
  JS_TARBALL=$(cd packages/js/cli && pnpm pack --pack-destination /tmp 2>/dev/null | tail -1)
  JS_INSTALL="npm install -g /mnt/${JS_TARBALL##*/}"
  JS_DOCKER_ARGS=(-v "/tmp:/mnt:ro")
else
  JS_INSTALL="npm install -g @trikhub/cli"
fi

JS_VERIFY="trik --help"
# trik install needs git for cloning trik repos
JS_SCAFFOLD="apk add --no-cache git >/dev/null 2>&1 && trik create-agent --yes ts && test -f my-agent/package.json && test -f my-agent/src/agent.ts && cd my-agent && trik install @molefas/trik-demo-notes"

# No extra dependencies installed — the gateway uses Node.js built-in node:sqlite,
# so no native compilation or build tools should be needed.

run_test "JS — Node 22 (alpine)" "node:22-alpine" \
  "${JS_INSTALL} && ${JS_VERIFY} && ${JS_SCAFFOLD}" \
  "${JS_DOCKER_ARGS[@]+"${JS_DOCKER_ARGS[@]}"}"

# --- Python tests ---

PY_DOCKER_ARGS=()
if $LOCAL; then
  echo -e "${YELLOW}Building local Python wheel...${RESET}"
  rm -rf /tmp/trikhub-wheels && mkdir -p /tmp/trikhub-wheels
  (cd packages/python && pip wheel . --no-deps -w /tmp/trikhub-wheels 2>/dev/null)
  PY_INSTALL="pip install --break-system-packages /mnt/*.whl"
  PY_DOCKER_ARGS=(-v "/tmp/trikhub-wheels:/mnt:ro")
else
  PY_INSTALL="pip install --break-system-packages trikhub"
fi

PY_VERIFY="trik --help"
# Install git (needed for pip install git+... and trik install)
# Scaffold agent, install a Python trik, then verify the gateway loads it
PY_SCAFFOLD="apt-get update >/dev/null 2>&1 && apt-get install -y --no-install-recommends git >/dev/null 2>&1 && trik create-agent --yes py && test -f my-agent/pyproject.toml && test -f my-agent/agent.py && cd my-agent && trik install @molefas/trik-demo-notes-py && ${VERIFY_AGENT}"

run_test "Python — 3.12 (slim)" "python:3.12-slim" \
  "${PY_INSTALL} && ${PY_VERIFY} && ${PY_SCAFFOLD}" \
  "${PY_DOCKER_ARGS[@]+"${PY_DOCKER_ARGS[@]}"}"

run_test "Python — 3.10 (slim)" "python:3.10-slim" \
  "${PY_INSTALL} && ${PY_VERIFY} && ${PY_SCAFFOLD}" \
  "${PY_DOCKER_ARGS[@]+"${PY_DOCKER_ARGS[@]}"}"

# --- Summary ---

echo ""
echo -e "${BOLD}━━━ Summary ━━━${RESET}"
echo -e "${GREEN}Passed: ${PASSED}${RESET}"
echo -e "${RED}Failed: ${FAILED}${RESET}"

if [ ${FAILED} -gt 0 ]; then
  echo ""
  echo -e "${RED}Failed tests:${RESET}"
  for f in "${FAILURES[@]}"; do
    echo -e "  ${RED}• ${f}${RESET}"
  done
  exit 1
fi

echo -e "\n${GREEN}All install tests passed!${RESET}"
