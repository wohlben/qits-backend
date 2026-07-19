package eu.wohlben.qits.domain.agent.control;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import eu.wohlben.qits.domain.agent.dto.InstalledPluginDto;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
import eu.wohlben.qits.domain.repository.control.WorkspaceService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Lists and installs the coding agent's (Claude Code) LSP plugins against the
 * <strong>shared</strong> credential volume. Every workspace container mounts the one {@code
 * qits.workspace.claude-volume} at {@code HOME=/claude-home}, so Claude Code's plugin store under
 * {@code $CLAUDE_CONFIG_DIR/plugins} is global: installing from any workspace is visible in all of
 * them, and status is a property of the volume, not the workspace (see {@code
 * docs/epics/qits-coding-agents/features/2026-07-07_agent-lsp-plugins.md}). Endpoints therefore
 * hang off a workspace only because a workspace is what owns a container to run the op inside — any
 * workspace acts on the same global store.
 *
 * <p>Both ops route through {@link ContainerRuntime#exec} with {@code HOME} pointed at the shared
 * mount, exactly like {@link AgentAuthStatus}. Listing is <em>claude-binary-free</em> — it {@code
 * cat}s and JSON-parses {@code settings.json}; installing shells the {@code claude} CLI (the
 * marketplace is pre-registered, so no {@code marketplace add} step).
 */
@ApplicationScoped
public class AgentPluginService {

  private static final ObjectMapper MAPPER = new ObjectMapper();

  /** The pre-registered official marketplace every curated LSP plugin is qualified against. */
  static final String MARKETPLACE = "claude-plugins-official";

  /**
   * A bare plugin id (before {@code @marketplace} is appended). Constrained to a lowercase slug:
   * the id is passed as an argv element to {@code claude plugin install} (no shell, so no injection
   * risk), but a strict slug rejects junk/path-shaped input early with a clear 400.
   */
  private static final Pattern PLUGIN_ID = Pattern.compile("[a-z0-9][a-z0-9-]{0,63}");

  /**
   * Repository ids are generated UUIDs; only hex and dashes ever appear (mirrors the agent path).
   */
  private static final Pattern UUID = Pattern.compile("[0-9a-fA-F-]{36}");

  /**
   * Workspace ids are path segments, so they must be strict slugs (mirrors {@code
   * WorkspaceService}).
   */
  private static final Pattern WORKSPACE_ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");

  @Inject ContainerRuntime containers;

  @Inject WorkspaceService workspaceService;

  /**
   * Where the shared credential volume mounts (and where the agent's {@code HOME} points). The
   * plugin store and {@code settings.json} live under {@code <mount>/.claude}. Mirrors {@code
   * qits.workspace.claude-mount}.
   */
  @ConfigProperty(name = "qits.workspace.claude-mount", defaultValue = "/claude-home")
  String claudeMount;

  /**
   * The plugins installed on the shared volume, read from {@code enabledPlugins} in {@code
   * settings.json}. Absent-file (never installed anything) reads as an empty list, not an error.
   */
  public List<InstalledPluginDto> listInstalled(String repoId, String workspaceId) {
    validateIds(repoId, workspaceId);
    return installedOn(ensureContainer(repoId, workspaceId));
  }

  /**
   * Installs {@code pluginId} from the official marketplace onto the shared volume ({@code claude
   * plugin install <id>@claude-plugins-official} with {@code HOME} on the mount). Idempotent — the
   * CLI no-ops an already-installed plugin. Returns the refreshed installed set so the caller can
   * reflect the flip without a second round trip.
   */
  public List<InstalledPluginDto> install(String repoId, String workspaceId, String pluginId) {
    validateIds(repoId, workspaceId);
    if (pluginId == null || !PLUGIN_ID.matcher(pluginId).matches()) {
      throw new BadRequestException("Invalid plugin id: " + pluginId);
    }
    String container = ensureContainer(repoId, workspaceId);
    ContainerRuntime.ExecResult result =
        containers.exec(
            container,
            "/workspace",
            Map.of("HOME", claudeMount),
            "claude",
            "plugin",
            "install",
            pluginId + "@" + MARKETPLACE);
    if (result.exitCode() != 0) {
      throw new InternalServerErrorException(
          "Failed to install plugin " + pluginId + ": " + result.output());
    }
    return installedOn(container);
  }

  /** Reads and parses {@code enabledPlugins} out of the shared volume's {@code settings.json}. */
  private List<InstalledPluginDto> installedOn(String container) {
    ContainerRuntime.ExecResult result =
        containers.exec(
            container, "/workspace", Map.of("HOME", claudeMount), "cat", settingsPath());
    if (result.exitCode() != 0) {
      // No settings.json on the volume yet (nothing ever installed) — not an error, just empty.
      return List.of();
    }
    return parseEnabledPlugins(result.output());
  }

  /** The container-side path of the shared volume's Claude Code settings file. */
  private String settingsPath() {
    return claudeMount + "/.claude/settings.json";
  }

  /**
   * Re-provisions a lost container up front (so a stopped one doesn't read as empty) and returns
   * its deterministic name. A missing branch fails loudly here.
   */
  private String ensureContainer(String repoId, String workspaceId) {
    workspaceService.ensureContainer(repoId, workspaceId);
    return containers.containerName(workspaceId, repoId);
  }

  private void validateIds(String repoId, String workspaceId) {
    if (repoId == null || !UUID.matcher(repoId).matches()) {
      throw new BadRequestException("Invalid repository id: " + repoId);
    }
    if (workspaceId == null || !WORKSPACE_ID.matcher(workspaceId).matches()) {
      throw new BadRequestException("Invalid workspace id: " + workspaceId);
    }
  }

  /**
   * Parses the {@code enabledPlugins} object of a Claude Code {@code settings.json}: each key is a
   * marketplace-qualified plugin id ({@code jdtls-lsp@claude-plugins-official}) and each value a
   * boolean ({@code true} = enabled, {@code false} = installed-but-disabled). An id absent from the
   * object is not installed and produces no entry. Any missing object / malformed JSON reads as an
   * empty list — the file's exact schema is undocumented, so tolerate shape drift rather than 500.
   * Static + package-visible so it can be unit-tested without a container.
   */
  static List<InstalledPluginDto> parseEnabledPlugins(String json) {
    if (json == null || json.isBlank()) {
      return List.of();
    }
    try {
      JsonNode root = MAPPER.readTree(json);
      JsonNode enabled = root.get("enabledPlugins");
      if (enabled == null || !enabled.isObject()) {
        return List.of();
      }
      List<InstalledPluginDto> result = new ArrayList<>();
      enabled
          .fields()
          .forEachRemaining(
              e -> result.add(new InstalledPluginDto(e.getKey(), e.getValue().asBoolean(false))));
      return result;
    } catch (Exception e) {
      return List.of();
    }
  }
}
