# Production runtime image for qits ITSELF (the app), the counterpart to docker/workspace/Dockerfile
# (the image every workspace container runs). qits is not a plain web app: at runtime it shells the
# `docker` CLI against the HOST daemon (via a bind-mounted /var/run/docker.sock) to create sibling
# workspace containers, and it must sit on the shared `qits-net` so those containers reach it back by
# DNS name (git clone/push over /git, OTLP over /api/otel, MCP over /mcp). So this image is the
# devcontainer minus the IDE/dev-user bits: the same `qits/workspace` toolchain base (JDK 25 + git +
# python + node/pnpm, all the tools qits shells out to) + the docker CLI, running the PACKAGED
# fast-jar instead of `quarkus:dev`.
#
# MULTI-STAGE: the fast-jar is built INSIDE this image (stage `build`), not on the host and COPYied
# in. This is what lets the manual installer (install.sh) run entirely inside a throwaway container
# with only the docker socket mounted — the source never has to land on a host path; it reaches the
# host daemon purely as this build's context. Build from the REPO ROOT as context, naming the auth
# build variant (docs/features/2026-07-16_build-variant-auth.md — no default, an image is either
# forward-auth-proxied or OIDC, never toggleable at runtime):
#
#     docker build -t qits/app:latest --build-arg QITS_VARIANT=forwardauth -f docker/qits/Dockerfile .
#     docker build -t qits/app:latest --build-arg QITS_VARIANT=oauth       -f docker/qits/Dockerfile .
#
# Requires the workspace image to exist locally as the base of BOTH stages (build it first — the
# server needs it anyway so workspaces can start): `docker build -t qits/workspace docker/workspace`.

# --- stage 1: build the packaged fast-jar --------------------------------------------------------
# The workspace toolchain image already has everything the reactor build needs (JDK 25, the mvnw
# wrapper's deps resolve over the network, node + pnpm for the Quinoa Angular build), so reuse it as
# the builder rather than pulling a separate maven image.
FROM qits/workspace:latest AS build
USER root
WORKDIR /src

# Copy the whole checkout (the .dockerignore trims .git, target/, node_modules, dist so the context
# stays lean). Then package just the `service` app + its `domain` dep, no tests.
COPY . .

# -DskipTests: prod jar, no test run. -Dqits.dev-guard.skip=true ALSO skips the derive-fixture-bares
#   antrun (it inherits the root pom's plugin-level `skip`), so the build needs NO git submodules —
#   a plain shallow clone is enough. -Dmaven.build.cache.enabled=false: the cache is empty in a fresh
#   container and its restore machinery only adds overhead here. QUARKUS_ANALYTICS_DISABLED keeps the
#   build non-interactive. -Dqits.variant: an empty/missing build arg fails the maven-enforcer check
#   with the message listing the valid variants — there is no default.
ARG QITS_VARIANT
ENV QUARKUS_ANALYTICS_DISABLED=true
RUN ./mvnw -B -ntp -pl service -am package \
      -DskipTests -Dqits.dev-guard.skip=true -Dmaven.build.cache.enabled=false \
      -Dqits.variant=${QITS_VARIANT}

# --- stage 2: the runtime image ------------------------------------------------------------------
FROM qits/workspace:latest
USER root
ENV DEBIAN_FRONTEND=noninteractive

# The docker CLI only (docker-outside-of-docker): qits shells `docker` against the HOST daemon via
# the bind-mounted /var/run/docker.sock to manage sibling workspace containers. No dockerd runs here.
# Same install the devcontainer uses.
RUN install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

# A dedicated non-root `qits` user. Its home holds the app state volume (~/.qits: the H2 DB + cloned
# repositories). Access to the mounted docker socket is granted at RUNTIME via compose `group_add`
# (the host socket's gid varies per machine), not baked in here — see docker-compose.prod.yml.
ARG USERNAME=qits
ARG USER_UID=1000
ARG USER_GID=1000
RUN groupadd --gid "${USER_GID}" "${USERNAME}" \
    && useradd --uid "${USER_UID}" --gid "${USER_GID}" --create-home --shell /bin/bash "${USERNAME}" \
    && mkdir -p "/home/${USERNAME}/.qits" \
    && chown -R "${USER_UID}:${USER_GID}" "/home/${USERNAME}"

# The packaged Quarkus fast-jar, from the build stage, in four layers so an app-only change re-uses
# the fat library layer. The Angular UI is already baked into it by Quinoa, so there is no separate
# frontend artifact and no :4200 dev server in prod — Quarkus serves the SPA on :8080.
WORKDIR /deployments
COPY --from=build --chown=${USER_UID}:${USER_GID} /src/service/target/quarkus-app/lib/     /deployments/lib/
COPY --from=build --chown=${USER_UID}:${USER_GID} /src/service/target/quarkus-app/*.jar    /deployments/
COPY --from=build --chown=${USER_UID}:${USER_GID} /src/service/target/quarkus-app/app/     /deployments/app/
COPY --from=build --chown=${USER_UID}:${USER_GID} /src/service/target/quarkus-app/quarkus/ /deployments/quarkus/

# ~/.qits (H2 + repositories) resolves off HOME. Bind on all interfaces so the forward-auth proxy on
# qits-net (and the sibling workspace containers) can reach the app; the effective git-host and other
# deployment knobs are set as env in docker-compose.prod.yml, not baked here.
ENV HOME=/home/qits
ENV QUARKUS_HTTP_HOST=0.0.0.0
EXPOSE 8080
USER qits

# Plain `java -jar` (the debian/workspace base has no run-java.sh); the logmanager property is
# required for Quarkus' JBoss LogManager to initialise correctly.
ENTRYPOINT ["java", "-Djava.util.logging.manager=org.jboss.logmanager.LogManager", "-jar", "/deployments/quarkus-run.jar"]
