# The wrapper as the project's repository registry

## Introduction

**Step 2 of the wrapper feature.** Once every project owns a
[wrapper repository](project-wrapper-repository.md) with an archetype-shaped skeleton, the wrapper
becomes the **declarative registry of the project's repositories**: creating a repository under a
project also registers it in the wrapper as a submodule at `<archetype-dir>/<name>`, so the wrapper's
committed `.gitmodules` and the project's `Repository` rows are kept in sync in both directions. This
step also authors the `AGENTS.md` contract that step 1 leaves as an empty placeholder, because the
convention only exists once there are submodules to have a convention about.

Related / dependent plans:

- **[project-wrapper-repository](project-wrapper-repository.md)** — step 1: the wrapper, the
  `<project>-<project>` name rule, the archetype↔directory taxonomy (`services/` `libs/`
  `integrations/` `apps/`), the skeleton, and the `qits` retro-fit. This step depends on all of it.
- **[qits-project-repository-submodules](../../qits-project-repository-submodules/epic.md)** — the
  existing *read* direction: `importDirectSubmodules` walks a repo's `.gitmodules` and creates sibling
  `Repository` rows + `RepositorySubmodule` edges. This step adds the *write* direction, and the two
  must converge rather than fight.
  [submodule-backend-onboarding](../../qits-project-repository-submodules/features/2026-07-25_submodule-backend-onboarding.md)
  is the manual version of what this automates.
- **[qits-workspace-daemon](../../qits-workspace-daemon/epic.md)** — `Provisioner.materializeSubmodules`
  is what has to cope with the registered submodules in a container; see *Does this restore
  provisioning compatibility?*.
