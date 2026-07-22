package eu.wohlben.qits.domain.setting.entity;

import io.quarkus.hibernate.orm.panache.PanacheEntityBase;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.NoArgsConstructor;

/**
 * One qits-wide configuration value: a dotted-namespace key (e.g. {@code agent.default-type}) and
 * an opaque string value. One row per setting — the generic, DB-backed alternative to a build-time
 * config property, so an operator can change instance behaviour at runtime.
 *
 * <p>Keys are dotted namespaces so unrelated settings never collide and a future UI can group them.
 * The value is a plain string; typed/enumerated settings validate on write in {@code
 * SettingsService}.
 */
@Entity
@Table(name = "setting")
@Builder
@NoArgsConstructor // Hibernate needs a no-arg constructor; @AllArgsConstructor backs the builder.
@AllArgsConstructor
public class Setting extends PanacheEntityBase {

  /** The dotted setting key (PK). Mapped to {@code setting_key} — {@code key} is SQL-reserved. */
  @Id
  @Column(name = "setting_key")
  public String key;

  @Lob
  @Column(name = "setting_value")
  public String value;
}
