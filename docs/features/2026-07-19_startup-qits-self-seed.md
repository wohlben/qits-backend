# Startup self-seed: the real deployment registers the qits repositories itself

## Introduction

A packaged ("real", non-devserver) qits deployment starts empty: registering
`wohlben/qits-backend` on it is a manual UI walk
(`docs/guides/qits-in-qits-registration.md` — create the "qits" project, add the repository with
submodule import ON, run one second-level import on the quarkus-angular fixture child). This
feature makes the packaged instance do that walk **itself, automatically at startup**: the main
deployment boots into a seeded "qits" project with the qits repositories registered, their
daemons/actions/bootstrap already ingested from `.qits-config.yml`.

The preexisting cli seeds (`seed`, `seed-webapp`) are untouched and are **not** run by the main
deployment — they live on *inside* the seeded project: `.qits-config.yml`'s `bootstrap:` chain
runs them in every freshly provisioned child-qits workspace container, so the demo fixtures keep
existing exactly where the config declares them (one level down, in the managed child), while
the top-level deployment manages the real thing.

Related/dependent plans:

- **Automates the manual recipe** — `docs/guides/qits-in-qits-registration.md` steps 1 (project
  + repository + submodule import) become startup behavior; the guide shrinks to the
  workspace/first-build walk and must be updated in the same commit.
- **Rides `.qits-config.yml` ingestion** —
  `docs/features/2026-07-18_qits-config-in-repo-configuration.md`: clone-time ingestion is what
  keeps this seed *thin* (project + repo rows only — daemons, actions, bootstrap, stack hints
  all arrive declaratively from the repo). Contrast `SeedService`, which must define its demo
  daemon programmatically because the tiny fixture carries no config file.
- **Presupposes the dogfooding convention** —
  `docs/features/2026-07-18_qits-dogfooding-managed-app-convention.md` made qits registrable as
  a managed app in the first place.
- **Submodule import semantics** —
  `docs/features/2026-07-14_workspace-submodule-support.md`: creation-time import is one level;
  the nested `webui` gitlink needs one explicit second-level import on the
  `testing-repo-quarkus-angular` child (the seed automates that too).
- **Demo-seed relocation** — `docs/features/2026-07-18_workspace-bootstrap-commands.md`: the
  bootstrap chain is the mechanism by which the demo seeds "continue to exist for this seeded
  project".

## Contract

1. **Trigger: packaged runs only.** The seed runs on startup when the launch mode is `NORMAL`
   (packaged jar / native / prod image). `quarkus:dev` and tests never self-seed — the
   devserver instance keeps its current empty-until-cli-seeded behavior. A config kill-switch
   (`qits.startup-seed.enabled`, default `true`; forced `false` under dev/test launch modes)
   lets a deployment opt out, and `qits.startup-seed.repo-url` (default
   `https://github.com/wohlben/qits-backend.git`) redirects the clone source (mirror, fork,
   air-gapped file path).
2. **A declarative manifest, reconciled on every startup.** The seed is not a one-shot
   "populate if empty": it is a small in-code manifest — the project name plus an **ordered
   list of desired repositories** (URL, archetype, import-submodules flag, follow-up deep
   imports) — that startup **reconciles additively** against the DB on every boot. This is the
   load-bearing shape: a future release that must register more qits repositories just appends
   a manifest entry, and the next deployment's startup adds exactly the missing one to the
   already-seeded project. (The manifest is versioned with the code — no migration, no flag
   day.) The **initial manifest** is both halves of qits:
   `https://github.com/wohlben/qits-backend.git` (SERVICE, import-submodules ON, one
   second-level import) and `https://github.com/wohlben/qits-angular-integration.git` (the
   `@qits/angular` library, `docs/features/2026-07-13_qits-angular-integration-library.md` —
   SERVICE, no submodules, no deep imports).