- **[qits-technical-processes](../../qits-technical-processes/epic.md)** — the recursive pull "train"
  whose invariant (never advance a superproject gitlink past what the child's origin has) constrains
  which commit may be pinned.

## What it does

`RepositoryService.cloneRepository` (and the extraction step) gains a registration tail: after the
sibling exists, write it into the wrapper's `main` branch. The effect to reproduce is exactly:

```
git submodule add <url> <path>
git config -f .gitmodules submodule.<name>.ignore all
git config -f .gitmodules submodule.<name>.update merge
git submodule set-branch --branch main <path>
git add .gitmodules <path> && git commit
```

with `<path>` = `<archetype.directory()>/<name>` — `libs/qits-angular-integration`,
`services/qits-backend`, and so on. Non-placeable archetypes (`SERVICE_TEMPLATE`, `FORK`, and the
wrapper's own `PROJECT`) are **not** registered; they have no directory by design.

### Reproduce it with plumbing, not `git submodule add`

`git submodule add` needs a worktree, a fetchable url, and a checked-out submodule — none of which the
host-side creation path has (repository creation is a transaction against bare origins; workspace
containers are provisioned lazily). Do it the same way step 1 writes the skeleton: build the tree in a
temp index and commit directly into the wrapper's bare origin.

- `.gitmodules` is read from the current `main` tree, the new stanza appended, re-`hash-object`'d.
- The gitlink is one index entry: `update-index --add --cacheinfo 160000,<childTipSha>,<path>`.
- `write-tree` + `commit-tree` + `update-ref refs/heads/<main>`, fast-forward only.

This sidesteps three real traps at once: no clone or fetch happens, so the
`prepareSubmoduleBackend` chicken-and-egg never arises; the `fatal: you are on a branch yet to be
born` failure (confirmed reproducible when a bare's `HEAD` points at an unborn branch) can't occur;
and no `.git/modules/<name>` residue can be left behind to block a retry.

### The committed url must be relative

Commit `../<name>.git`, never an absolute url. Relative is what folds against the wrapper's real
backend on import (`GitSubmoduleParser.resolveSubmoduleUrl`) *and* resolves natively against the
name-addressed sibling on qits' git host — the invariant the whole
[name-alias model](../../qits-project-repository-submodules/epic.md) exists for, and the reason step
1's `<project>-<component>` naming rule is enforced. A registration that wrote the resolved qits-host
url would trip `isQitsHostUrl` on the next import, which is the guard working as intended.

### Which commit gets pinned

The child's **current main tip at registration time**, and never bumped afterwards. It must be a
commit the child's origin actually has, or a container's `submodule update` fails with "Server does
not allow request for unadvertised object" — the same invariant the recursive pull already protects.
Since the pin is never advanced, it stays deliberately stale: it exists so `submodule update --init`
resolves on a fresh clone, not as a version pin.

### Registration is an async, post-commit event

Registration is **not** part of the creation transaction. A wrapper commit is I/O against a *different*
repository's origin, and making creation atomic across two repositories buys nothing: the row is the
truth, the wrapper is a projection of it. So creation publishes an event and returns; an observer
performs the wrapper write.

**This is an established pattern here, not a new one.** `domain` already fires and observes async CDI
events in five places — `WorkspaceContainerEventPublisher` (`started`/`ready` via `fireAsync`,
`stopping` deliberately synchronous), `WorkspaceChangePublisher`, and the `@ObservesAsync` consumers
`ServiceLifecycleCoupler`, `WorkspaceBootstrapRunner`, `WorkspaceEventBroadcaster` — with two
conventions worth following exactly:

- a thin `@ApplicationScoped *Publisher` bean owns the `@Inject Event<…>` so producers call a
  one-liner (`WorkspaceContainerEventPublisher` is the model, including documenting *why* each edge is
  async or sync);
- delivery is asserted in tests by small `*Recorder` beans in `src/test` with `@ObservesAsync`
  (`WorkspaceContainerStartedRecorder`, `HintCollector`).

What **is** new is the *purpose*: every existing async event is a **notification** (broadcast a hint,
couple a lifecycle, trigger bootstrap), whereas this one performs a **durable mutation of another
repository**. That difference brings four hazards the existing usages don't have:

1. **`fireAsync` is not transaction-aware.** It dispatches immediately, so the observer can start
   before the creating transaction commits and find no row — or read the child's pre-commit state. Fire
   from a **transactional observer** instead: `@Observes(during = TransactionPhase.AFTER_SUCCESS)`
   (supported by ArC with narayana-jta), which runs only after commit, and hand the git work off from
   there — to the async event or straight to an executor, the way `RepositoryService` already dispatches
   its pull walk on `processExecutor`. Never `fireAsync` from inside `@Transactional`.
2. **Fire-and-forget has no durability.** An in-memory event lost to a crash between commit and the
   wrapper write leaves the two out of sync forever, with no queue to replay. The backstop is that
   registration is **idempotent by `(name, path)`** — so a reconcile pass can re-run it for a project
   at any time, and *that* is where correctness lives; the event is only the fast path. This is the same
   division `SelfSeedService` already relies on (additive reconcile on every boot, no "already done"
   flag).
3. **Concurrent registrations race on one ref.** Two repositories created in quick succession produce
   two read-modify-write cycles over the same `.gitmodules` and `refs/heads/main`. Git hands us the
   fix for free: `git update-ref <ref> <new> <oldExpected>` is a compare-and-swap that fails if the ref
   moved, so the writer re-reads and retries — the same optimistic-retry shape
   `RepositoryNameResolver` uses for its alias race. Do not serialize with a lock; CAS-and-retry is
   both simpler and correct across processes.
4. **No ambient request context.** An async observer runs off any request context, so the observer
   needs `@ActivateRequestContext` for its non-transactional reads — the annotation `SelfSeedService`
   already carries for exactly this reason.

### Deletion is the symmetric half

"Forced sync" only holds if `RepositoryService.delete` also **de-registers**: drop the `.gitmodules`
stanza and the gitlink in one commit on the wrapper's `main`. Otherwise a deleted repository leaves a
dangling submodule and every subsequent `submodule update --init` fails on a sibling qits no longer
serves. Same plumbing, one commit — and the same post-commit event shape, with one asymmetry: the row
is already gone by the time the observer runs, so the event payload must **carry the path and name**
rather than a repository id to re-read. (`WorkspaceContainerStopping` is the precedent for the
alternative — fire *synchronously* before the delete so the observer still sees the entity — but here
the wrapper write is slow remote-ish I/O that must not block a delete, so a self-contained payload is
the better trade.)

### Convergence with import (the read direction)

Registration and `importDirectSubmodules` must be idempotent against each other, and they already
almost are: import dedups children by exact resolved url within the project and edges by
`(parent, path)`. So a wrapper whose `.gitmodules` this step wrote re-imports onto the **existing**
rows rather than cloning duplicates. Two cases to make explicit:

- **Registering something already in `.gitmodules`** (e.g. the `qits` retro-fit, where `qits-backend`
  exists as a row and may already be referenced) — a no-op by `(name, path)`, never a second stanza.
- **A `RepositorySubmodule` edge for the wrapper→child link** should be written alongside, so the DB
  edge closure and the committed `.gitmodules` agree without waiting for an import pass.

## Does this restore provisioning compatibility?

**Mostly — one gap remains, and it shrinks to a single command.** Step 1 flagged that the daemon's
`Provisioner.materializeSubmodules` runs `git submodule update --init`, which is the detached,
stale-pin checkout the live-tip model wants corrected. Tested against git 2.39.5 with `ignore = all`,
`update = merge` and `branch = main` committed in `.gitmodules`:

| Behavior | Result |
|---|---|
| Does `submodule init` copy `update = merge` from `.gitmodules` into `.git/config`? | **Yes** |
| Fresh clone, `submodule update --init` — does `update = merge` avoid detaching? | **No** — checks out the pinned commit on a detached HEAD |
| After `switch main`, plain `submodule update` — does it drag the branch back to the pin? | **No** — merges into `main` and stays on the branch |
| Bare `--remote` (no `--merge`) with `update = merge` | **Stays on the branch** — no re-detach |
| Does `ignore = all` stop `git add -A` from staging a moved gitlink? | **No** — it stages, and `git diff --cached` then hides it |
| Does `skip-worktree` stop it? | **Yes** — the pin stays frozen |

So the two config lines buy a lot: **every repeat update is now safe.** A plain `submodule update` no
longer yanks a submodule off `main` back to the stale pin, and even bare `--remote` keeps the branch —
which is what makes automated, repeated provisioning non-destructive, and removes the "avoid
`pull --recurse-submodules` / `submodule.recurse`" hazard class for anything qits itself runs.

What they do **not** fix is the **first** checkout: git forces `checkout` for a just-cloned submodule
(merge-into-nothing is meaningless), and `branch = main` only takes effect for `--remote`. Since a
workspace container is *always* a fresh clone, every wrapper workspace still lands detached at the
stale pin. The residual fix is one post-init pass —
`git submodule foreach -q 'git switch -q main'` — after which `update = merge` keeps it correct
forever. That collapses step 1's four-step fresh-clone ritual to a single command, and it belongs in
`Provisioner.materializeSubmodules` (it is provisioning's job, runs at every depth it already walks,
and needs no per-project config) rather than in each wrapper's bootstrap chain.

`skip-worktree` is the other per-clone item, and the table shows it is genuinely load-bearing:
`ignore = all` hides gitlink drift but does **not** prevent `git add -A` / `commit -a` from staging a
bump — and once staged it is hidden from `git diff --cached` too, so an agent can commit a pointer
bump invisibly. If frozen pins matter, the provisioner applies `--skip-worktree` over the registered
paths in the same pass.

## The `AGENTS.md` this step authors

Step 1 ships an empty `AGENTS.md` (+ `CLAUDE.md` symlink); this step fills it, and the text should be
written **against what qits actually does** rather than as a manual ritual — with the provisioner
handling `switch main` and `skip-worktree`, the human-facing contract is short:

- every submodule tracks the tip of its own `main`; the pins are deliberately stale and are not
  version pins;
- `git submodule update --remote --merge` to move forward; the `update = merge` config makes the plain
  forms safe too;
- do not gitignore or `git rm --cached` a gitlink — that breaks `update --init`;
- do not bump a pin as a side effect; qits writes them, and `skip-worktree` is what keeps an
  `add -A` from staging one.

Keep the file and the registration code in one commit: it is the contract for the mechanism this
feature implements, so they must not drift.

## Touch points

- **domain**: a `WrapperRegistrationPublisher` (+ `RepositoryRegistered` / `RepositoryDeregistered`
  records) modeled on `WorkspaceContainerEventPublisher`; a `WrapperRegistrar` observer
  (`@Observes(during = AFTER_SUCCESS)` → off-thread, `@ActivateRequestContext`) owning
  `registerInWrapper` / `deregisterFromWrapper` — the plumbing writer with CAS-retry on `update-ref`;
  `RepositoryService.cloneOne`/`delete` publish; `RepositoryArchetype.directory()` (from step 1) as the
  path source; a `RepositorySubmodule` edge written alongside; an idempotent
  `reconcileWrapperRegistry(projectId)` as the durability backstop.
- **workspace-daemon**: `Provisioner.materializeSubmodules` — post-init `switch main` per submodule and
  the `--skip-worktree` pass, at every depth it already walks.
- **resources**: the step-1 template's `AGENTS.md` gains its content.
- **service/UI**: nothing structural; the repository list may show a repo's wrapper path
  (`libs/<name>`), which is derivable and needs no new field.
- **seeding**: `SelfSeedService` — after the retro-fit registers `qits-qits` as the wrapper, the
  existing `qits-backend` / `qits-angular-integration` entries should reconcile into it, which is a
  registration pass over already-present rows (idempotent by `(name, path)`).
- **tests**: registration writes a valid `.gitmodules` stanza + `160000` gitlink at the archetype path;
  the url is relative; the pin is the child's origin tip; de-registration on delete; idempotency when
  the stanza exists; **the observer only runs after commit** (a rolled-back creation registers
  nothing); **two concurrent registrations both land** (the CAS-retry guard); a `*Recorder`-style bean
  for async delivery, following `WorkspaceContainerStartedRecorder`; a real-docker IT that a
  provisioned wrapper container ends with each submodule **on `main`** (the regression guard for the
  compatibility gap above); non-placeable archetypes are skipped.

## Decided

- **Registration happens asynchronously, after the creation transaction commits** — a CDI event, the
  pattern `domain` already uses in five places, with a transactional observer so it can't fire
  pre-commit, CAS-retry on `update-ref` for concurrency, and an idempotent reconcile as the durability
  backstop. See *Registration is an async, post-commit event*.

## Open questions

1. **Should the reconcile backstop be exposed as a technical process?** It is user-visible repair work
   over a repo graph, which is exactly what
   [qits-technical-processes](../../qits-technical-processes/epic.md) models (streamed, resumable, with
   a UI) — versus a quiet idempotent pass invoked on project view / next boot. The process framing costs
   more but makes a crashed-between-commit-and-write divergence visible instead of silent.
2. **What if the wrapper's `main` has diverged** (someone edited `.gitmodules` upstream)? Fast-forward
   only, and surface a conflict as a process failure — or merge? Step 1's unrelated-histories hazard
   is the adjacent case.
3. **Should existing projects' repositories be back-registered?** For `qits`, yes (see *seeding*). For
   other pre-existing projects there is no wrapper at all, so the question only arises if step 1's
   "no generic retro-fit" decision is ever revisited.
4. **Is `update = merge` in `.gitmodules` the right home**, given git copies it into `.git/config` at
   `init` and it therefore only applies to clones made after the stanza landed? An existing checkout
   needs a `submodule sync` (or a re-init) to pick it up.
