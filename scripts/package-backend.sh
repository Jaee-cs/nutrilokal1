#!/usr/bin/env bash
# Membuat zip backend siap di-upload ke Hostinger Web App.
# Build command Hostinger adalah "npm run build", jadi script build di
# package.json sudah memuat prisma generate + tsc + prisma migrate deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
OUT="$ROOT/nutrilokal-backend-hostinger-v2.zip"

echo "=== build backend (butuh DATABASE_URL di backend/.env) ==="
cd "$BACKEND"
npm run build

echo "=== kemas source ==="
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R package.json package-lock.json tsconfig.json server.js src prisma "$TMP"/
(cd "$TMP" && zip -rq "$OUT" . -x '*.DS_Store' '*.test.ts' '*__tests__*')

echo "Selesai: $OUT"
