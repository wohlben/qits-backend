package eu.wohlben.qits.domain.featureflow.entity;

import eu.wohlben.qits.domain.project.entity.Project;
import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import java.util.List;
import org.hibernate.annotations.SQLRestriction;

@Entity
public class FeatureFlowConfiguration extends PanacheEntityBase {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  public String id;

  @Column(nullable = false)
  public String name;

  @ManyToOne
  @JoinColumn(name = "project_id", nullable = false)
  public Project project;

  @OneToMany(mappedBy = "featureFlowConfiguration", cascade = CascadeType.ALL, orphanRemoval = true)
  @OrderBy("orderIndex")
  @SQLRestriction("parent_phase_id is null")
  public List<FeatureFlowPhase> phases;
}
