package eu.wohlben.qits.domain.daemon.dto;

/**
 * A daemon's web-view configuration: which container port the proxy frames, the route the frame
 * opens at, and the optional extra base sub-path included in the served base. Presence on {@code
 * RepositoryDaemonDto} means the daemon is web-viewable ({@code port} is then always set).
 */
public record WebViewDto(Integer port, String entryPath, String basePath) {}
