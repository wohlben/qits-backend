# The fat default workspace image every qits workspace container runs. It carries the common
# toolchain a repository's actions/dev servers/agent need — nothing repo-specific (per-repo images
# and devcontainer.json support are deferred). Build it locally and tag it as the name the
# `qits.workspace.image` config points at:
#
#     docker build -t qits/workspace docker/workspace
#
# The container itself is created by DockerExecutor as `… <image> sleep infinity`; commands run via
# `docker exec`, so this image only needs the tools on PATH, not an entrypoint.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# git + a shell toolchain (setsid/kill come from util-linux/procps, needed for the registry's
# process-group termination), python, jq (JSON wrangling in scripts — e.g. the Claude Code
# statusline script on the shared /claude-home volume), and unzip. `inotify-tools` provides
# `inotifywait`, spawned per workspace by WorkspaceWatchService to push live working-tree changes
# (agent scaffolds a module/pom/test without a commit) out over the /events SSE channel so the file
# browser and detection refresh without a reload. `openssh-client` gives git an
# ssh transport for pushing/fetching ssh remotes — qits' own git verbs speak smart-HTTP to the
# in-process git server, but the devcontainer (which extends this image) pushes qits itself to an
# ssh origin, and VS Code only forwards the host ssh-agent into a container that has the client
# installed. `unzip` is required by the Maven wrapper: with
# `distributionType=only-script` the mvnw script silently falls back from the `.zip` distribution to
# `.tar.gz` when unzip is absent, which then fails `distributionSha256Sum` validation (the pinned sum
# is the zip's) — see docs/issues/2026-07-05_workspace-image-cannot-build-fixture.md.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
        curl \
        bash \
        gpg \
        jq \
        inotify-tools \
        openssh-client \
        unzip \
        util-linux \
        procps \
        python3 \
        python3-venv \
        tmux \
    && rm -rf /var/lib/apt/lists/*

# JDK 25 (Temurin, via the Adoptium apt repo). The projects this image builds — the Quarkus+Angular
# fixture and qits itself — target `maven.compiler.release=25`, so JDK 17 (bookworm's default openjdk)
# cannot compile them.
RUN install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://packages.adoptium.net/artifactory/api/gpg/key/public \
        | gpg --dearmor -o /etc/apt/keyrings/adoptium.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb bookworm main" \
        > /etc/apt/sources.list.d/adoptium.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends temurin-25-jdk \
    && rm -rf /var/lib/apt/lists/* \
    # The Temurin deb installs to an arch-suffixed path (temurin-25-jdk-amd64 / -arm64) and puts
    # java/javac on PATH via alternatives, but sets no JAVA_HOME. Tools that discover the JDK by
    # JAVA_HOME rather than PATH — the VS Code Java extension / jdtls, and the jdtls-lsp Claude
    # plugin — then report "no Java runtime" despite java being installed. Pin a stable, arch-agnostic
    # symlink and export JAVA_HOME so every consumer (workspace containers + the devcontainer that
    # extends this image) finds it.
    && ln -s /usr/lib/jvm/temurin-25-jdk-* /usr/lib/jvm/temurin-25
ENV JAVA_HOME=/usr/lib/jvm/temurin-25

# Opt out of Quarkus build-time analytics non-interactively. Without a stored consent decision the
# Quarkus Maven plugin prompts "Do you agree to contribute anonymous build time data…" on every
# build — a blocker on a fresh, ephemeral container that has no ~/.redhat consent file yet. This env
# var (the config form of quarkus.analytics.disabled) disables it for every Quarkus build in the
# image: the devcontainer's reactor builds and each workspace container's fixture/agent builds.
ENV QUARKUS_ANALYTICS_DISABLED=true

# Same treatment for the Angular CLI: without a stored decision (~/.angular-config.json) it prompts
# "Would you like to share pseudonymous usage data…" on the first ng invocation. NG_CLI_ANALYTICS=false
# disables it non-interactively for every Angular build (Quinoa's frontend build + fixture builds).
ENV NG_CLI_ANALYTICS=false

# Node.js (via NodeSource) + pnpm through corepack.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && corepack enable \
    && corepack prepare pnpm@latest --activate \
    && rm -rf /var/lib/apt/lists/*

# The coding agent (Claude Code) runs inside this container — the single biggest executor of
# arbitrary commands in the sandbox. Bake the CLI in at a pinned version (bump CLAUDE_CODE_VERSION
# to any published release; the build fails loudly if it doesn't exist). The native installer
# (claude.ai/install.sh) downloads the standalone binary into ~/.local/bin; we relocate it to
# /usr/local/bin so it's on PATH for the arbitrary runtime uid the container runs as. Auto-updates
# are disabled (immutable image — bump the ARG to upgrade).
ARG CLAUDE_CODE_VERSION=2.1.204
RUN curl -fsSL https://claude.ai/install.sh | bash -s ${CLAUDE_CODE_VERSION} \
    && cp -L /root/.local/bin/claude /usr/local/bin/claude \
    && rm -rf /root/.local/bin/claude /root/.local/share/claude /root/.claude
ENV DISABLE_AUTOUPDATER=1

# Language servers for the coding agent's LSP plugins (jdtls-lsp / typescript-lsp from the
# claude-plugins-official marketplace — see docs/features/2026-07-07_agent-lsp-plugins.md). The
# plugins only *wire up* a language server that must already be on PATH; they do not bundle one. The
# binaries are HOME-independent common toolchain (unlike the plugins themselves, which live on the
# shared /claude-home volume and are installed at runtime), so they belong in the image next to the
# JDK/Node they build on.
#
# typescript-lsp -> `typescript-language-server` (+ `typescript`) on PATH, installed npm-global so
# it lands in /usr/bin for the arbitrary runtime uid.
RUN npm install -g typescript-language-server typescript

# jdtls-lsp -> `jdtls` on PATH (Eclipse JDT language server; needs a JDK — temurin-25 above). The
# distribution ships a `bin/jdtls` python launcher; unpack it under /opt and symlink the launcher
# onto PATH. Pinned to a snapshot tarball via ARG so a build can bump/repin without editing the
# recipe; `bin/jdtls` presence is asserted so a structure change fails the build loudly rather than
# at agent runtime.
ARG JDTLS_URL=https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz
RUN mkdir -p /opt/jdtls \
    && curl -fsSL "${JDTLS_URL}" -o /tmp/jdtls.tar.gz \
    && tar -xz -C /opt/jdtls -f /tmp/jdtls.tar.gz \
    && rm -f /tmp/jdtls.tar.gz \
    && test -f /opt/jdtls/bin/jdtls \
    && ln -s /opt/jdtls/bin/jdtls /usr/local/bin/jdtls

# Mount point for the shared credential volume (qits.workspace.claude-volume, default
# qits_shared_dot_claude). Agent launches set HOME here so `claude` reads the operator's one-time
# OAuth login (~/.claude) off the volume — see docker/workspace/agent-login.sh. World-writable so
# the empty named volume initializes writable and the arbitrary-uid container can write to it.
RUN mkdir -p /claude-home && chmod 0777 /claude-home

# Mount points for the shared build caches (qits.workspace.maven-volume / pnpm-volume, default
# qits_shared_m2 / qits_shared_pnpm). qits mounts these into every workspace container AND its own
# devcontainer, and points Maven (-Dmaven.repo.local=/caches/m2 via MAVEN_OPTS) and pnpm
# (npm_config_store_dir=/caches/pnpm/store) at them — so a dependency downloaded by one build is
# reused by every other. World-writable for the same reason as /claude-home (empty named volume,
# arbitrary-uid container).
RUN mkdir -p /caches/m2 /caches/pnpm/store && chmod -R 0777 /caches

# Cloned repositories live here; DockerExecutor execs commands with -w /workspace. The container
# runs as an arbitrary host uid (--user $(id -u)) with no matching passwd entry, so make /workspace
# world-writable (the clone happens as that uid) and point HOME at it so git/tools have somewhere to
# write. Git only ever uses the repo-local config qits sets after cloning.
RUN mkdir -p /workspace && chmod 0777 /workspace
ENV HOME=/workspace
WORKDIR /workspace

# The container runs as an arbitrary uid that owns neither /workspace (created here as root) nor
# necessarily every cloned file, which trips git's "detected dubious ownership" guard and would fail
# every container-side git verb. The whole container is a single-tenant sandbox, so mark all
# directories safe (system-wide, at build time as root).
RUN git config --system --add safe.directory '*'
