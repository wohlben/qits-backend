package eu.wohlben.qits.domain.setting.persistence;

import eu.wohlben.qits.domain.setting.entity.Setting;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Optional;

@ApplicationScoped
public class SettingRepository implements PanacheRepositoryBase<Setting, String> {

  /** The raw value for a key, if the row exists (PK lookup — {@code key} is the {@code @Id}). */
  public Optional<String> findValue(String key) {
    return findByIdOptional(key).map(setting -> setting.value);
  }
}
