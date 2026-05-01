package eu.wohlben.qits.domain.action.persistence;

import eu.wohlben.qits.domain.action.entity.ActionConfiguration;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.Optional;

@ApplicationScoped
public class ActionConfigurationRepository implements PanacheRepositoryBase<ActionConfiguration, String> {

    public Optional<ActionConfiguration> findByName(String name) {
        return find("name", name).firstResultOptional();
    }
}
