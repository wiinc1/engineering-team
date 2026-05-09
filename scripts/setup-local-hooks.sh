#!/usr/bin/env bash
set -euo pipefail

git config core.hooksPath scripts/hooks
chmod +x scripts/hooks/pre-commit scripts/hooks/pre-push

echo "Local git hooks installed from scripts/hooks"
