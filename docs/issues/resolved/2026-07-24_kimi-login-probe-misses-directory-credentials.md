# Kimi login probe misreads a signed-in volume (credentials is a directory, not a file)

## Introduction

Related/dependent plans:

- `docs/epics/qits-coding-agents/features/2026-07-20_kimi-code-harness.md` — the harness feature that
  introduced the credential-presence probe, written when `credentials` was still a flat file.
- `domain/src/main/java/eu/wohlben/qits/domain/agent/control/AgentAuthStatus.java` — the fixed probe.
- `docker/workspace/agent-login.sh` — the one-time `kimi login` that writes the credentials.

## Symptom

With Kimi Code signed in on the shared credential volume, starting a kimi session from the workspace
agent tab still redirected to the sign-in terminal, which "flickered": the spawned `kimi login` saw
the existing valid credentials and exited immediately, so the terminal closed at once. Every launch
took the login redirect; kimi chat/interactive sessions were unreachable.

## Root cause

`AgentAuthStatus.probeKimi` ran `test -f "$KIMI_CODE_HOME/credentials"`. The harness feature (July
20) assumed `credentials` is a flat file, but current Kimi Code (0.28+) uses a directory layout: the
OAuth token lives at `$KIMI_CODE_HOME/credentials/kimi-code.json` (verified on the live volume:
`drwx------ … credentials/` containing `kimi-code.json`, plus `oauth/kimi-code`). `test -f` on a
directory fails, so the probe always reported signed-out, `AgentLaunchService` redirected to
`launchLogin`, and the already-logged-in `kimi login` exited instantly — the flicker.

## Fix

The probe now accepts either layout:

```bash
test -f "$KIMI_CODE_HOME/credentials" || test -f "$KIMI_CODE_HOME/credentials/kimi-code.json"
```

Regression coverage in `AgentAuthStatusKimiTest.directoryLayoutCredentialsCountAsLoggedIn` (the
pre-existing test pinned the legacy flat-file layout and still passes). The symlink farm in
`KimiCodeAgent.appendKimiHomePrelude` was unaffected — `[ -e … ]` + `ln -s` work for directories.
