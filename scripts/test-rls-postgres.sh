#!/usr/bin/env bash

# Runs the real-PostgreSQL RLS and identity-resolution integration suites.
# The database stack must already be running (`npm run infra:up`).

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and configure it first." >&2
  exit 1
fi

if ! docker ps --filter name=paypilot-postgres --format '{{.Names}}' | grep -q paypilot-postgres; then
  echo "paypilot-postgres is not running. Start it with: npm run infra:up" >&2
  exit 1
fi

echo "Running real-PostgreSQL RLS and identity integration tests..."
npm run test:integration
