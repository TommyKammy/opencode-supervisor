#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
UNIT_TEMPLATE="${ROOT}/systemd/opencode-supervisor.service.template"
UNIT_TARGET="${HOME}/.config/systemd/user/opencode-supervisor.service"
LOG_DIR="${ROOT}/.local/logs"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
NPM_BIN="${NPM_BIN:-$(command -v npm || true)}"
PATH_VALUE="${PATH}"

if [[ -z "${NODE_BIN}" || -z "${NPM_BIN}" ]]; then
  echo "node and npm must be available on PATH" >&2
  exit 1
fi

escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'
}

ROOT_ESCAPED="$(escape_sed_replacement "${ROOT}")"
PATH_ESCAPED="$(escape_sed_replacement "${PATH_VALUE}")"
NODE_ESCAPED="$(escape_sed_replacement "${NODE_BIN}")"
NPM_ESCAPED="$(escape_sed_replacement "${NPM_BIN}")"

mkdir -p "${HOME}/.config/systemd/user" "${LOG_DIR}"
sed \
  -e "s|__ROOT__|${ROOT_ESCAPED}|g" \
  -e "s|__PATH__|${PATH_ESCAPED}|g" \
  -e "s|__NODE__|${NODE_ESCAPED}|g" \
  -e "s|__NPM__|${NPM_ESCAPED}|g" \
  "${UNIT_TEMPLATE}" > "${UNIT_TARGET}"

systemctl --user daemon-reload
systemctl --user enable --now opencode-supervisor.service

echo "Installed and started opencode-supervisor.service"
