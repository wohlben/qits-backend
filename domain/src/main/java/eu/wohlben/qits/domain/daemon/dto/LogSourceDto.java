package eu.wohlben.qits.domain.daemon.dto;

/** One FILE log source of a daemon definition, as returned to clients. */
public record LogSourceDto(String path, String label) {}
