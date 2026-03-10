#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLIST_TEMPLATE="${ROOT}/launchd/io.opencode.supervisor.plist.template"
PLIST_TARGET="${HOME}/Library/LaunchAgents/io.opencode.supervisor.plist"
LOG_DIR="${ROOT}/.local/logs"
UID_VALUE="$(id -u)"
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

xml_escape() {
  printf '%s' "$1" \
    | sed -e 's/&/\&amp;/g' \
          -e 's/</\&lt;/g' \
          -e 's/>/\&gt;/g' \
          -e "s/'/\&apos;/g" \
          -e 's/"/\&quot;/g'
}

ROOT_ESCAPED="$(escape_sed_replacement "$(xml_escape "${ROOT}")")"
PATH_ESCAPED="$(escape_sed_replacement "$(xml_escape "${PATH_VALUE}")")"
NODE_ESCAPED="$(escape_sed_replacement "$(xml_escape "${NODE_BIN}")")"
NPM_ESCAPED="$(escape_sed_replacement "$(xml_escape "${NPM_BIN}")")"

mkdir -p "${HOME}/Library/LaunchAgents" "${LOG_DIR}"
sed \
  -e "s|__ROOT__|${ROOT_ESCAPED}|g" \
  -e "s|__PATH__|${PATH_ESCAPED}|g" \
  -e "s|__NODE__|${NODE_ESCAPED}|g" \
  -e "s|__NPM__|${NPM_ESCAPED}|g" \
  "${PLIST_TEMPLATE}" > "${PLIST_TARGET}"

if command -v plutil >/dev/null 2>&1; then
  plutil -lint "${PLIST_TARGET}"
fi

launchctl bootout "gui/${UID_VALUE}" "${PLIST_TARGET}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${UID_VALUE}" "${PLIST_TARGET}"
launchctl enable "gui/${UID_VALUE}/io.opencode.supervisor"
launchctl kickstart -k "gui/${UID_VALUE}/io.opencode.supervisor"

echo "Installed and started io.opencode.supervisor"
