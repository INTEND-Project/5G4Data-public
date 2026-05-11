#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="${SCRIPT_DIR}/OpenClawAgent"

if [[ ! -d "${BASE_DIR}" ]]; then
  echo "OpenClawAgent directory not found: ${BASE_DIR}" >&2
  exit 1
fi

cd "${BASE_DIR}"

echo "Loading 5g4data-intent-generation package ..."
npx tsx src/index.ts package load ../OpenClawPackages/5g4data-intent-generation/
echo "Installing dependencies in OpenClawAgent-5g4data-intent-generation ..."
(cd ../OpenClawAgent-5g4data-intent-generation && npm install)

echo "Loading 5g4data-intent-observations package ..."
npx tsx src/index.ts package load ../OpenClawPackages/5g4data-intent-observations/
echo "Installing dependencies in OpenClawAgent-5g4data-intent-observations ..."
(cd ../OpenClawAgent-5g4data-intent-observations && npm install)

echo "Done."
