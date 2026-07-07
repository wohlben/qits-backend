# qits devcontainer image: the SAME toolchain image every workspace runs (docker/workspace) + the
# docker CLI. The qits dev environment and the workspace execution environment are therefore one
# image — qits runs here, on the shared qits-net, and reaches workspace containers (its siblings on
# the host daemon, created via the mounted docker socket) by their DNS name, with no host-port
# publishing. Build the base first: `docker build -t qits/workspace docker/workspace`.
FROM qits/workspace:latest

USER root

ENV DEBIAN_FRONTEND=noninteractive

# The docker CLI only (docker-outside-of-docker): qits shells `docker` against the HOST daemon via
# the bind-mounted /var/run/docker.sock to manage sibling workspace containers. No dockerd runs here.
RUN install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

# qits' shared H2 datastore + cloned repositories live under $HOME/.qits; pin HOME to a stable path
# (mounted as a named volume in the compose file) so it stays off the bind-mounted source tree.
ENV HOME=/root
