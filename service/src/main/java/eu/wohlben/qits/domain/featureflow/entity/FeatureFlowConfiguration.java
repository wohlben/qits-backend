package eu.wohlben.qits.domain.featureflow.entity;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import org.hibernate.annotations.SQLRestriction;

import java.util.List;

@Entity
public class FeatureFlowConfiguration extends PanacheEntityBase {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    public String id;

    @Column(nullable = false)
    public String name;

    @OneToMany(mappedBy = "featureFlowConfiguration", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("orderIndex")
    @SQLRestriction("parent_phase_id is null")
    public List<FeatureFlowPhase> phases;
}
