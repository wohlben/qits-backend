-- Remove the service log-observation subsystem: the per-daemon log observers and FILE log sources.
-- readyPattern, health checks, and the crash-excerpt tail remain (unrelated). The daemon_configuration_*
-- variants of these element-collection tables were already dropped in V19; only the repository_daemon_*
-- ones survive here.

drop table if exists repository_daemon_observer cascade;
drop table if exists repository_daemon_source cascade;
