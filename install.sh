#!/bin/sh
set -eu

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'
NC='\033[0m'

echo "${BOLD}OpenCode-32 Installer${RESET}"
echo ""

# Detect Node.js
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node --version 2>&1)
  echo "  Node.js: ${GREEN}${NODE_VER}${NC}"
elif command -v nodejs >/dev/null 2>&1; then
  NODE_VER=$(nodejs --version 2>&1)
  echo "  Node.js (nodejs): ${GREEN}${NODE_VER}${NC}"
  alias node=nodejs
else
  echo "${RED}Node.js >= 18 is required. Install it first:${RESET}"
  echo "  Termux:  pkg install nodejs"
  echo "  macOS:   brew install node"
  echo "  Linux:   apt install nodejs npm"
  exit 1
fi

# Check version
MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
if [ "$MAJOR" -lt 18 ] 2>/dev/null; then
  echo "${RED}Node.js >= 18 required (found ${NODE_VER})${RESET}"
  exit 1
fi

# Detect arch
ARCH=$(uname -m)
echo "  Architecture: ${YELLOW}${ARCH}${RESET}"

# Choose install method
INSTALL_DIR="${HOME}/.local/bin"
NPM_BIN="opencode-32"
CMD="opencode"

echo ""
echo "  Installing via npm..."

# Try npm install
if npm install -g "${NPM_BIN}" 2>/dev/null; then
  echo ""
  echo "${GREEN}OpenCode-32 installed!${RESET}"
  echo ""
  echo "  Run: ${BOLD}${CMD}${RESET} (or: opencode <prompt>)"
  echo ""
  exit 0
fi

# Fallback: direct install from GitHub
echo "  npm registry install failed, trying GitHub..."
TMPDIR=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

if command -v git >/dev/null 2>&1; then
  git clone --depth 1 https://github.com/tundefund0-gif/opencode-32.git "$TMPDIR" 2>/dev/null || true
fi

if [ -f "${TMPDIR}/package.json" ]; then
  cd "$TMPDIR"
  npm install --production 2>/dev/null || true
  mkdir -p "$INSTALL_DIR"
  ln -sf "$TMPDIR/bin/opencode.js" "${INSTALL_DIR}/${CMD}"
  echo ""
  echo "${GREEN}OpenCode-32 installed to ${INSTALL_DIR}/${CMD}${RESET}"
  echo ""
  echo "  Make sure ${INSTALL_DIR} is in your PATH"
  echo "  Run: ${BOLD}${CMD}${RESET}"
  echo ""
else
  echo "${RED}Could not install automatically.${RESET}"
  echo ""
  echo "  Manual install:"
  echo "    npm install -g opencode-32"
  echo "  Or:"
  echo "    git clone https://github.com/tundefund0-gif/opencode-32.git"
  echo "    cd opencode-32 && npm install -g ."
  echo ""
  exit 1
fi
