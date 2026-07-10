package eu.wohlben.qits.domain.agent.control;

import eu.wohlben.qits.domain.agent.dto.AgentSessionNodeDto;
import eu.wohlben.qits.domain.agent.dto.AgentSubagentDto;
import eu.wohlben.qits.domain.agent.entity.AgentSessionStat;
import eu.wohlben.qits.domain.agent.persistence.AgentSessionStatRepository;
import eu.wohlben.qits.domain.command.entity.AgentSessionRef;
import eu.wohlben.qits.domain.command.entity.Command;
import eu.wohlben.qits.domain.command.persistence.CommandRepository;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.persistence.WorkspaceRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Assembles a workspace's agent sessions into the tree the session-history UI renders: one node per
 * session (commands that resumed a session collapse onto it), fork edges nesting children under
 * their {@code forkedFromSessionId}, and the sweep-aggregated stats ({@code agent_session_stat})
 * attached as message counts and subagent rows.
 */
@ApplicationScoped
public class AgentSessionQueryService {

  @Inject WorkspaceRepository workspaceRepository;

  @Inject CommandRepository commandRepository;

  @Inject AgentSessionStatRepository statRepository;

  /** The workspace's session tree — roots newest-first, fork children chronological. */
  @Transactional
  public List<AgentSessionNodeDto> sessionTree(String repoId, String workspaceId) {
    if (!workspaceRepository.existsActiveByRepositoryAndWorkspaceId(repoId, workspaceId)) {
      throw new NotFoundException("Workspace not found: " + workspaceId);
    }

    // Newest command first, so the first command seen per session is its navigation target.
    List<Command> commands = commandRepository.findByRepositoryAndWorkspace(repoId, workspaceId);
    Map<String, Node> nodes = new LinkedHashMap<>();
    for (Command command : commands) {
      for (AgentSessionRef ref : command.agentSessions) {
        Node node = nodes.computeIfAbsent(ref.sessionId, Node::new);
        if (node.newestCommandId == null) {
          node.newestCommandId = command.id;
        }
        if (node.firstRecordedAt == null || ref.recordedAt.isBefore(node.firstRecordedAt)) {
          node.firstRecordedAt = ref.recordedAt;
        }
        if (node.forkedFromSessionId == null) {
          node.forkedFromSessionId = ref.forkedFromSessionId;
        }
      }
    }

    for (AgentSessionStat stat : statRepository.findBySessionIds(nodes.keySet())) {
      Node node = nodes.get(stat.sessionId);
      if (stat.agentId == null) {
        node.messageCount = stat.messageCount;
      } else {
        node.subagents.add(
            new AgentSubagentDto(
                stat.agentId,
                stat.agentType,
                stat.description,
                stat.messageCount,
                stat.firstTimestamp));
      }
    }

    // Fork edges nest children under their origin; an edge to a session this workspace never
    // drove (or none at all) makes the node a root.
    List<Node> roots = new ArrayList<>();
    for (Node node : nodes.values()) {
      Node parent = node.forkedFromSessionId == null ? null : nodes.get(node.forkedFromSessionId);
      if (parent != null && parent != node) {
        parent.children.add(node);
      } else {
        roots.add(node);
      }
    }
    roots.sort(Comparator.comparing((Node n) -> n.firstRecordedAt).reversed());
    return roots.stream().map(Node::toDto).toList();
  }

  private static class Node {
    private final String sessionId;
    private String newestCommandId;
    private Instant firstRecordedAt;
    private String forkedFromSessionId;
    private Integer messageCount;
    private final List<AgentSubagentDto> subagents = new ArrayList<>();
    private final List<Node> children = new ArrayList<>();

    private Node(String sessionId) {
      this.sessionId = sessionId;
    }

    private AgentSessionNodeDto toDto() {
      subagents.sort(
          Comparator.comparing(
                  AgentSubagentDto::firstTimestamp, Comparator.nullsLast(Comparator.naturalOrder()))
              .thenComparing(AgentSubagentDto::agentId));
      children.sort(Comparator.comparing(n -> n.firstRecordedAt));
      return new AgentSessionNodeDto(
          sessionId,
          firstRecordedAt,
          forkedFromSessionId,
          messageCount,
          newestCommandId,
          List.copyOf(subagents),
          children.stream().map(Node::toDto).toList());
    }
  }
}
