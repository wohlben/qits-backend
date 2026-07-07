# Workspace image: `JAVA_HOME` unset → VS Code Java extension / jdtls report "no Java runtime"

## Introduction

The `docker/workspace` image (and the `.devcontainer/` that extends it) installs a full JDK 25 that
works for the Maven builds, but leaves `JAVA_HOME` unset. Tooling that discovers the JDK via
`JAVA_HOME` rather than `PATH` — the VS Code Java extension (RedHat `jdtls`) and the `jdtls-lsp` Claude
plugin from [agent-lsp-plugins](../../feature-ideas/agent-lsp-plugins.md) — then reports no Java
runtime despite Java being installed. Found while scoping the agent-LSP-plugins idea (jdtls needs
`JAVA_HOME`), so this is a prerequisite for that feature.

## Observed

Inside `qits/workspace:latest`:

```
which java  → /usr/bin/java   → /usr/lib/jvm/temurin-25-jdk-amd64/bin/java
which javac → /usr/bin/javac
java -version → OpenJDK Temurin 25.0.3
JAVA_HOME    → <unset>
```

Java is on `PATH` (so `./mvnw` builds fine), but `JAVA_HOME` is empty. The VS Code Java extension in
the devcontainer reports "Java runtime could not be located." The devcontainer Dockerfile only adds
`ENV HOME=/home/dev`; it never sets `JAVA_HOME`, so the gap is inherited from the base image.

## Cause

The Adoptium `temurin-25-jdk` deb registers `java`/`javac` on `PATH` via `update-alternatives` but does
not export `JAVA_HOME`, and the base Dockerfile never set it. Nothing in the qits build needs it
(Maven finds `java` on `PATH`), so it went unnoticed until IDE/LSP tooling — which keys off
`JAVA_HOME` — was involved.

## Fix

`docker/workspace/Dockerfile`: after the Temurin install, create an arch-agnostic symlink
`/usr/lib/jvm/temurin-25 → temurin-25-jdk-<arch>` and `ENV JAVA_HOME=/usr/lib/jvm/temurin-25`. Both the
workspace containers and the devcontainer inherit it. Verified against the built image: the symlink
resolves to `temurin-25-jdk-amd64` and `$JAVA_HOME/bin/javac` reports 25.0.3.

**Requires an image rebuild to take effect:** `docker build -t qits/workspace docker/workspace`
(and rebuild the devcontainer). No app/code change.
