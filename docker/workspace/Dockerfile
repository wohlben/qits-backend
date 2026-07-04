# The fat default workspace image every qits worktree container runs. It carries the common
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
# process-group termination), python, and the JDK.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
        curl \
        bash \
        util-linux \
        procps \
        python3 \
        python3-venv \
        openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

# Node.js (via NodeSource) + pnpm through corepack.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && corepack enable \
    && corepack prepare pnpm@latest --activate \
    && rm -rf /var/lib/apt/lists/*

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
