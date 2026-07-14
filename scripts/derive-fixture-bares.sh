#!/usr/bin/env bash
#
# derive-fixture-bares.sh <fixtures-src-dir> <dst-fixtures-dir>
#
# The git test fixtures are now committed as **git submodules** (checked-out working trees),
# not as bare *.git repos on the classpath. Tests and the seeds, however, still resolve each
# fixture as a *bare* repo (`getResource("/fixtures/<name>.git")`, cloned with `git clone`). This
# script bridges the two: for each submodule working tree it derives an offline bare repo carrying
# ALL fixture branches (from the submodule's already-fetched remote-tracking refs — no network) into
# the module's test-output dir.
#
# Bound to `process-test-resources` via maven-antrun-plugin, which the build cache marks `runAlways`,
# so the bares are (re)created on every build, including cache hits (a clean+cache-hit build would
# otherwise leave target/test-classes/fixtures empty and break the seed's disk fallback).
#
# The angular fixture is derived as `qits-fixture-angular.git` (NOT `testing-repo-angular.git`) so the
# quarkus-angular fixture's `.gitmodules` relative url `../qits-fixture-angular.git` resolves against
# the sibling bare on the classpath during qits' recursive submodule import — offline, in tests.
set -euo pipefail

SRC="${1:?usage: derive-fixture-bares.sh <fixtures-src-dir> <dst-fixtures-dir>}"
DST="${2:?usage: derive-fixture-bares.sh <fixtures-src-dir> <dst-fixtures-dir>}"

mkdir -p "$DST"

# worktree-subdir  ->  derived-bare-name  ->  default branch (mirrors the origin repos' HEAD)
derive() {
  local wt="$SRC/$1" bare="$DST/$2" default="$3"

  if [ ! -e "$wt/.git" ]; then
    echo "derive-fixture-bares: submodule '$1' is not checked out at $wt." >&2
    echo "  Run: git submodule update --init --recursive" >&2
    exit 1
  fi

  # Collect the submodule's fetched branches (refs/remotes/origin/*), skipping the origin/HEAD symref,
  # as push refspecs that land them as local heads in the bare.
  local -a refspecs=()
  while IFS= read -r spec; do
    refspecs+=("$spec")
  done < <(git -C "$wt" for-each-ref \
    --format='%(refname):refs/heads/%(refname:lstrip=3)' refs/remotes/origin/ \
    | grep -v ':refs/heads/HEAD$')

  if [ "${#refspecs[@]}" -eq 0 ]; then
    echo "derive-fixture-bares: submodule '$1' has no origin branches (uninitialised?)." >&2
    echo "  Run: git submodule update --init --recursive" >&2
    exit 1
  fi

  rm -rf "$bare"
  git init -q --bare "$bare"
  git -C "$wt" push -q "$bare" "${refspecs[@]}"
  git -C "$bare" symbolic-ref HEAD "refs/heads/$default"
}

derive testing-repo                 testing-repo.git                 master
derive testing-repo-quarkus-angular testing-repo-quarkus-angular.git main
derive testing-repo-angular         qits-fixture-angular.git         main
