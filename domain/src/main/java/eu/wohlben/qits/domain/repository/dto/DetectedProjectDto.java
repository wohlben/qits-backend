package eu.wohlben.qits.domain.repository.dto;

/**
 * One detected project root. {@code frameworkId} is an <strong>open string id</strong> ({@code
 * "java-quarkus"}, {@code "ts-angular"}, {@code "docs"}, …), never a closed enum, so adding a
 * framework needs no client regen and an older client degrades to a generic icon rather than
 * failing to deserialize.
 *
 * @param root dir relative to the workspace root ({@code ""} = workspace root)
 * @param frameworkId the framework kind's stable id
 * @param label presentation label, already pom-refined server-side ("Java / Quarkus")
 */
public record DetectedProjectDto(String root, String frameworkId, String label) {}
