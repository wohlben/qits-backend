# Epic: qits-artifacts-npm-repository — an npm registry over the artifacts core

## Introduction

A follow-up to the **[qits-artifacts epic](../qits-artifacts/epic.md)**, which this epic
references as its **backbone**: a new repository **type** that speaks a subset of the **npm registry
API** (publish + install) over the unchanged content-addressed blob core, so workspace builds can
publish and install packages through artifacts. A protocol-shaped repository — deferred from the
backbone because it needs npm registry protocol emulation (packument JSON, tarball attachment,
`dist-tags`), a different order of work than a metadata profile over a generic blob core.

Related/dependent plans:

- **Backbone** — [qits-artifacts](../qits-artifacts/features/2026-07-19_qits-artifacts.md): provides
  the immutable blob store, typed repositories, own datasource/Flyway lineage, and the split-deployment
  boundary this type slots into as a new `RepositoryType` without touching the core.
- **Sibling deferred types** — [qits-artifacts-maven-repository](../qits-artifacts-maven-repository/epic.md),
  [qits-artifacts-docker-repository](../qits-artifacts-docker-repository/epic.md).

## Parts, in implementation order

1. **npm-repository** *(idea)* — the npm registry API subset: `PUT /{package}` publish (packument +
   base64 tarball attachment → blob), `GET /{package}` packument, `GET /{package}/-/{tarball}` serve,
   and `dist-tags`.

## Done when

A workspace `npm publish` publishes to, and `npm install` resolves from, an artifacts npm registry.

## Status

| Part | Status |
|---|---|
| npm-repository | idea |
