package eu.wohlben.qits.domain.featureflow.entity;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;

@Entity
public class ActionConfiguration extends PanacheEntityBase {

    @Id
    public String id;

    @Column(nullable = false)
    public String name;

    public String description;

    @Column(name = "execute_script", nullable = false, length = 4000)
    public String executeScript;

    @Column(name = "check_script", nullable = false, length = 4000)
    public String checkScript;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    public Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt;
}
