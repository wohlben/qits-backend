# QITS

QITS (Quickly Iterate The Software) is an application built to accelerate software development workflows through rapid iteration.

It manages **projects** as a shared scope for **repositories**, isolates every change in a **worktree**, executes work through re-attachable **commands**, and drives changes with **coding agents** (Claude Code) that are launched, observed, and replayed from within the application. Standardized lifecycles are described as **feature flows** with reusable **actions** as quality gates.

QITS lives in a single monorepo (this repository), containing the backend (Quarkus, Maven modules `domain`/`service`/`cli`) and the web UI (Angular, served by the backend). The former split into separate `qits-ui`, `qits-backend`, and `qits-domain` repositories has been merged away.

## Documentation

This directory holds the high-level domain documentation. It is organized by user flows ([`userflows/`](userflows/)) and describes what the system does and why, independent of any single implementation.

The generated REST API description lives at [`docs/openapi.yml`](../openapi.yml) (regenerated from the code — do not hand-edit).
