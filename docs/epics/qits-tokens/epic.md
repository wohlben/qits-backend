# Epic: qits-tokens — purpose-scoped, caller-bound tokens

> **⚠️ REFINEMENT NECESSARY — broad idea, not fleshed out.** This epic is a *direction*, not a
> committed design. It sketches a token model that several **dependent features do not yet exist**
> to justify or constrain (there is no per-workspace / per-action machine identity to issue against,
> no second token consumer beyond artifactory, and artifactory itself guards writes with a **single
> static token** today). Treat every part below as a placeholder to be re-derived once a real second
> consumer and a real caller-identity source land — the shape here (who asks → what scope) is the
> intuition to preserve, the mechanism is wide open. Do **not** start implementation from this
> document; promote a part to a real feature draft only when its dependencies are concrete.

## Introduction

This epic imagines a **token base component**: a small, shared capability for minting and validating
**purpose-scoped tokens** that qits issues to its own machine callers (workspace CI actions,
daemons, the coding agent) and that a resource server checks *against the scope it was minted for*,
not just for existence.

The motivating shift is from **"is this token valid?"** to **"is this caller allowed to do exactly
*this*?"**. A token is **requested for a use case** and **issued depending on who asks** — the
issuer knows the caller's context (which workspace, which branch, which action) and bakes that
context into the token as a **scope**. The resource server then refuses anything outside the scope,
even with an otherwise-valid token.

The concrete first example (and the reason this idea surfaced now) is **artifactory uploads**: a
workspace CI action asks qits for a token to upload a screenshot; qits issues a token **scoped to
the metadata that action is allowed to set** (e.g. `git.branch.name=<the workspace's branch>`,
`qits.userflow.name` from the running flow); artifactory then **refuses to store a blob whose
metadata is missing or differs from** that scope. The action cannot upload to another branch's
golden lineage, cannot forge a user-flow name, cannot omit the pairing keys — the token *is* the
authorization to write exactly those metadata values and no others.

Related/dependent plans:

- **First imagined consumer / hard dependency** —
  [qits-artifactory](../qits-artifactory/features/2026-07-19_qits-artifactory.md): today its write
  surface is guarded by a **single static `qits.artifactory.token`** (see
  `service`'s `ArtifactoryTokenFilter`, on `auth-core`'s `PublicPaths` allowlist). That static token
  is exactly what a scoped token would **replace/augment** — the metadata scope enforcement described
  above is a change to *already-implemented* artifactory upload validation (`MetadataKeys` +
  the repository-type required-keys check), not a new store. **This epic must not start until there
  is a concrete metadata-authorization requirement artifactory actually needs.**
- **Missing dependency — caller identity.** Issuing "depending on who asks" presumes qits can name
  the caller (this workspace, this action run). That machine-identity surface does **not exist yet**;
  the [qits-workspaces](../qits-workspaces/) execution model (per-workspace containers reaching qits
  over `qits-net`) is the likely place it grows, but no feature defines it. Until it does, "who asks"
  is unanswerable and this epic is premature.
- **Relationship to build-variant auth** —
  [qits-authentication](../qits-authentication/features/2026-07-16_build-variant-auth.md) is about
  **human** identity at the edge (OIDC / forward-auth, the `QitsAuthPolicy`). These tokens are about
  **machine** callers *inside* qits' own trust boundary asking qits for narrowly-scoped grants — a
  different axis. Whether the two share primitives (claims, a signing key) is an open refinement
  question, not a settled dependency.

## Parts, in implementation order

> All parts are **ideas pending refinement** — see the banner above.

1. **scoped-tokens** *(idea — [feature-ideas/scoped-tokens.md](feature-ideas/scoped-tokens.md))* — the
   broad sketch: a token = a set of **scope claims** issued to a named machine caller, validated at the
   resource server against the operation. Includes the artifactory-metadata worked example and the
   open questions (caller identity source, token format/signing vs. server-side handle, revocation,
   TTL, who the issuer is).

## Done when

*(Undefinable until refined.)* Provisionally: a machine caller can request a token scoped to a
specific operation, and a resource server (first: artifactory upload) **denies the same operation
outside that scope** — proven by a test where a token minted for branch A's metadata is rejected when
used to write branch B's. This bar only becomes real once caller identity and a second consumer exist.

## Status

| Part | Status |
|---|---|
| [scoped-tokens](feature-ideas/scoped-tokens.md) | idea — refinement necessary |
