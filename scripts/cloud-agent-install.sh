#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

npm ci
npx next typegen
