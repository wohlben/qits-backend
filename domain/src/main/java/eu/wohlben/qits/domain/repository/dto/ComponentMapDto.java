package eu.wohlben.qits.domain.repository.dto;

import java.util.List;

/**
 * The component map of a workspace's working tree: every UI component the scanner could attribute
 * DOM elements to, with its source files. Framework-generic envelope from day one so future
 * scanners (React, Vue) extend rather than break the contract.
 *
 * @param framework the framework the scan targeted (currently always {@code "angular"})
 * @param components the components found; empty when the tree contains none (e.g. a non-Angular
 *     repository)
 */
public record ComponentMapDto(String framework, List<ComponentMapEntryDto> components) {}
