# Production runtime image for qits ITSELF (the app), the counterpart to docker/workspace/Dockerfile
# (the image every workspace container runs). qits is not a plain web app: at runtime it shells the
# `docker` CLI against the HOST daemon (via a bind-mounted /var/run/docker.sock) to create sibling
# workspace containers, and it must sit on the shared `qits-net` so those containers reach it back by
# DNS name (git clone/push over /git, OTLP over /api/otel, MCP over /mcp). So this image is the
# devcontainer minus the IDE/dev-user bits: the same `qits/workspace` toolchain base (JDK 25 + git +
# python for the speech venv, all the tools qits shells out to) + the docker CLI, running the
# PACKAGED fast-jar instead of `quarkus:dev`.
#
# The app artifact is NOT built here — it is built by Maven on the CI runner (which has the fixture
# submodules and the shared caches) and COPYied in, exactly like the stock src/main/docker/
# Dockerfile.jvm. Build the app first, then this image, with the REPO ROOT as the build context:
#
#     ./mvnw -pl service -am package -DskipTests
#     docker build -t ghcr.io/wohlben/qits -f docker/qits/Dockerfile .
#
# Requires the workspace image to exist as the base (build it first, and the server needs it too so
# workspaces can start): `docker build -t qits/workspace docker/workspace`.
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

# The packaged Quarkus fast-jar, in four layers so an app-only change re-uses the fat library layer.
# Built by Maven beforehand (see header); the Angular UI is already baked into it by Quinoa, so there
# is no separate frontend artifact and no :4200 dev server in prod — Quarkus serves the SPA on :8080.
WORKDIR /deployments
COPY --chown=${USER_UID}:${USER_GID} service/target/quarkus-app/lib/     /deployments/lib/
COPY --chown=${USER_UID}:${USER_GID} service/target/quarkus-app/*.jar    /deployments/
COPY --chown=${USER_UID}:${USER_GID} service/target/quarkus-app/app/     /deployments/app/
COPY --chown=${USER_UID}:${USER_GID} service/target/quarkus-app/quarkus/ /deployments/quarkus/

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
