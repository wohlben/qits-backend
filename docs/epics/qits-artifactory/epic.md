# Epic: qits-artifactory — the metadata-rich blob store backbone

## Introduction

This epic delivers the **artifactory backbone**: a metadata-rich blob store for build
artifacts, in its own Maven module with its REST API hosted (for now) by the main `service`
module. It exists to be **built on**: the store itself has no UI and no producers of its own —
other epics bring both, consume its upload/query/serve API, and extend it with new repository
*types* over the unchanged core.

Related/dependent plans:

- **First consumer** — the [qits-userflows epic](../qits-userflows/epic.md): user-story runs
  upload their golden screenshots/videos here, its renderer part contributes the
  `ci-userstories` repository type (the first proof that types slot in without core changes),
  and its diff tab is the read-side consumer the store's query contract was shaped for.
- **Future consumers** — the deferred protocol-shaped repositories (**maven, npm, docker**)
  become their own epics referencing this one as backbone, per the store plan's Follow-ups
  section. They are explicitly **not** parts of this epic.
- **Sibling store** — [capture-rendered-view-screenshot](../qits-feature-intake/feature-ideas/capture-rendered-view-screenshot.md)'s
  in-monolith `CaptureArtifactStore` stays as-is; migrating it onto artifactory is a possible
  later consolidation, not part of this epic.

## Parts, in implementation order

1. **[qits-artifactory](feature-ideas/qits-artifactory.md)** — the blob core (content-addressed
   immutable blobs + flat metadata map + query API) in its own module, plus the first two
   repository types, `ci-screenshots` and `ci-videos`. No dependencies inside or outside this
   epic.

A single part today, deliberately: the epic is the *extension point*. New repository types
that serve this epic's own deliverable (a generic, split-deployment-ready store) land here as
new parts; types that serve another deliverable (e.g. `ci-userstories`) belong to the epic
that needs them.

## Done when

The store feature is implemented: repositories can be created, blobs uploaded with validated
metadata, queried with the `latest` collapse, and served immutably — proven by the acceptance
walk in the part's testing sketch.

## Status

| Part | Status |
|---|---|
| [qits-artifactory](feature-ideas/qits-artifactory.md) | idea |
