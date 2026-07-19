/**
 * The curated set of coding-agent LSP plugins qits knows how to install, from the pre-registered
 * `claude-plugins-official` marketplace. This is a small static list (not fetched) joined against the
 * backend's installed-status for the shared credential volume — see the Plugins tab
 * ({@link WorkspacePluginsComponent}) and `docs/epics/qits-coding-agents/features/2026-07-07_agent-lsp-plugins.md`.
 *
 * Each entry names the framework id(s) it serves (from {@link detectFrameworks}: `java-quarkus`,
 * `ts-angular`), so the tab can float the plugins a workspace actually wants to the top — without
 * hiding the rest (the "everything available, surfaced by visible rules" convention). The language
 * server each plugin wires up is baked into the workspace image, so an install only needs to write
 * the plugin entry to the shared volume.
 */
export interface AgentPluginEntry {
  /** The bare, marketplace-unqualified plugin id — what the install endpoint takes. */
  readonly id: string;
  /** The marketplace the id resolves against (always the pre-registered official one, for now). */
  readonly marketplace: string;
  /** Short human label for the row. */
  readonly label: string;
  /** One-line description of what the plugin gives the agent. */
  readonly description: string;
  /** Framework ids (from {@link detectFrameworks}) this plugin is recommended for. */
  readonly frameworkIds: readonly string[];
}

export const AGENT_PLUGIN_MARKETPLACE = 'claude-plugins-official';

export const AGENT_PLUGIN_REGISTRY: readonly AgentPluginEntry[] = [
  {
    id: 'jdtls-lsp',
    marketplace: AGENT_PLUGIN_MARKETPLACE,
    label: 'Java LSP (jdtls)',
    description:
      'Eclipse JDT language server — go-to-definition, find-references and type errors for .java files.',
    frameworkIds: ['java-quarkus'],
  },
  {
    id: 'typescript-lsp',
    marketplace: AGENT_PLUGIN_MARKETPLACE,
    label: 'TypeScript LSP',
    description:
      'typescript-language-server — code intelligence for TypeScript/Angular (.ts, .tsx, .js).',
    frameworkIds: ['ts-angular'],
  },
];

/** The marketplace-qualified id (`jdtls-lsp@claude-plugins-official`) — the settings.json key. */
export function agentPluginKey(entry: AgentPluginEntry): string {
  return `${entry.id}@${entry.marketplace}`;
}
