#!/usr/bin/env bash
#
# list-isolated-tests.sh <test-src-dir> <out-dir> <chunk-count>
#
# Quarkus's JUnit facade caches one full application (curated app + augmentation + runtime
# classloader) per distinct @TestProfile / per-class test resource for the WHOLE surefire fork
# lifetime, and JUnit's single discovery pass loads every selected test class up front — so every
# profile-carrying class in one fork adds a permanently-pinned app to metaspace (upstream
# quarkusio/quarkus#38774, fix targeted at Quarkus 4). A fork given the full suite grows to ~4 GiB
# and gets OOM-killed.
#
# This script derives the fork partition that keeps each fork's footprint flat:
#   - isolated-tests-all.txt   every *Test.java carrying @TestProfile or @WithTestResource
#                              (one app per class) — excluded from the default surefire execution,
#                              which then runs the whole remaining suite against a single shared app
#   - isolated-tests-<i>.txt   the isolated classes split into <chunk-count> chunks, one surefire
#                              execution (= one fork) each, so a fork never holds more than
#                              ceil(n/chunks) apps. Classes sharing a profile class sort adjacently
#                              so they can share one app. Empty chunks get a never-matching pattern
#                              (an empty includesFile would fall back to surefire's default includes
#                              and re-run the entire suite).
#   - isolated-tests-none.txt  empty; swapped in as the default execution's excludesFile when
#                              -Dtest=... is given (see the single-test-override profile in the root
#                              pom), so -Dtest keeps today's behaviour.
#
# Consumed by maven-antrun-plugin at process-test-classes in the modules with many profiles
# (domain, service). See docs/issues/resolved/2026-07-25_quarkus-test-metaspace-oom.md.
set -euo pipefail

SRC_DIR=$1
OUT_DIR=$2
CHUNKS=$3

mkdir -p "$OUT_DIR"
: > "$OUT_DIR/isolated-tests-none.txt"

# path -> sort key (profile class argument when present, else the file name). Patterns are the
# FULL path relative to the test-source root — a bare `**/<basename>.java` would match every
# same-named class across packages (e.g. two RepositoryControllerTest), silently inflating a
# chunk's app count.
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
if [ -d "$SRC_DIR" ]; then
  grep -rlE "@TestProfile|@WithTestResource" "$SRC_DIR" --include="*Test.java" 2>/dev/null | while read -r f; do
    rel=${f#"$SRC_DIR"/}
    key=$(grep -oE "@TestProfile\([A-Za-z0-9_.]+" "$f" | head -1 || true)
    echo "${key:-zz-$rel}|$rel"
  done | sort > "$TMP"
fi

: > "$OUT_DIR/isolated-tests-all.txt"
for i in $(seq 1 "$CHUNKS"); do : > "$OUT_DIR/isolated-tests-$i.txt"; done

n=$(wc -l < "$TMP")
i=0
while IFS='|' read -r _ rel; do
  [ -z "$rel" ] && continue
  echo "$rel" >> "$OUT_DIR/isolated-tests-all.txt"
  chunk=$(( (i * CHUNKS / n) + 1 ))
  echo "$rel" >> "$OUT_DIR/isolated-tests-$chunk.txt"
  i=$((i + 1))
done < "$TMP"

# Never-matching placeholder for empty chunks (see header).
for i in $(seq 1 "$CHUNKS"); do
  [ -s "$OUT_DIR/isolated-tests-$i.txt" ] || echo "**/__NoIsolatedTestsInThisChunk__.java" > "$OUT_DIR/isolated-tests-$i.txt"
done

echo "list-isolated-tests: $n isolated test classes across $CHUNKS chunks in $OUT_DIR"
