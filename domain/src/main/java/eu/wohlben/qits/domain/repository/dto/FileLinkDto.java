package eu.wohlben.qits.domain.repository.dto;

import java.util.List;

/**
 * One source file that has detected test(s), with its owning project and the test files it links
 * to. The client inverts this graph for the symmetric test→source lookup and keeps its own
 * group-normalization off the owning source.
 *
 * @param path a CODE file that has detected test(s)
 * @param projectRoot owning project root, or {@code null}
 * @param tests its detected test file(s) with their runner kinds
 */
public record FileLinkDto(String path, String projectRoot, List<TestLinkDto> tests) {}
