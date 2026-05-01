package eu.wohlben.qits.domain.featureflow.persistence;

import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowConfiguration;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.Optional;

@ApplicationScoped
public class FeatureFlowConfigurationRepository implements PanacheRepositoryBase<FeatureFlowConfiguration, String> {

    public Optional<FeatureFlowConfiguration> findByName(String name) {
        return find("name", name).firstResultOptional();
    }
}
