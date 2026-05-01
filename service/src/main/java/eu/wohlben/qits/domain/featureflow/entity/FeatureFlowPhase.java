package eu.wohlben.qits.domain.featureflow.entity;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;

import java.util.List;

@Entity
@Table(name = "feature_flow_phase")
public class FeatureFlowPhase extends PanacheEntityBase {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    public String id;

    @Column(nullable = false)
    public String name;

    @Column(length = 2000)
    public String description;

    @Column(name = "order_index", nullable = false)
    public int orderIndex;

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    @JoinColumn(name = "feature_flow_configuration_id")
    public FeatureFlowConfiguration featureFlowConfiguration;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_phase_id")
    public FeatureFlowPhase parentPhase;

    @OneToMany(mappedBy = "parentPhase", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("orderIndex")
    public List<FeatureFlowPhase> subPhases;

    @OneToMany(mappedBy = "phase", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sortOrder")
    public List<FeatureFlowPhaseStep> steps;
}
