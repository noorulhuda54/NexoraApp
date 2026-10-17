#!/usr/bin/env bash
# Runs all backend tests with line coverage (Node's built-in test runner; no DB/Redis needed).
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d backend/node_modules ]; then (cd backend && npm ci --no-audit --no-fund); fi
export DAY1_SALT="${DAY1_SALT:-demo-salt}"
node --test --experimental-test-coverage --test-coverage-include='backend/src/**' tests/*.test.js "$@"
