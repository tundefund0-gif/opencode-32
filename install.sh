#!/bin/sh
set -eu

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; RESET='\033[0m'

echo "${BOLD}OpenCode-32 Installer${RESET}"

if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node --version 2>&1)
  echo "  Node.js: ${GREEN}${NODE_VER}${RESET}"
elif command -v nodejs >/dev/null 2>&1; then
  NODE_VER=$(nodejs --version 2>&1)
  echo "  Node.js (nodejs): ${GREEN}${NODE_VER}${RESET}"
  alias node=nodejs
else
  echo "${RED}Node.js >= 18 required. Install it:${RESET}"
  echo "  Termux:  pkg install nodejs"
  echo "  macOS:   brew install node"
  echo "  Linux:   apt install nodejs npm"
  exit 1
fi

MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
if [ "$MAJOR" -lt 18 ] 2>/dev/null; then
  echo "${RED}Node.js >= 18 required (found ${NODE_VER})${RESET}"
  exit 1
fi

ARCH=$(uname -m)
echo "  Arch: ${YELLOW}${ARCH}${RESET}"

echo ""
echo "  Installing via npm..."

if npm install -g opencode-32 2>/dev/null; then
  echo "${GREEN}OpenCode-32 installed!${RESET}"
  echo "  Run: ${BOLD}opencode${RESET}"
  exit 0
fi

echo "  Trying GitHub..."
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

if command -v git >/dev/null 2>&1; then
  git clone --depth 1 https://github.com/tundefund0-gif/opencode-32.git "$TMPDIR" 2>/dev/null || true
fi

if [ -f "${TMPDIR}/package.json" ]; then
  cd "$TMPDIR"
  mkdir -p "$HOME/.local/bin"
  ln -sf "$TMPDIR/bin/opencode" "$HOME/.local/bin/opencode"
  chmod +x "$TMPDIR/bin/opencode" "$TMPDIR/bin/opencode.js"
  echo "${GREEN}Installed to ~/.local/bin/opencode${RESET}"
  echo "  Add to PATH: export PATH=\$HOME/.local/bin:\$PATH"
  echo "  Run: ${BOLD}opencode${RESET}"
else
  echo "${RED}Installation failed.${RESET}"
  echo "  npm install -g https://github.com/tundefund0-gif/opencode-32.git"
  exit 1
fi
