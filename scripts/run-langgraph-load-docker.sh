#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-55433}"
DATABASE_URL="${DATABASE_URL:-postgres://audit:audit@127.0.0.1:${POSTGRES_HOST_PORT}/engineering_team}"

cleanup() {
  POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" docker compose -f "$ROOT_DIR/docker-compose.yml" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT
cd "$ROOT_DIR"

POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" docker compose up -d postgres
POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" docker compose exec -T postgres sh -lc 'until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do sleep 1; done'
PGSSLMODE=disable DATABASE_URL="$DATABASE_URL" npm run audit:migrate
PGSSLMODE=disable DATABASE_URL="$DATABASE_URL" npm run langgraph:setup
PGSSLMODE=disable DATABASE_URL="$DATABASE_URL" node scripts/run-langgraph-load.js
