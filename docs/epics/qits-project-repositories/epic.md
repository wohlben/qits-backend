# Epic: qits-project-repositories — repositories under a project

## Introduction

The **Repository domain**: git repositories managed *under* a [Project](../qits-projects/epic.md)
— discovery/import, the git-execution engine that mutates them, and in-repo `.qits-config`.

Second in the aggregate chain — **builds on [qits-projects](../qits-projects/epic.md)**
(repositories are created under a project, `POST /api/projects/{id}/repositories`, and
cascade-delete with it) and is the foundation the workspace epic builds on:
[qits-workspaces](../qits-workspaces/epic.md) (a workspace
is a branch + container over a repository's bare origin).

Retroactive umbrella epic; future repository-level features land here.

**Scope rule** — this epic owns the **Repository entity and its core git mechanics**: import,
the on-disk bare origins, `GitExecutor`, and `.qits-config` reconciliation. Two adjacent
concerns that grew big enough to stand alone have their **own epics**, both closely related to
this one:

- **Submodules** — [qits-project-repository-submodules](../qits-project-repository-submodules/epic.md):
  importing a repo's submodules as sibling repositories under the same project.
- **Pull / sync** — modelled as technical processes and living in
  [qits-technical-processes](../qits-technical-processes/epic.md) (the "train" pull that walks
  the submodule-sibling graph repo by repo). This epic's `GitExecutor` is what those processes
  drive; the process framing and the recursive walk are theirs.

Cross-cutting infrastructure the repository domain merely uses stays outside — the **JGit git
host** and the **fixture** repositories (test infrastructure), and the
[mutiny](../../technical/examples/mutiny-reactive-programming.md) framework reference under
`docs/technical/examples/`.

## Parts (implemented)

- **[repository-discovery](features/2026-05-01_repository-discovery.md)** — import/discover git
  repositories under a project; the Repository BCE package.
- **[streaming-gitexecutor-exec](features/2026-07-19_streaming-gitexecutor-exec.md)** — the git
  execution engine streams live per-line output, with an idle-reaper that can't false-fail (the
  seam the pull/sync technical processes stream through).
- **[qits-config-in-repo-configuration](features/2026-07-18_qits-config-in-repo-configuration.md)**
  — `.qits-config`: repository configuration committed in the repo, reconciled on clone/sync.
- **[git-remote-https-auth](features/2026-07-21_git-remote-https-auth.md)** — authenticate qits
  against upstream HTTPS remotes: a persistent `credential.helper=store` file wired into every
  remote-touching git verb, filled once via an interactive host-side sign-in terminal (the
  Claude-login pattern applied to `git push`); auth-classified failures hint the process dialog
  into offering "Sign in & push". Builds on
  [push-as-technical-process](../qits-technical-processes/features/2026-07-21_push-as-technical-process.md).

## Parts (ideas)

- none currently.

## Done when

Rolling: current when its `feature-ideas/` is empty and every repository-level feature since
this epic's creation has landed here.

## Status

| Part | Status |
|---|---|
| [repository-discovery](features/2026-05-01_repository-discovery.md) | implemented |
| [streaming-gitexecutor-exec](features/2026-07-19_streaming-gitexecutor-exec.md) | implemented |
| [qits-config-in-repo-configuration](features/2026-07-18_qits-config-in-repo-configuration.md) | implemented |
| [git-remote-https-auth](features/2026-07-21_git-remote-https-auth.md) | implemented |
