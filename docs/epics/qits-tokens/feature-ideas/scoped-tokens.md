# Scoped tokens: caller-bound, purpose-scoped grants

> **⚠️ REFINEMENT NECESSARY — broad idea, not fleshed out.** This is an early sketch captured to
> hold the shape of an idea, **not** a design ready to build. Key dependencies do not exist yet:
> qits has no **machine-caller identity** to issue "depending on who asks" against, and the only
> imagined resource server (artifactory) is guarded by a **single static token** today. Everything
> below — token format, issuer, claims, revocation — is a **placeholder** to be re-derived once a
> real second consumer and a real caller-identity source land. Do not implement from this document.

## Introduction

A **token base component** for qits' own machine callers. Instead of one long-lived shared secret
that means "you may write," a caller **requests a token for a specific use case**, and qits issues a
token **scoped by who asked** — carrying the exact context (workspace, branch, action, allowed
metadata) that the caller is permitted to act within. The resource server validates the token
**against the operation**, not merely for existence, and refuses anything the scope doesn't cover.

The one-line intuition: **the token is not "a valid caller" — it is "permission to do exactly this."**

Related/dependent plans:

- **Parent epic** — [qits-tokens](../epic.md).
- **First imagined consumer** —
  [qits-artifactory](../../qits-artifactory/features/2026-07-19_qits-artifactory.md): the static
  `ArtifactoryTokenFilter` write guard and the `MetadataKeys` / repository-type required-keys
  validation are what a scoped token would drive. **Hard dependency — nothing here is buildable
  without a concrete artifactory need.**
- **Missing dependency — machine identity**: a way for qits to name the caller of an in-container CI
  action / daemon. Likely grows out of the [qits-workspaces](../../qits-workspaces/) container model
  (callers already reach qits over `qits-net`), but **undefined today**.

## The worked example (artifactory upload)

The concrete case that motivated the idea, to anchor refinement:

1. A CI action running in workspace `W` (branch `feature/x`, user flow `checkout`) needs to upload a
   golden screenshot to artifactory.
2. It **asks qits for an upload token**. qits knows the caller's context (it launched the action in
   `W`) and **mints a token scoped to**: repository `ci-screenshots`, and the metadata it may set —
   `git.branch.name=feature/x`, `qits.userflow.name=checkout` (server-owned keys like `mediatype` /
   `created-at` stay server-stamped as they are today).
3. The action uploads with that token.
4. **artifactory refuses** to store the blob if its metadata is **missing or differs from** the
   token's scope — an upload claiming `git.branch.name=main`, or omitting the user flow, is rejected
   even though the token is otherwise valid.

Net effect: an action **cannot** poison another branch's golden lineage or forge pairing keys, and
the store's authorization becomes **metadata-value-level**, not endpoint-level.

## Sketch of the shape (all provisional)

- **Issuer**: a qits-internal endpoint (`POST /api/tokens`?) that only qits' own trusted launch path
  can reach, or an issuance step folded into how actions/daemons are started. The issuer is the only
  place that knows caller→context, so it is the only place scope can be assigned honestly.
- **Token content**: either a signed, self-describing token (claims = repo + allowed metadata map +
  TTL) that resource servers verify with a shared key, **or** an opaque server-side handle the
  resource server dereferences back to qits. Trade-off (offline verification + split-deployment
  friendliness vs. trivial revocation) is an **open refinement question** — it interacts with the
  artifactory epic's stated goal of being split into a standalone deployable.
- **Validation**: the resource server checks the token's scope **against the concrete operation**.
  For artifactory that means the existing metadata validation gains a "these keys must equal the
  token's scoped values" pass alongside the current "required keys present" pass.
- **Scope vocabulary**: reuses artifactory's `MetadataKeys` for the first consumer; a general scope
  grammar is out of scope until a second consumer reveals what it actually needs.

## Open questions (must be answered before this becomes a real feature)

- **Who is the caller, technically?** No machine-identity primitive exists. Without it, "issued
  depending on who asks" is not implementable. This is the blocking question.
- **Is there a second consumer?** One consumer (artifactory) does not justify a base component; a
  scoped-string check in artifactory would do. The abstraction earns its keep only with a second.
- **Signed token vs. server-side handle** — revocation, TTL, and the artifactory split-deployment
  boundary all pull on this.
- **Relationship to human auth** ([build-variant auth](../../qits-authentication/features/2026-07-16_build-variant-auth.md)):
  shared signing/claims, or deliberately separate machine axis?
- **Failure mode / DX**: what a scope violation looks like to the action author (clear 4xx with the
  offending key), and whether dev/test stays open (as artifactory's blank-token default is today).

## Out of scope (for now — because the idea isn't ready)

- Any implementation. This document exists to be **refined**, then promoted to a dated feature draft.
- Human/session auth, edge authentication — owned by
  [qits-authentication](../../qits-authentication/).
- A general cross-service scope/claims grammar — deferred until a second consumer exists.
