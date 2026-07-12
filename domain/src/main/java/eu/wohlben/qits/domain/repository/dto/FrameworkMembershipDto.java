package eu.wohlben.qits.domain.repository.dto;

import java.util.List;

/**
 * A detected framework's resolved member path set — the "membership metadata" the client turns into
 * a {@code restrict} whitelist. All detected frameworks' memberships ship in the one detection
 * call, so toggling any subset afterwards is pure client-side work with no re-fetch. The resolved
 * set is a snapshot of the tree at fetch time (globs weren't); it refreshes with the tree.
 *
 * @param frameworkId the framework kind's stable id (open string)
 * @param root dir relative to the workspace root ({@code ""} = workspace root)
 * @param label presentation label, already pom-refined server-side
 * @param memberPaths every current path this framework owns
 */
public record FrameworkMembershipDto(
    String frameworkId, String root, String label, List<String> memberPaths) {}