3. **Idempotency is per item, not per seed** (driving the real services, like the cli seeds —
   no raw SQL):
   - Project **"qits"**: created if absent, matched by name otherwise (`ProjectService`).
   - Each manifest repository: matched by **clone URL within the project**; created via
     `createRepositoryUnderProject(projectId, url, SERVICE, importSubmodules=true)` if absent,
     skipped untouched if present. For qits-backend the creation-time import registers
     `testing-repo`, `qits-fixture-angular` and `testing-repo-quarkus-angular` as sibling
     repositories, and the clone ingests `.qits-config.yml` (dev-server daemon, actions,
     bootstrap chain, framework hints).
   - Each declared **second-level submodule import** (for qits-backend: one on the
     `testing-repo-quarkus-angular` child, linking its nested `webui` gitlink back to the
     already-imported `qits-fixture-angular` sibling — the follow-up the registration guide
     requires manually today): re-running it is already a no-op by the import's own semantics.
   - Per-item matching also makes **partial failure self-healing**: a boot that created the
     project but lost the clone to a network blip completes the missing pieces on the next
     boot, with no wedged "already seeded" state.
   - **Additive only.** Reconciliation never deletes or modifies rows it finds — repositories
     the user added under the project, renamed projects, hand-edited config all survive. A
     manifest entry removed in a future release simply stops being enforced; cleanup stays
     manual.
   - **No workspace.** Provisioning is lazy by design and the child-qits first build is heavy;
     the user opens/creates the first workspace deliberately.
4. **Asynchronous and non-fatal.** The seed needs network reach to GitHub; it runs on a worker
   thread after startup (does not block readiness), logs a per-item outcome, and a failure
   leaves a usable instance — the next boot's reconciliation retries exactly the failed items.
5. **Demo seeds unchanged.** `seed`/`seed-webapp` stay cli-only commands; nothing on the main
   deployment invokes them.
6. **No pull on reconcile — out of scope *for now*.** The seed registers; config updates to an
   already-seeded repo arrive through the normal pull-triggered re-ingestion, not at boot
   (pull is user-visible behavior). Revisit if redeploys routinely need a manual pull just to
   pick up `.qits-config.yml` changes.

## Design sketch

- **`SelfSeedService` in `domain`** (`project.control` or a small new `seeding` area): holds
  the manifest (a `List<SeedRepository>` constant — URL, archetype, deep-import paths) and the
  reconcile loop: ensure-project → for each entry, ensure-repository (match by URL) →
  ensure-deep-imports. Living in `domain` keeps it testable in the domain suite and reusable if
  a cli command ever wants it (`cli.args=seed-self` as a manual escape hatch is a cheap bonus).
- **Startup gate in `service`**: a small `@Observes StartupEvent` bean that checks
  `LaunchMode.current() == NORMAL` + the enabled flag and dispatches the reconcile to a worker
  thread. Worker-thread caveat as in `beginEnsureContainer`: no request context — the service
  needs `@ActivateRequestContext`/own transactions (the cli seeds already model this).
  Startup — not a cli command, not a cron — is the deliberate home: reconciliation must run on
  **every release rollout** so manifest additions land, and a deployment's only guaranteed
  "new code is now running" moment is boot.
- **Finding the second-level child**: after the root clone, resolve the imported sibling whose
  name is `testing-repo-quarkus-angular` (via the submodule-edge rows the import created) and
  invoke the same one-level import the repository detail view's button calls.
- **Prod deployment fit**: the Dokploy/prod image (oauth variant) needs outbound HTTPS to
  GitHub at boot — already true (the workspace containers fetch from GitHub). Repos land under
  the mounted `~/.qits/data` volume, so the seed survives container recreation and every
  subsequent boot's reconcile is a fast all-items-present no-op.

## Open questions

- **URL matching vs the override.** With per-item matching keyed on clone URL,
  `qits.startup-seed.repo-url` (a mirror/fork override) changes the identity of the
  qits-backend entry — a deployment that flips the override after first seed would get a second
  repository. Acceptable for an escape hatch, but worth a note in the config docs; matching by
  a manifest-assigned stable key (e.g. repo name) instead of URL would dodge it. (The override is
  trimmed to match the stored url, so surrounding whitespace does not by itself split identity.)

