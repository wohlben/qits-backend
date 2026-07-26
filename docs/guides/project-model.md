# The project model: an application that grows into a polyrepository

This guide explains **what a qits `Project` actually is**, and why repositories, remotes, and
submodule import exist the way they do. It is the conceptual frame the feature docs assume but don't
restate — read it before reasoning about "what could go wrong" in the repository/submodule/workspace
code, because a lot of the apparent blast radius collapses once the intended model is clear.

This is a *current-state contract* document (like the other `docs/guides/*`): update it in place when
a feature changes the model.

## Introduction / related

- **[qits-projects](../epics/qits-projects/epic.md)** — the `Project` aggregate root itself, and
  the [wrapper repository](../epics/qits-projects/features/2026-07-26_project-wrapper-repository.md)
  every project now starts with.
- **[qits-project-repositories](../epics/qits-project-repositories/epic.md)** — the `Project` →
  `Repository` aggregate this guide describes.
- **[qits-project-repository-submodules](../epics/qits-project-repository-submodules/epic.md)** —
  submodule import as sibling repositories + name-addressed serving; the "technical necessity" half
  of this guide.
- **[qits-workspaces](../epics/qits-workspaces/epic.md)** — the local workspace containers this whole
  model exists to enable.
- **[qits-workspace-daemon](../epics/qits-workspace-daemon/epic.md)** — the in-container control
  plane; its [autonomous self-clone](../epics/qits-workspace-daemon/features/2026-07-23_autonomous-self-clone-on-boot.md)
  materializes the project's repos inside a workspace.

## What a project is

A **`Project` is one application**, which **starts as a single repository and grows into a
polyrepository**. Creation always ends with exactly one repository — the project's **wrapper** — and
every further `Repository` row is a part of that same application:

- **microservices** — the deployable components, each its own repo;
- **shared technical components** — libraries and code shared across those services (e.g. a common
  client, a schema module);
- **extracted fixtures / support repos** — pieces pulled out of the main app for easier handling on
  their own (qits' own test fixtures are the reference example — see
  [qits-testing-fixtures](../epics/qits-testing-fixtures/epic.md)).

The polyrepo is the **end state, not the starting shape**. On day one nobody knows the component
split, and forcing it up front is exactly the decision that should be deferred — so a project begins
as a monorepo that sheds components one directory at a time. The split, whenever it happens, is a
**structuring choice by a single maintainer of a single application**, not an aggregation of
unrelated third-party code. Everything under a project is code that team curates together. This is
the load-bearing fact for the trust model below.

## The wrapper repository

Every project owns exactly one **wrapper repository**: archetype `PROJECT`, named `<slug>-<slug>`,
created as the last step of project creation. It is the root superproject the rest of the project
hangs off, and it exists so creation always produces something workable — you can start a new
application in qits, not only adopt one that already lives in a git repo somewhere.

**Why `<slug>-<slug>`.** A repository's name is a project-scoped alias served at
`/git/<projectId>/<name>`, and a committed *relative* submodule url (`../<name>.git`) folds against
the superproject's **real backend** url. For the two to agree, a repository's local alias must equal
its remote basename. Forge namespaces are flat, so the established convention is already
`<project>-<component>` (`github.com/wohlben/qits-backend`, `…/qits-gateway`); the wrapper's
"component" is the project itself. The name is *derived, never supplied* — derivation is the
enforcement — and it derives from the project's **`slug`**, a git-safe identity that is set once and
is **immutable**, deliberately separate from the free-form, editable display `name`. That
immutability is what guarantees a wrapper's alias can never go stale.

**The skeleton.** A wrapper whose main branch has no commit is seeded with the project template — the
empty polyrepo layout the project will grow into, one directory per placeable archetype:

| Directory | Archetype |
|---|---|
| `services/` | `SERVICE` — deployable components |
| `libs/` | `LIBRARY` — shared technical code |
| `integrations/` | `INTEGRATION` — adapters toward other systems |
| `apps/` | `APPLICATION` — end-user-facing apps |

Directory *is* archetype, in both directions: a directory extracted out of `libs/` becomes a
`LIBRARY`, and a `LIBRARY` is mounted back under `libs/`. (`SERVICE_TEMPLATE` and `FORK` are
unplaceable — neither is a component of *this* application.) The skeleton also means `main` is never
unborn, which is what a workspace container's clone needs to land on.

