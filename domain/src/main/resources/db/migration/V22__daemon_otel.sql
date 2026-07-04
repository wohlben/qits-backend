-- Daemon definitions gain an OpenTelemetry toggle: when set, qits injects the
-- OTEL_EXPORTER_OTLP_* environment variables at launch so the daemon's process exports
-- telemetry to the in-process OTLP receiver (see docs/features/2026-07-04_observability.md).
alter table repository_daemon
    add column otel boolean not null default false;
