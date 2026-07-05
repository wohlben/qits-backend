# Healthy Quarkus dev daemon flips to DEGRADED on benign dev-mode output

## Introduction

Secondary finding while diagnosing
[the workspace-image build failure](2026-07-05_workspace-image-cannot-build-fixture.md). Concerns the
[daemons](../features/2026-07-04_daemons.md) LOG_LEVEL observer / `LogLevelClassifier` and the
`seed-webapp` fixture's "Quarkus dev server" daemon config.

## Observed

Once the image was fixed, the `greeting` "Quarkus dev server" daemon started cleanly and reached
`READY` ("Listening on" matched), then within ~5s went `DEGRADED` — while the server stayed alive and
served HTTP 200 through the qits web-view proxy. The event timeline:

```
12:41:07  STATUS_CHANGED   READY      ready (pattern matched)
12:41:12  ERROR_DETECTED   READY      error-log: 2026-07-05 12:41:08,707 … /usr/lib/jvm/temurin-25-jdk-amd64/bin/java …
12:41:12  STATUS_CHANGED   DEGRADED   degraded (errors in output; process still alive)
12:41:13  ERROR_DETECTED   DEGRADED   error-log: Press [e] to edit command line args (currently ''), [r] to resume testing, [o] …
```

Neither flagged batch is an actual error: the first is Quarkus continuous-testing's **forked-JVM
command line** (the `java …` invocation with its classpath), the second is the dev-mode
**continuous-testing banner** ("Press [e] to edit…, [r] to resume testing, [o] Toggle test output").
`DEGRADED` does not auto-recover (by design — reset only by restart/stop), so a perfectly healthy dev
server sits permanently DEGRADED, which reads as "something is wrong" for the flagship demo.

## Suspected cause

`LogLevelClassifier` (`domain.daemon.control`) word-matches its severity vocabulary
(`\w+Exception` / `\w+Error`, level tokens, Python traceback opener) over each debounced batch. Quarkus
continuous-testing output routinely contains error-shaped tokens that aren't failures — a classpath
jar or class name matching `\w+Error`/`\w+Exception`, and the testing banner. Since the excerpt starts
at the classifier's `firstLineOffset`, the flagged line shown is the batch head, not necessarily the
matching token, which makes these findings especially confusing.

## Suggested fix direction

Options, roughly in order of preference:

1. **Config-level (fixture):** the seeded daemon combines a broad LOG_LEVEL observer *and* a targeted
   PATTERN observer (`BUILD FAILURE|Failed to start Quarkus|Live reload failed`). For a Quarkus dev
   server the PATTERN observer already captures the real failures; consider dropping the LOG_LEVEL
   observer from the `seed-webapp` daemon so routine dev/test chatter doesn't trip it.
2. **Classifier-level:** make `\w+Error`/`\w+Exception` matching require an accompanying level token or
   stacktrace shape (so a bare classpath/class name doesn't count), and/or ignore lines that are
   clearly Quarkus dev-console UI (the `Press [e] …` banner, ANSI cursor-movement-only lines).
3. **State-level:** let `DEGRADED` auto-recover after a quiet period (explicitly deferred in the
   daemon feature — "simplest defensible rule; revisit with real usage"; this is the real usage).

## Not a blocker

The dev server is fully functional in DEGRADED — this is a signal-quality bug, not an availability
one. Distinct from the image issue, which was the actual "won't start".