**A wrapper need not have a remote at all.** Created greenfield it has a locally-initialized bare
origin and a null `url`; a backup remote can be attached later. Adopting an existing upstream is
equally supported, and that upstream may be **completely empty** — a forge repository created and
never pushed to — in which case it gets the skeleton on `main`.

**The gradual transition.** An *inline repository* is just a directory in the wrapper destined to
become its own repo. Extracting it splits its history into a sibling repository, which is re-attached
as a submodule at the same path — so the wrapper *becomes* the superproject of a polyrepo
incrementally, and the monorepo→polyrepo move is a per-directory operation rather than a migration.

Why repositories are first-class in qits at all: qits' own reason for being is to **manage and
iterate on git repositories** — it *is* a tool built around git repos. So "a project is a set of
repos" is not incidental plumbing; it is the domain.

## Why there is a "remote" (origin) at all

A repository in qits lives as a **local clone on the qits instance** — that local clone (plus the
bare origin qits serves from its own git host) is the **authoritative working copy** you iterate on.
qits does not depend on any external forge to function; everything works offline against the local
clones.

The optional configured **remote exists purely for backup / disaster recovery.** Git is a
distributed system, so the cheapest possible "backup" is a regular `git push`/`pull` to a remote
repository. If the qits instance is lost (the machine holding the local clones dies), you recover the
work from `origin`. That is the *only* job the remote does — it is a safety net, not the source of
truth. Day-to-day, the instance's local clones are.

## Why projects group repos and import submodules (the technical necessity)

Grouping repos under a project, and importing a superproject's submodules as **sibling
`Repository` rows in the same project**, is not a product feature users asked for in the abstract —
it is the **technical necessity that makes local workspaces work**.

To iterate on a polyrepo application in a local workspace container, that container must be able to
**materialize the whole relevant repo graph offline**, from qits' own git host, with no round-trip to
an external forge. That requires:

1. **Sibling serving.** A project's repos are served as siblings under `/git/<projectId>/<name>` (a
   name link table), so a committed **relative** submodule url (`../shared.git`) resolves *natively*
   against the origin to the correct sibling — no per-url rewriting.
2. **Import as siblings.** When qits imports a repo with submodules, it imports each submodule as
   another `Repository` in the same project (deduped, cycle-safe), so the sibling above actually
   exists to be served.
3. **Offline materialization.** A workspace then clones its repo and walks the submodule closure
   entirely against qits' git host.

So "projects + submodule import" is the machinery that turns *a curated set of related repos* into *a
single, offline-materializable working set for a workspace*. It is downstream of, and in service to,
the workspace model.

## Trust / blast-radius model (calibration for reviews)

Because a project is **one application's curated, single-maintainer repo set**, the following are the
correct assumptions when reasoning about severity — and the reason several theoretically-possible
conditions are **outside the intended blast radius**:

- **Repository names within a project are chosen by the maintainer.** A basename collision between
  two repos in the same project is the maintainer's own naming decision, not an adversarial input.
  Analysis that assumes an attacker plants a repo whose name collides with another to hijack a
  submodule resolution is **out of model** — everything in the project is that maintainer's own code.
- **Submodules referenced by a project's repos are part of the same curated whole.** A `.gitmodules`
  entry points at another component of the same application; it is not an arbitrary internet URL
  smuggling in unrelated content.
- **The remote is a backup, not an authority.** Reasoning that treats a compromised/wrong `origin` as
  able to corrupt the working set inverts the model: the local clones are authoritative; origin is
  only ever pulled from deliberately, for recovery.

This does **not** mean divergences are ignored — where an implementation genuinely differs from the
curated-model contract (e.g. the workspace-daemon's autonomous self-clone materializing submodules
from `.gitmodules` rather than the DB's imported-edge closure), that divergence is documented at the
source (see the
[self-clone feature's *Known limitations*](../epics/qits-workspace-daemon/features/2026-07-23_autonomous-self-clone-on-boot.md)).
The point is **severity calibration**: within one curated project, a "colliding name resolves to an
unrelated repo" scenario requires the maintainer to have named two of their *own* repos into a
collision *and* left one un-imported — a fixable mistake in their own project, not a security or
data-integrity threat from outside it.

## One-line summary

A **project starts as one wrapper repository and grows into a polyrepo** of microservices + shared
components; **repositories are the domain** qits manages; the **remote is just a git-native backup**;
and **project grouping + submodule import exist to make that curated repo set materialize offline in
a local workspace** — so treat a project as one team's cohesive codebase, not an open set of
arbitrary repos.
