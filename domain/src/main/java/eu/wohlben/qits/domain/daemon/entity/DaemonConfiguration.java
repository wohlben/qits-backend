package eu.wohlben.qits.domain.daemon.entity;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapKeyColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** A globally available daemon definition — part of the shared library, usable in any worktree. */
@Entity
@Table(name = "daemon_configuration")
public class DaemonConfiguration extends AbstractDaemonDefinition {

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(
      name = "daemon_configuration_env",
      joinColumns = @JoinColumn(name = "daemon_configuration_id"))
  @MapKeyColumn(name = "env_key")
  @Column(name = "env_value", length = 2000)
  public Map<String, String> environment = new HashMap<>();

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(
      name = "daemon_configuration_observer",
      joinColumns = @JoinColumn(name = "daemon_configuration_id"))
  @OrderColumn(name = "observer_index")
  public List<LogObserver> observers = new ArrayList<>();

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(
      name = "daemon_configuration_source",
      joinColumns = @JoinColumn(name = "daemon_configuration_id"))
  @OrderColumn(name = "source_index")
  public List<LogSource> sources = new ArrayList<>();
}
