#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-55432}"
DATABASE_URL="${DATABASE_URL:-postgres://audit:audit@127.0.0.1:${POSTGRES_HOST_PORT}/engineering_team}"
LOAD_DURATION_MS="${JOB_RUNTIME_LOAD_DURATION_MS:-600000}"
LOAD_QPS="${JOB_RUNTIME_LOAD_QPS:-50}"

cleanup() {
  POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" docker compose -f "$ROOT_DIR/docker-compose.yml" down -v --remove-orphans >/dev/null 2>&1 || true
}

trap cleanup EXIT
cd "$ROOT_DIR"

POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" docker compose up -d postgres
POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" docker compose exec -T postgres sh -lc 'until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do sleep 1; done'
POSTGRES_HOST_PORT="$POSTGRES_HOST_PORT" docker compose exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U audit -d engineering_team < "$ROOT_DIR/db/roles/job_runtime_roles.sql"
PGSSLMODE=disable DATABASE_URL="$DATABASE_URL" npm run audit:migrate
PGSSLMODE=disable DATABASE_URL="$DATABASE_URL" npm run job-runtime:setup
PGSSLMODE=disable DATABASE_URL="$DATABASE_URL" JOB_RUNTIME_LOAD_DURATION_MS="$LOAD_DURATION_MS" \
  JOB_RUNTIME_LOAD_QPS="$LOAD_QPS" node scripts/run-job-runtime-load-test.js
