package eu.wohlben.qits.domain.daemon.entity;

import eu.wohlben.qits.domain.repository.entity.Repository;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.MapKeyColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A daemon definition owned by (and only available in) one repository; cascade-deleted with it (see
 * {@code Repository#daemons}).
 */
@Entity
@Table(name = "repository_daemon")
public class RepositoryDaemon extends AbstractDaemonDefinition {

  @ManyToOne(optional = false)
  @JoinColumn(name = "repository_id", nullable = false)
  public Repository repository;

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(
      name = "repository_daemon_env",
      joinColumns = @JoinColumn(name = "repository_daemon_id"))
  @MapKeyColumn(name = "env_key")
  @Column(name = "env_value", length = 2000)
  public Map<String, String> environment = new HashMap<>();

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(
      name = "repository_daemon_observer",
      joinColumns = @JoinColumn(name = "repository_daemon_id"))
  @OrderColumn(name = "observer_index")
  public List<LogObserver> observers = new ArrayList<>();
}
