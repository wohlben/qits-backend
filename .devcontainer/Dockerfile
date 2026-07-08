# qits devcontainer image: the SAME toolchain image every workspace runs (docker/workspace) + the
# docker CLI + a non-root `dev` user. The qits dev environment and the workspace execution
# environment are therefore one image — qits runs here, on the shared qits-net, and reaches workspace
# containers (its siblings on the host daemon, created via the mounted docker socket) by their DNS
# name, with no host-port publishing. Build the base first:
# `docker build -t qits/workspace docker/workspace`.
FROM qits/workspace:latest

USER root
ENV DEBIAN_FRONTEND=noninteractive

# Run as a non-root user whose uid matches the host user (so files written on the bind-mounted source
# and on the shared Claude volume are owned by the same uid the workspace containers run as — NOT
# root). Override the ARGs at build time for a different host uid/gid, or let the devcontainer CLI's
# updateRemoteUserUID remap it. DOCKER_GID must match the host's /var/run/docker.sock group so `dev`
# can drive the mounted docker socket (docker-outside-of-docker); check with
# `stat -c %g /var/run/docker.sock`.
ARG USERNAME=dev
ARG USER_UID=1000
ARG USER_GID=1000
ARG DOCKER_GID=1001

# The docker CLI only (docker-outside-of-docker): qits shells `docker` against the HOST daemon via
# the bind-mounted /var/run/docker.sock to manage sibling workspace containers. No dockerd runs here.
RUN install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli sudo \
    && rm -rf /var/lib/apt/lists/*

# Create the non-root user, give it passwordless sudo, and put it in a `docker` group matched to the
# host socket gid so it can reach the mounted /var/run/docker.sock.
RUN groupadd --gid "${USER_GID}" "${USERNAME}" \
    && useradd --uid "${USER_UID}" --gid "${USER_GID}" --create-home --shell /bin/bash "${USERNAME}" \
    && echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/${USERNAME}" \
    && chmod 0440 "/etc/sudoers.d/${USERNAME}" \
    && (getent group docker || groupadd --gid "${DOCKER_GID}" docker) \
    && usermod -aG docker "${USERNAME}" \
    # Pre-create the mount points the compose file puts named volumes on, so a FRESH volume inherits
    # writable perms (Docker seeds an empty named volume from the image dir). ~/.qits is dev-owned
    # (project-private); the shared build caches are 0777 like the base image's /caches, since they
    # are shared with workspace containers that run as a different (arbitrary host) uid.
    && mkdir -p "/home/${USERNAME}/.qits" "/home/${USERNAME}/.dotfiles" \
    && chown -R "${USER_UID}:${USER_GID}" "/home/${USERNAME}" \
    && mkdir -p /caches/m2 /caches/pnpm/store && chmod -R 0777 /caches

# qits' shared H2 datastore + cloned repositories live under $HOME/.qits; $HOME is now the dev user's
# home (a real passwd entry, so Java's user.home resolves here too — no -Duser.home needed).
ENV HOME=/home/dev
USER dev
