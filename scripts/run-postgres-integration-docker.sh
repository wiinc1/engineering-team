#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="docker compose"
DATABASE_URL="${DATABASE_URL:-postgres://audit:audit@127.0.0.1:5432/engineering_team}"

cleanup() {
  ${COMPOSE} -f "$ROOT_DIR/docker-compose.yml" down -v --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT

cd "$ROOT_DIR"

${COMPOSE} up -d postgres
${COMPOSE} exec -T postgres sh -lc 'until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do sleep 1; done'
DATABASE_URL="$DATABASE_URL" npm run audit:migrate
DATABASE_URL="$DATABASE_URL" npm run test:integration:postgres
