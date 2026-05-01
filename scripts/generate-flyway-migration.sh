#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Ensure ws package is available
if [ ! -d "scripts/node_modules/ws" ]; then
    echo "Installing ws (Node WebSocket client)..."
    (cd scripts && npm install ws >/dev/null 2>&1)
fi

find_free_port() {
    python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1]); s.close()"
}

PORT=$(find_free_port)
LOGFILE=$(mktemp)

cleanup() {
    local pgid
    pgid=$(ps -o pgid= $$ 2>/dev/null | tr -d ' ' || echo "")
    if [ -n "$pgid" ]; then
        kill -- -"$pgid" 2>/dev/null || true
    fi
    rm -f "$LOGFILE"
}
trap cleanup EXIT

echo "Starting Quarkus dev mode on port $PORT..."
./mvnw -pl service quarkus:dev \
    -Dquarkus.http.port="$PORT" \
    -Dquarkus.http.test-port=0 \
    -Dquarkus.analytics.disabled=true \
    > "$LOGFILE" 2>&1 &

echo "Waiting for Quarkus to start (port $PORT)..."
for i in $(seq 1 180); do
    if curl -sf "http://localhost:$PORT/q/health/ready" >/dev/null 2>&1; then
        break
    fi
    if ! pgrep -f "quarkus:dev.*port=$PORT" >/dev/null 2>&1; then
        echo "ERROR: Dev mode process exited unexpectedly"
        cat "$LOGFILE"
        exit 1
    fi
    sleep 1
done

echo "Dev mode ready. Requesting migration generation..."

RESPONSE=$(node scripts/ws-generate-migration.js "$PORT")

if echo "$RESPONSE" | grep -q '"error"'; then
    echo "ERROR: WebSocket call failed"
    echo "$RESPONSE"
    exit 1
fi

# Extract the inner response object
INNER=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('result',{}).get('object',{})))" 2>/dev/null || echo "{}")

TYPE=$(echo "$INNER" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('type',''))" 2>/dev/null || echo "")

if [ "$TYPE" = "success" ]; then
    echo "✅ Migration generated successfully"

    # Find auto-generated files (pattern: V1.2026.05.01.xxxxxx__service.sql)
    # These have a dot after the major version, unlike hand-written V1__init.sql
    AUTO_FILES=$(find service/src/main/resources/db/migration -name 'V*.*__*.sql' -newer "$LOGFILE" 2>/dev/null || true)

    if [ -n "$AUTO_FILES" ]; then
        LATEST=$(echo "$AUTO_FILES" | sort | tail -n1)

        if [ -s "$LATEST" ]; then
            cp "$LATEST" service/PENDING_MIGRATION.sql
            echo ""
            echo "========================================"
            echo "  🚨 PENDING_MIGRATION.sql CREATED 🚨"
            echo "========================================"
            echo ""
            echo "Review the generated starter at:"
            echo "  service/PENDING_MIGRATION.sql"
            echo ""
            echo "Write a proper migration by hand, then delete PENDING_MIGRATION.sql."
            echo ""
        else
            echo ""
            echo "⚠️  No schema changes detected — generated script is empty."
            echo "   Nothing to review."
        fi

        # Clean up auto-generated junk from db/migration
        for f in $AUTO_FILES; do
            rm -f "$f"
        done
    else
        echo ""
        echo "⚠️  No auto-generated migration file found."
    fi
else
    echo "⚠️  Migration generation did not succeed:"
    echo "$INNER"
    exit 1
fi
