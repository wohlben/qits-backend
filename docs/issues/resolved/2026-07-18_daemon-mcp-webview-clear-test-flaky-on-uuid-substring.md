# DaemonMcpToolsTest web-view clear assertion is flaky on UUID substrings

## Introduction

Found while running the full service suite for the
[workspace bootstrap commands](../epics/qits-workspaces/features/2026-07-18_workspace-bootstrap-commands.md) feature —
unrelated to that change. Related: the daemon MCP tools
([daemon web-view configuration](../epics/qits-workspace-daemons/features/2026-07-06_daemon-webview-configuration.md)).

## Observed

`DaemonMcpToolsTest.configuresTheWebViewThroughFlatArgs` fails rarely with:

```
cleared config: {"id":"ff480800-…","…","repositoryId":"349b5c6d-0678-4200-99ff-ca8d0fa7892e",…}
==> expected: <false> but was: <true>
```

The daemon's `webView` **was** correctly cleared (`"webView":null` in the very payload printed) —
the assertion still failed because it checks the *whole response text* for the absence of the
port digits:

```java
assertFalse(text(response).contains("4200"), "cleared config: " + text(response));
```

and the randomly generated repository UUID happened to contain the substring `4200`
(`…0678-4200-99ff…`). Probability is small per run (a UUID containing a fixed 4-digit substring)
but the suite rolls those dice on every execution.

## Suspected cause

`service/src/test/java/eu/wohlben/qits/domain/daemon/mcp/DaemonMcpToolsTest.java` (~line 349):
substring matching over the serialized DTO instead of asserting the structured field.

## Suggested fix

Assert the structure, not the text — e.g. parse the tool response's daemon JSON and assert
`webView == null` (the REST follow-up assertion four lines below already does exactly that), or
narrow the substring check to `"port":4200`.

## Resolution

Resolved by removal: the admin-shaped `DaemonMcpTools` (and with them `DaemonMcpToolsTest`) were
deleted on 2026-07-21 — the daemon MCP surface moves to workspace-scoped tools, see
[Daemon kinds & workspace-scoped MCP](../epics/qits-workspace-daemons/feature-ideas/daemon-kinds-and-workspace-mcp.md).
