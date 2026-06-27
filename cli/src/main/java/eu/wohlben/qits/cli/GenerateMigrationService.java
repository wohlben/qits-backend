package eu.wohlben.qits.cli;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManagerFactory;
import jakarta.persistence.metamodel.ManagedType;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.flywaydb.core.Flyway;
import org.hibernate.boot.Metadata;
import org.hibernate.boot.MetadataSources;
import org.hibernate.boot.registry.StandardServiceRegistry;
import org.hibernate.boot.registry.StandardServiceRegistryBuilder;
import org.hibernate.tool.schema.TargetType;
import org.hibernate.tool.schema.internal.ExceptionHandlerLoggedImpl;
import org.hibernate.tool.schema.internal.exec.ScriptTargetOutputToFile;
import org.hibernate.tool.schema.spi.ContributableMatcher;
import org.hibernate.tool.schema.spi.ExceptionHandler;
import org.hibernate.tool.schema.spi.ExecutionOptions;
import org.hibernate.tool.schema.spi.SchemaManagementTool;
import org.hibernate.tool.schema.spi.SchemaMigrator;
import org.hibernate.tool.schema.spi.ScriptTargetOutput;
import org.hibernate.tool.schema.spi.TargetDescriptor;
import org.jboss.logging.Logger;

/**
 * Generates a starter Flyway migration: applies the committed migrations to a throwaway in-memory
 * H2, then asks Hibernate to diff the live entity model against it. The delta DDL is written to
 * {@code PENDING_MIGRATION.sql} for you to turn into a proper hand-written {@code V#__name.sql}.
 *
 * <p>This replaces the old {@code scripts/generate-flyway-migration.sh}, which booted dev mode and
 * drove the Flyway Dev UI over a websocket. The schema here is fully annotation-driven (no custom
 * naming strategy), so a standalone Hibernate metadata build reproduces it faithfully. Hibernate 7
 * dropped the old {@code SchemaUpdate} helper, so this drives the {@link SchemaMigrator} SPI.
 */
@ApplicationScoped
public class GenerateMigrationService {

  private static final Logger LOG = Logger.getLogger(GenerateMigrationService.class);
  private static final String OUTPUT_FILE = "PENDING_MIGRATION.sql";

  @Inject EntityManagerFactory emf;

  public void generate() throws Exception {
    Set<Class<?>> entityClasses =
        emf.getMetamodel().getEntities().stream()
            .map(ManagedType::getJavaType)
            .collect(Collectors.toSet());

    // Throwaway DB brought up to the committed migrations, so the diff is the *delta* the entities
    // need on top of them (not the whole schema).
    String url = "jdbc:h2:mem:migrationgen;DB_CLOSE_DELAY=-1";
    Flyway.configure()
        .dataSource(url, "sa", "")
        .locations("classpath:db/migration")
        .load()
        .migrate();

    Map<String, Object> settings = new HashMap<>();
    settings.put("hibernate.connection.url", url);
    settings.put("hibernate.connection.username", "sa");
    settings.put("hibernate.connection.password", "");
    settings.put("hibernate.dialect", "org.hibernate.dialect.H2Dialect");
    settings.put("hibernate.hbm2ddl.delimiter", ";");
    settings.put("hibernate.format_sql", "true");
    // Don't churn unique constraints: Hibernate can't match its auto-named UKs against the DB and
    // would otherwise emit a spurious drop+recreate for each on every run.
    settings.put("hibernate.schema_update.unique_constraint_strategy", "SKIP");

    Path scriptOut = Files.createTempFile("qits-migration", ".sql");
    StandardServiceRegistry registry =
        new StandardServiceRegistryBuilder().applySettings(settings).build();
    try {
      MetadataSources sources = new MetadataSources(registry);
      entityClasses.forEach(sources::addAnnotatedClass);
      Metadata metadata = sources.buildMetadata();

      SchemaManagementTool tool = registry.getService(SchemaManagementTool.class);
      SchemaMigrator migrator = tool.getSchemaMigrator(settings);

      ExecutionOptions execOptions =
          new ExecutionOptions() {
            @Override
            public Map<String, Object> getConfigurationValues() {
              return settings;
            }

            @Override
            public boolean shouldManageNamespaces() {
              return true;
            }

            @Override
            public ExceptionHandler getExceptionHandler() {
              return ExceptionHandlerLoggedImpl.INSTANCE;
            }
          };

      TargetDescriptor target =
          new TargetDescriptor() {
            @Override
            public EnumSet<TargetType> getTargetTypes() {
              return EnumSet.of(TargetType.SCRIPT);
            }

            @Override
            public ScriptTargetOutput getScriptTargetOutput() {
              return new ScriptTargetOutputToFile(new File(scriptOut.toString()), "UTF-8");
            }
          };

      // SCRIPT only: write the delta DDL, don't touch the (throwaway) DB.
      migrator.doMigration(metadata, execOptions, ContributableMatcher.ALL, target);
    } finally {
      StandardServiceRegistryBuilder.destroy(registry);
    }

    String ddl = Files.readString(scriptOut).strip();
    Files.deleteIfExists(scriptOut);

    if (ddl.isBlank()) {
      LOG.info("No schema changes — the entity model matches the committed migrations.");
      System.out.println("No schema changes detected. Nothing to write.");
      return;
    }

    Path target = repoRoot().resolve(OUTPUT_FILE);
    Files.writeString(target, ddl + System.lineSeparator());
    LOG.infof("Wrote starter migration to %s", target);
    System.out.println();
    System.out.println("Wrote a starter migration to " + target);
    System.out.println("Review it, turn it into a hand-written db/migration/V#__name.sql, then");
    System.out.println("delete " + OUTPUT_FILE + ".");
  }

  /** Repo root = the dir containing the domain migrations, located relative to the working dir. */
  private Path repoRoot() {
    String[] candidates = {".", ".."};
    for (String c : candidates) {
      Path root = Path.of(c);
      if (Files.isDirectory(root.resolve("domain/src/main/resources/db/migration"))) {
        return root.toAbsolutePath().normalize();
      }
    }
    return Path.of("").toAbsolutePath();
  }
}
