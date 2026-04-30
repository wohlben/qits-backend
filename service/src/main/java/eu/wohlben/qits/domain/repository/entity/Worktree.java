package eu.wohlben.qits.domain.repository.entity;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

@Entity
@Table(
    name = "worktree",
    uniqueConstraints = @UniqueConstraint(columnNames = {"repository_id", "worktree_id"})
)
public class Worktree extends PanacheEntityBase {

    @Id
    @GeneratedValue
    public Long id;

    @Column(name = "worktree_id", nullable = false)
    public String worktreeId;

    @ManyToOne(optional = false)
    @JoinColumn(name = "repository_id", nullable = false)
    public Repository repository;

    @Column(name = "parent_id")
    public String parent;
}
