#!/usr/bin/env bash
# postCreate for the qits devcontainer: build so the `domain` module is resolvable, then seed the
# demo data.
#
# Seeding is pure host-side data setup (workspace containers are provisioned lazily on first use),
# so the seeds run directly — no docker, no running service needed. They write the seeded H2 data +
# cloned repos onto the persistent ~/.qits volume.
#
# Seeding is BEST-EFFORT: a failure warns but never fails container creation (the essential
# postCreate work is the build above).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[postCreate] building (so the domain module is resolvable) ..."
./mvnw -q install -DskipTests -Dqits.dev-guard.skip=true

# Both seeds, best-effort + time-boxed so nothing here can hang or fail container creation.
# `seed` is idempotent (skip-if-exists); `seed-webapp` is idempotent by reset.
echo "[postCreate] seeding: seed ..."
timeout 300 ./mvnw -q -pl cli quarkus:run -Dcli.args=seed \
  || echo "[postCreate] 'seed' failed/timed out — continuing."
echo "[postCreate] seeding: seed-webapp ..."
timeout 900 ./mvnw -q -pl cli quarkus:run -Dcli.args=seed-webapp \
  || echo "[postCreate] 'seed-webapp' failed/timed out — continuing."

echo "[postCreate] done. Start dev with:"
echo "  ./mvnw -pl service -am quarkus:dev -Dquarkus.bootstrap.workspace-discovery=true"
