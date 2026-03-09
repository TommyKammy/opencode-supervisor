#!/bin/bash
# Install opencode-supervisor as a user systemd service on Linux

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "Installing opencode-supervisor systemd service..."

# Detect paths
NODE_BIN_DIR="$(dirname "$(which node)")"
USER_BIN_DIR="${HOME}/.local/bin"
mkdir -p "${USER_BIN_DIR}"

# Create service file
SERVICE_FILE="${REPO_ROOT}/systemd/opencode-supervisor.service"
sed \
  -e "s|REPO_ROOT|${REPO_ROOT}|g" \
  -e "s|NODE_BIN_DIR|${NODE_BIN_DIR}|g" \
  -e "s|USER_BIN_DIR|${USER_BIN_DIR}|g" \
  -e "s|USER_HOME|${HOME}|g" \
  -e "s|USER_WORKSPACE_ROOT|${HOME}/opencode-worktrees|g" \
  "${REPO_ROOT}/systemd/opencode-supervisor.service.template" > "${SERVICE_FILE}"

# Install service
mkdir -p "${HOME}/.config/systemd/user"
cp "${SERVICE_FILE}" "${HOME}/.config/systemd/user/opencode-supervisor.service"

# Reload and enable
systemctl --user daemon-reload
systemctl --user enable opencode-supervisor.service

echo "Service installed. Start it with:"
echo "  systemctl --user start opencode-supervisor"
echo ""
echo "Check status:"
echo "  systemctl --user status opencode-supervisor"
echo ""
echo "View logs:"
echo "  journalctl --user -u opencode-supervisor -f"
