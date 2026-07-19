# Epic: qits-artifactory-maven-repository — a Maven layout over the artifactory core

## Introduction

A follow-up to the **[qits-artifactory epic](../qits-artifactory/epic.md)**, which this epic
references as its **backbone**: a new repository **type** that speaks the **Maven layout** over the
unchanged content-addressed blob core, so workspace builds can resolve and deploy dependencies
through artifactory. This is a protocol-shaped repository — deliberately deferred from the backbone
because it needs protocol emulation (Maven layout GET/PUT paths: `…/group/artifact/version/artifact-version.jar`
+ `maven-metadata.xml`), a different order of work than a metadata profile over a generic blob core.

Related/dependent plans:

- **Backbone** — [qits-artifactory](../qits-artifactory/features/2026-07-19_qits-artifactory.md): provides
  the immutable blob store, typed repositories, own datasource/Flyway lineage, and the split-deployment
  boundary this type slots into as a new `RepositoryType` without touching the core.
- **Sibling deferred types** — [qits-artifactory-npm-repository](../qits-artifactory-npm-repository/epic.md),
  [qits-artifactory-docker-repository](../qits-artifactory-docker-repository/epic.md).

## Parts, in implementation order

1. **maven-repository** *(idea)* — Maven layout GET/PUT path mapping onto blob upload/serve, snapshot
   vs release semantics, `maven-metadata.xml` generation, and the build-cache/proxy question (proxying
   Maven Central vs hosting only).

## Done when

A workspace `mvn deploy` publishes to, and `mvn` resolves from, an artifactory Maven repository.

## Status

| Part | Status |
|---|---|
| maven-repository | idea |