- **Concurrent replicas.** Matching is check-then-create with no unique constraint or lock, so two
  packaged instances sharing one database that reconcile at the same moment (a rolling redeploy /
  horizontal scale-out) could each create the `qits` project or a duplicate repo. The single-node
  prod deployment (Dokploy) doesn't hit this, and the sibling cli seeds share the pattern; a
  distributed guard is out of scope for now. Cleanup, if it ever happens, stays manual.

## Testing

- `SelfSeedServiceTest` (domain, `@QuarkusTest`, `FakeContainerRuntime`, fixture URL override):
  seeds project + both manifest repos + siblings, second-level import linked the nested `webui`
  edge; re-run
  is a full no-op; a half-seeded state (project present, repo missing) is completed on the next
  reconcile; a grown manifest adds only the new entry to an already-seeded project; rows the
  manifest doesn't own (user-added repo under the project) are untouched.
- Service-side gate test: startup under test launch mode never seeds; the enabled flag is
  honored.
- The real-deployment walk moves into the registration guide's acceptance section (packaged
  image boots → "qits" project appears with daemons/actions ingested, no UI steps).

## Status — implemented 2026-07-19

Built and tested (`domain` + `service` suites green):

- **Reconcile logic** `SelfSeedService` (new `eu.wohlben.qits.domain.seeding.control` area) — holds
  the in-code manifest (a `List<SeedRepository>`: url, archetype, `importSubmodules`, `deepImport`)
  and the additive, per-item-idempotent reconcile loop: ensure-project (matched by name `"qits"`) →
  for each entry, ensure-repository (matched by clone url within the project, created via
  `ProjectService.createRepositoryUnderProject` if absent) → deep-import. `@ActivateRequestContext`
  (not `@Transactional`) so the non-transactional reads work on a worker thread while the delegated
  service calls own their transactions — the cli-seed pattern. Each entry reconciles in its own
  try/catch, so one failing clone is non-fatal and retried next boot.
- **Deep import descends one level into every direct child** (`listSubmodules(root)` →
  `importDirectSubmodules(edge.child.id)`) rather than name-matching a specific child. This is
  override-independent and idempotent — a no-op on childless siblings (`testing-repo`,
  `qits-fixture-angular`) and, on the `testing-repo-quarkus-angular` child, it links the nested
  `webui` gitlink back to the already-imported `qits-fixture-angular` sibling: exactly the manual
  second-level import the registration guide required.
- **Startup gate** `StartupSelfSeed` (`service` module, `eu.wohlben.qits.seeding`) — an
  `@Observes StartupEvent` bean that seeds only when `LaunchMode.current() == NORMAL` and
  `qits.startup-seed.enabled` (default `true`), dispatching the reconcile to a virtual thread (the
  `TranscriptionService` warmup precedent) so readiness never blocks. Lives in `service` so it fires
  only when the web app boots — the `cli` command-mode app never self-seeds. The gate predicate is a
  pure `static shouldSeed(LaunchMode, boolean)` for direct unit-testing.
- **Config** — `qits.startup-seed.enabled` (default `true`), `qits.startup-seed.repo-url` (default
  `https://github.com/wohlben/qits-backend.git`), and `qits.startup-seed.angular-integration-url`
  (default `https://github.com/wohlben/qits-angular-integration.git`, the second override added so
  the domain test can seed both manifest repos offline).
- **Tests** — `SelfSeedServiceTest` (domain, fixtures redirect the qits-backend slot to
  `submodule-super.git` — its `child-a → grandchild` depth stands in for the quarkus-angular
  `webui` edge — and the angular slot to plain `testing-repo.git`): project + both repos + siblings
  + the nested deep-import edge, re-run is a full no-op, a half-seeded state is completed, and a
  user-added repo under the project is untouched. `StartupSelfSeedGateTest` (service): the gate
  predicate, and a TEST-mode boot leaving no `qits` project.

### Resolved decisions

- **Deep import is a blanket one-level descend** over the imported direct children, not a
  path/url-matched single import — simpler, override-independent, and idempotent (childless children
  are no-ops).
- **Second url override** (`qits.startup-seed.angular-integration-url`) added beyond the doc's
  single `repo-url`, so both manifest repos are redirectable to fixtures for the offline test.
