package eu.wohlben.qits.domain.bootstrap.control;

import eu.wohlben.qits.domain.bootstrap.dto.BootstrapCommandDto;
import eu.wohlben.qits.domain.bootstrap.entity.BootstrapCommand;
import eu.wohlben.qits.domain.bootstrap.mapper.BootstrapCommandMapper;
import eu.wohlben.qits.domain.bootstrap.persistence.BootstrapCommandRepository;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.control.QitsConfig;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * CRUD over one repository's bootstrap chain — the only scope bootstrap commands have; every access
 * enforces ownership. Ordering is first-class: the chain runs strictly by {@code orderIndex}, so
 * the list is always returned in execution order and {@link #reorder} rewrites the whole sequence
 * atomically.
 */
@ApplicationScoped
public class BootstrapCommandService {

  @Inject BootstrapCommandRepository bootstrapCommandRepository;

  @Inject RepositoryRepository repositoryRepository;

  @Inject BootstrapCommandMapper bootstrapCommandMapper;

  @Transactional
  public BootstrapCommand create(
      String repositoryId,
      String name,
      String description,
      String executeScript,
      String checkScript,
      Map<String, String> environment,
      Integer orderIndex) {
    requireNotReservedName(name);
    int index = orderIndex != null ? orderIndex : nextOrderIndex(repositoryId);
    return upsertFromConfig(
        repositoryId, null, name, description, executeScript, checkScript, environment, index);
  }

  /**
   * Declarative upsert used by {@code .qits-config.yml} ingestion (and, with {@code existingId ==
   * null}, by {@link #create}): validates the definition and overwrites <strong>every</strong>
   * field so the row exactly matches the declaration — the file is the source of truth, including
   * {@code orderIndex} stamped from file position. Keeping the same {@code existingId} preserves
   * the command id, so recorded run outcomes survive a re-ingest.
   *
   * <p>Deliberately <strong>not</strong> {@code @Transactional}: it always runs inside a caller's
   * transaction ({@link #create} or the config reconciler), and if it threw as its own
   * transactional boundary a caught validation failure would still mark the reconciler's
   * transaction rollback-only — discarding the valid entries and the warning. As a plain method its
   * exception is an ordinary one the reconciler can catch per entry.
   */
  public BootstrapCommand upsertFromConfig(
      String repositoryId,
      String existingId,
      String name,
      String description,
      String executeScript,
      String checkScript,
      Map<String, String> environment,
      int orderIndex) {
    if (name == null || name.isBlank()) {
      throw new BadRequestException("name is required");
    }
    if (executeScript == null || executeScript.isBlank()) {
      throw new BadRequestException("executeScript is required");
    }

    BootstrapCommand command;
    if (existingId == null) {
      Repository repository =
          repositoryRepository
              .findByIdOptional(repositoryId)
              .orElseThrow(() -> new NotFoundException("Repository not found: " + repositoryId));
      command = new BootstrapCommand();
      command.repository = repository;
    } else {
      command = get(repositoryId, existingId);
    }
    command.name = name;
    command.description = description;
    command.executeScript = executeScript;
    command.checkScript = blankToNull(checkScript);
    command.orderIndex = orderIndex;
    command.environment = environment != null ? new HashMap<>(environment) : new HashMap<>();
    if (existingId == null) {
      bootstrapCommandRepository.persist(command);
    }

    return command;
  }

  /** The command, if it exists and belongs to {@code repositoryId}; 404 otherwise. */
  public BootstrapCommand get(String repositoryId, String commandId) {
    BootstrapCommand command =
        bootstrapCommandRepository
            .findByIdOptional(commandId)
            .orElseThrow(() -> new NotFoundException("BootstrapCommand not found: " + commandId));
    if (!command.repository.id.equals(repositoryId)) {
      throw new NotFoundException("BootstrapCommand not found: " + commandId);
    }
    return command;
  }

  /** The repository's chain in execution order. */
  public List<BootstrapCommand> list(String repositoryId) {
    return bootstrapCommandRepository.findByRepositoryIdOrdered(repositoryId);
  }

  /** The single command {@code commandId} of {@code repositoryId}, flattened for callers. */
  @Transactional
  public BootstrapCommandDto resolve(String repositoryId, String commandId) {
    return bootstrapCommandMapper.toDto(get(repositoryId, commandId));
  }

  /** The whole chain of {@code repositoryId} in execution order, flattened for the runner. */
  @Transactional
  public List<BootstrapCommandDto> resolveAll(String repositoryId) {
    return list(repositoryId).stream().map(bootstrapCommandMapper::toDto).toList();
  }

  @Transactional
  public BootstrapCommand update(
      String repositoryId,
      String commandId,
      String name,
      String description,
      String executeScript,
      String checkScript,
      Map<String, String> environment,
      Integer orderIndex) {
    BootstrapCommand command = get(repositoryId, commandId);

    if (name != null && !name.isBlank()) {
      requireNotReservedName(name);
      command.name = name;
    }
    if (description != null) {
      command.description = description;
    }
    if (executeScript != null && !executeScript.isBlank()) {
      command.executeScript = executeScript;
    }
    if (checkScript != null) {
      // A blank checkScript clears the guard (the ActionConfiguration convention).
      command.checkScript = blankToNull(checkScript);
    }
    if (environment != null) {
      command.environment = new HashMap<>(environment);
    }
    if (orderIndex != null) {
      command.orderIndex = orderIndex;
    }

    return command;
  }

  @Transactional
  public void delete(String repositoryId, String commandId) {
    bootstrapCommandRepository.delete(get(repositoryId, commandId));
  }

  /**
   * Rewrites the whole chain's ordering in one shot: {@code ids} must be exactly the repository's
   * command id set, in the desired execution order; each row's {@code orderIndex} becomes its list
   * position. Atomic by design — a partial reorder would leave two commands claiming one slot.
   */
  @Transactional
  public List<BootstrapCommand> reorder(String repositoryId, List<String> ids) {
    List<BootstrapCommand> existing = list(repositoryId);
    Set<String> existingIds = new HashSet<>(existing.stream().map(c -> c.id).toList());
    if (ids == null
        || ids.size() != existingIds.size()
        || !existingIds.equals(new HashSet<>(ids))) {
      throw new BadRequestException(
          "ids must contain exactly the repository's bootstrap command ids");
    }
    Map<String, BootstrapCommand> byId = new HashMap<>();
    existing.forEach(c -> byId.put(c.id, c));
    for (int i = 0; i < ids.size(); i++) {
      byId.get(ids.get(i)).orderIndex = i;
    }
    return list(repositoryId);
  }

  private int nextOrderIndex(String repositoryId) {
    List<BootstrapCommand> existing = list(repositoryId);
    return existing.isEmpty() ? 0 : existing.getLast().orderIndex + 1;
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value;
  }

  /**
   * Rejects a user-supplied name that lands in the {@code .qits-config.yml} namespace. That suffix
   * is reserved for config-declared commands (written only by {@link #upsertFromConfig}); letting a
   * user create one would make their hand-made command look config-managed and get deleted on the
   * next reconcile.
   */
  private static void requireNotReservedName(String name) {
    if (QitsConfig.isConfigName(name)) {
      throw new BadRequestException(
          "name may not use the reserved '"
              + QitsConfig.CONFIG_NAME_SUFFIX
              + "' suffix (it is managed by .qits-config.yml)");
    }
  }
}
