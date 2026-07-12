package eu.wohlben.qits.domain.repository.dto;

import java.util.List;

/**
 * Everything the workspace file browser needs to understand a workspace's structure, computed once
 * server-side over the live working tree and served from {@code GET .../{workspaceId}/detection}:
 * the detected projects, per-framework resolved membership sets (the filter input), and the
 * precomputed source↔test link graph. Keeps {@code /files} a pure filesystem transport.
 *
 * @param projects one entry per detected project root (the ownership list)
 * @param frameworks the same roots with their resolved member path sets (the whitelist input)
 * @param links source→test graph, precomputed over the full path set
 * @param generation the structural generation token (a hash of the sorted {@code ls-files}); the
 *     client applies this detection only while it matches the {@code /files} response's generation,
 *     so tree and detection never render as a skewed combination
 */
public record DetectionDto(
    List<DetectedProjectDto> projects,
    List<FrameworkMembershipDto> frameworks,
    List<FileLinkDto> links,
    String generation) {}
