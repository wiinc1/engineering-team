#!/usr/bin/env bash
set -euo pipefail

npm run design:tokens
npm run design:tokens:check
npm run design:tokens:enforce
npm run design:audit:check
npm run design:change-guard
npm run build:browser
make verify
