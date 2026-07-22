package eu.wohlben.qits.domain.setting.control;

import eu.wohlben.qits.domain.agent.control.AgentType;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.setting.entity.Setting;
import eu.wohlben.qits.domain.setting.persistence.SettingRepository;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.List;
import java.util.Optional;

/**
 * The generic, DB-backed settings store: one string value per dotted key, the runtime-editable
 * alternative to build-time config properties. Typed/enumerated settings validate on write here so
 * callers never parse strings ad hoc.
 *
 * <p>Reads run in their own transaction so they are safe off request threads — the harness resolver
 * is consulted from the autonomous/exit paths, not only from REST.
 */
@ApplicationScoped
public class SettingsService {

  /** The default coding-agent harness for the instance (the first setting). */
  public static final String AGENT_DEFAULT_TYPE = "agent.default-type";

  @Inject SettingRepository settingRepository;

  /** The raw value for a key, if set. Runs in its own transaction (safe off request threads). */
  public Optional<String> get(String key) {
    return QuarkusTransaction.requiringNew().call(() -> settingRepository.findValue(key));
  }

  /** The value for a key, or {@code fallback} when unset. */
  public String getOrDefault(String key, String fallback) {
    return get(key).orElse(fallback);
  }

  public List<Setting> list() {
    return QuarkusTransaction.requiringNew().call(settingRepository::listAll);
  }

  /**
   * Upsert a setting, validating known typed keys (an unknown enum value is a 400) and
   * canonicalizing their stored form. The agent harness is stored as its exact {@link AgentType}
   * name ({@code CLAUDE}/{@code KIMI}) regardless of input case, so consumers that compare the raw
   * value (e.g. the Settings select) match it without case handling.
   */
  @Transactional
  public Setting set(String key, String value) {
    if (key == null || key.isBlank()) {
      throw new BadRequestException("setting key is required");
    }
    String canonical = canonicalize(key, value);

    Setting setting =
        settingRepository
            .findByIdOptional(key)
            .orElseGet(
                () -> {
                  Setting created = Setting.builder().key(key).build();
                  settingRepository.persist(created);
                  return created;
                });
    setting.value = canonical;
    return setting;
  }

  private String canonicalize(String key, String value) {
    if (AGENT_DEFAULT_TYPE.equals(key)) {
      return AgentType.parse(value)
          .map(AgentType::name)
          .orElseThrow(() -> new BadRequestException("Unknown agent.default-type: " + value));
    }
    return value;
  }
}
