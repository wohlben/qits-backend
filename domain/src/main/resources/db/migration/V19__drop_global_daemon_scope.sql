-- Daemons are repository-scoped only: a daemon is a long-running, non-interactive action defined
-- on the repository it serves (e.g. its dev server). The global daemon_configuration scope was a
-- mistaken specification and is dropped wholesale; repository_daemon* stays the only definition
-- storage. Existing global rows (the seeded demo daemon) are intentionally discarded — the demo
-- daemon is re-seeded per repository by the cli seed command.
drop table daemon_configuration_source;
drop table daemon_configuration_observer;
drop table daemon_configuration_env;
drop table daemon_configuration;
