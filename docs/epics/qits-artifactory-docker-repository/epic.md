# Epic: qits-artifactory-docker-repository — a Docker registry v2 over the artifactory core

## Introduction

A follow-up to the **[qits-artifactory epic](../qits-artifactory/epic.md)**, which this epic
references as its **backbone**: a new repository **type** that speaks the **Docker Registry HTTP API
v2** over the content-addressed blob core, so workspace builds can push and pull images through
artifactory. The heaviest of the three deferred protocol types (chunked blob uploads, manifests
referencing blobs by digest) — though content-addressed storage is exactly what a registry wants, so
the core's SHA-256 blob identity maps almost directly onto registry digests.

Related/dependent plans:

- **Backbone** — [qits-artifactory](../qits-artifactory/features/2026-07-19_qits-artifactory.md): provides
  the immutable, digest-addressed blob store, typed repositories, own datasource/Flyway lineage, and
  the split-deployment boundary this type slots into as a new `RepositoryType`. Registry digests
  (`sha256:…`) map onto the core's existing content addressing — the main new work is the protocol
  (uploads, manifests, tags), not the storage.
- **Sibling deferred types** — [qits-artifactory-maven-repository](../qits-artifactory-maven-repository/epic.md),
  [qits-artifactory-npm-repository](../qits-artifactory-npm-repository/epic.md).

## Parts, in implementation order

1. **docker-repository** *(idea)* — the Registry v2 surface: `/v2/` version check, blob upload
   (`POST`/`PATCH`/`PUT` chunked + monolithic), blob/manifest GET/HEAD by digest, manifest PUT, tags
   list. Digest = the core blob id.

## Done when

A workspace `docker push` pushes to, and `docker pull` pulls from, an artifactory Docker repository.

## Status

| Part | Status |
|---|---|
| docker-repository | idea |
