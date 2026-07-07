#!/usr/bin/env bash
# postCreate for the qits devcontainer: build so the `domain` module is resolvable, then seed the
# demo data.
#
# Why this is more than a one-liner: seeding creates workspace *containers* that CLONE their branch
# from qits' in-process git server — and that server lives in the `service` web app. So the service
# must be RUNNING to seed, but postCreate fires at container-create time when nothing is up. We
# therefore boot the packaged service in the background, wait for readiness, run the seeds, then stop
# it — leaving the seeded H2 data + cloned repos on the persistent ~/.qits volume. Booting the
# packaged jar (not quarkus:dev) gives a single PID to kill, with no forked dev JVM to orphan.
#
# Seeding is BEST-EFFORT: a missing `qits/workspace` image, absent docker, or a slow fixture build
# warns but never fails container creation (the essential postCreate work is the build above).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[postCreate] building (so the domain module is resolvable) ..."
./mvnw -q install -DskipTests -Dqits.dev-guard.skip=true

RUN_JAR=service/target/quarkus-app/quarkus-run.jar
if [ ! -f "$RUN_JAR" ]; then
  echo "[postCreate] $RUN_JAR not found after build — skipping seed."
  exit 0
fi

echo "[postCreate] booting qits in the background to seed ..."
java -jar "$RUN_JAR" > /tmp/qits-seed-boot.log 2>&1 &
SVC_PID=$!
# Stop the temporary service on any exit path (ready, timeout, seed failure).
cleanup() { kill "$SVC_PID" 2>/dev/null || true; wait "$SVC_PID" 2>/dev/null || true; }
trap cleanup EXIT

echo "[postCreate] waiting for readiness on :8080 ..."
ready=
for _ in $(seq 1 90); do
  if curl -fsS http://localhost:8080/q/health/ready >/dev/null 2>&1; then ready=1; break; fi
  if ! kill -0 "$SVC_PID" 2>/dev/null; then
    echo "[postCreate] service exited during startup (see /tmp/qits-seed-boot.log) — skipping seed."
    exit 0
  fi
  sleep 2
done
if [ -z "$ready" ]; then
  echo "[postCreate] service not ready within ~180s — skipping seed (see /tmp/qits-seed-boot.log)."
  exit 0
fi

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
