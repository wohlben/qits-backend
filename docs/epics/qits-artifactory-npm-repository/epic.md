# Epic: qits-artifactory-npm-repository — an npm registry over the artifactory core

## Introduction

A follow-up to the **[qits-artifactory epic](../qits-artifactory/epic.md)**, which this epic
references as its **backbone**: a new repository **type** that speaks a subset of the **npm registry
API** (publish + install) over the unchanged content-addressed blob core, so workspace builds can
publish and install packages through artifactory. A protocol-shaped repository — deferred from the
backbone because it needs npm registry protocol emulation (packument JSON, tarball attachment,
`dist-tags`), a different order of work than a metadata profile over a generic blob core.

Related/dependent plans:

- **Backbone** — [qits-artifactory](../qits-artifactory/features/2026-07-19_qits-artifactory.md): provides
  the immutable blob store, typed repositories, own datasource/Flyway lineage, and the split-deployment
  boundary this type slots into as a new `RepositoryType` without touching the core.
- **Sibling deferred types** — [qits-artifactory-maven-repository](../qits-artifactory-maven-repository/epic.md),
  [qits-artifactory-docker-repository](../qits-artifactory-docker-repository/epic.md).

## Parts, in implementation order

1. **npm-repository** *(idea)* — the npm registry API subset: `PUT /{package}` publish (packument +
   base64 tarball attachment → blob), `GET /{package}` packument, `GET /{package}/-/{tarball}` serve,
   and `dist-tags`.

## Done when

A workspace `npm publish` publishes to, and `npm install` resolves from, an artifactory npm registry.

## Status

| Part | Status |
|---|---|
| npm-repository | idea |
