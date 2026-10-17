#!/usr/bin/env bash
# Runs all backend unit/API tests (Node's built-in runner; no DB/Redis needed) with line coverage.
# Writes coverage/lcov.info and regenerates COVERAGE.json from the measured numbers.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d backend/node_modules ]; then (cd backend && npm ci --no-audit --no-fund); fi
export DAY1_SALT="${DAY1_SALT:-demo-salt}"
mkdir -p coverage
node --test --experimental-test-coverage --test-coverage-include='backend/src/**' \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=lcov --test-reporter-destination=coverage/lcov.info \
  tests/*.test.js "$@"
node scripts/coverage.js coverage/lcov.info
