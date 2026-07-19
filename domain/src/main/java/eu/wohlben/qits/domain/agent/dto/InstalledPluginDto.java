package eu.wohlben.qits.domain.agent.dto;

/**
 * One coding-agent plugin present on the shared credential volume, read from {@code enabledPlugins}
 * in {@code $CLAUDE_CONFIG_DIR/settings.json}. The store is global to the volume (installing from
 * any workspace flips it green in every workspace), so this is a property of the volume, not of a
 * workspace — see {@code docs/epics/qits-coding-agents/features/2026-07-07_agent-lsp-plugins.md}.
 *
 * @param pluginId the marketplace-qualified id, e.g. {@code jdtls-lsp@claude-plugins-official}
 * @param enabled {@code true} when enabled, {@code false} when installed-but-disabled; an id absent
 *     from {@code enabledPlugins} altogether is <em>not installed</em> and never produced here
 */
public record InstalledPluginDto(String pluginId, boolean enabled) {}
