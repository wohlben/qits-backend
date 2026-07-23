# The project model: an application as a polyrepository

This guide explains **what a qits `Project` actually is**, and why repositories, remotes, and
submodule import exist the way they do. It is the conceptual frame the feature docs assume but don't
restate — read it before reasoning about "what could go wrong" in the repository/submodule/workspace
code, because a lot of the apparent blast radius collapses once the intended model is clear.

This is a *current-state contract* document (like the other `docs/guides/*`): update it in place when
a feature changes the model.

## Introduction / related

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

A **`Project` is one application**, deliberately organized as a **polyrepository** rather than a
monorepository. Its `Repository` rows are the parts of that one application:

- **microservices** — the deployable components, each its own repo;
- **shared technical components** — libraries and code shared across those services (e.g. a common
  client, a schema module);
- **extracted fixtures / support repos** — pieces pulled out of the main app for easier handling on
  their own (qits' own test fixtures are the reference example — see
  [qits-testing-fixtures](../epics/qits-testing-fixtures/epic.md)).

The polyrepo split is a **structuring choice by a single maintainer of a single application**, not an
aggregation of unrelated third-party code. Everything under a project is code that team curates
together. This is the load-bearing fact for the trust model below.

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

A **project is an application split into a polyrepo** for microservices + shared components;
**repositories are the domain** qits manages; the **remote is just a git-native backup**; and
**project grouping + submodule import exist to make that curated repo set materialize offline in a
local workspace** — so treat a project as one team's cohesive codebase, not an open set of arbitrary
repos.
