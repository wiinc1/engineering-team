#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="docker compose"
POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-55432}"
DATABASE_URL="${DATABASE_URL:-postgres://audit:audit@127.0.0.1:${POSTGRES_HOST_PORT}/engineering_team}"
PGSSLMODE="${PGSSLMODE:-disable}"

cleanup() {
  POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" ${COMPOSE} -f "$ROOT_DIR/docker-compose.yml" down -v --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT

cd "$ROOT_DIR"

POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" ${COMPOSE} up -d postgres
POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" ${COMPOSE} exec -T postgres sh -lc 'until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do sleep 1; done'
PGSSLMODE="$PGSSLMODE" DATABASE_URL="$DATABASE_URL" npm run audit:migrate
PGSSLMODE="$PGSSLMODE" DATABASE_URL="$DATABASE_URL" npm run test:integration:postgres
