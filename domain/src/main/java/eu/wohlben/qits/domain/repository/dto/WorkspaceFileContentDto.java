package eu.wohlben.qits.domain.repository.dto;

/**
 * The contents of a single file in a workspace's working tree, for the file browser.
 *
 * @param path the file path relative to the workspace root
 * @param content the file's UTF-8 text, or {@code null} when {@code binary} is {@code true}
 * @param binary {@code true} when the file is not decodable text (contains NUL bytes) or exceeds
 *     the viewer size limit, in which case {@code content} is {@code null} and the UI shows a
 *     placeholder
 */
public record WorkspaceFileContentDto(String path, String content, boolean binary) {}
