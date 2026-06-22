package eu.wohlben.qits.domain.featureflow.entity;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

@Entity
@Table(
    name = "feature_flow_phase_action",
    uniqueConstraints = @UniqueConstraint(columnNames = {"step_id", "action_configuration_id"}))
public class FeatureFlowPhaseAction extends PanacheEntityBase {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  public String id;

  @ManyToOne(optional = false, fetch = FetchType.LAZY)
  @JoinColumn(name = "step_id")
  public FeatureFlowPhaseStep step;

  @ManyToOne(optional = false, fetch = FetchType.LAZY)
  @JoinColumn(name = "action_configuration_id")
  public ActionConfiguration actionConfiguration;

  @Enumerated(EnumType.STRING)
  @Column(name = "action_type", nullable = false)
  public ActionType actionType;

  @Column(name = "sort_order", nullable = false)
  public int sortOrder;

  @Column(name = "parallel_group")
  public String parallelGroup;
}
