# Observability Setup

Procedures to wire metrics export, provision Grafana dashboards and alert rules,
add a metric, verify judge recovery monitoring and rotate tokens. SLO targets and
the alert catalog are in [Reliability](../operations/RELIABILITY.md#service-level-objectives);
env var reference is in the [Deployment Guide](../operations/DEPLOYMENT.md).

Metrics only (OPS-14): traces are not exported (`spanProcessors: []`) and logs
stay in the container log pipeline.

## Key code

- `apps/web/src/lib/server/otel.ts`, `apps/worker/src/otel.ts` — SDK boot; imported first in `apps/web/src/hooks.server.ts` and `apps/worker/src/index.ts` so auto-instrumentation patches `pg`/`ioredis` before use
- `apps/web/src/lib/server/metrics.ts` — web metrics
- `apps/worker/src/activities/utils.ts`, `apps/worker/src/activities/durable-work-metrics.ts`, `apps/worker/src/sandbox/shared/judge-phase-metrics.ts`, `apps/worker/src/judge-recovery-metrics.ts` — worker metrics
- `infra/grafana/dashboards/*.json`, `infra/grafana/alerts/slo-alerts.json`, `infra/grafana/provision.ts`
- `infra/charts/nojv/templates/{otel-collector,prometheus,grafana,node-exporter}.yaml`, `infra/charts/nojv/files/grafana-dashboards/` (chart copy of the dashboards)

## How export works

- Both apps start an OpenTelemetry NodeSDK when `OTEL_EXPORTER_OTLP_ENDPOINT` is a valid URL, exporting to `<endpoint>/v1/metrics` every 30s. Unset, empty or invalid means no-op (production logs a warning).
- `OTEL_EXPORTER_OTLP_HEADERS` is optional comma-separated `key=value`; Grafana Cloud needs `Authorization=Basic <base64(instanceId:token)>`.
- Auto-instrumentation covers `http`, `pg`, `ioredis` and `undici`; `fs` and `dns` are disabled.
- Service names: `OTEL_SERVICE_NAME_WEB` (default `nojv-web`), `OTEL_SERVICE_NAME_WORKER` (default `nojv-worker`).
- The worker awaits `shutdownOtel()` during graceful shutdown; web has no explicit flush and can lose the last interval.

## Metrics

| Metric                                                                                                        | Type      | Labels                                  | Source                       |
| ------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------- | ---------------------------- |
| `api_request_duration_seconds`                                                                                | histogram | `route`, `method`, `status_class`       | web hook boundary            |
| `health_probe_duration_seconds`                                                                               | histogram | `probe` (`live`, `ready`), `result`     | web probes only              |
| `sse_connection_duration_seconds`                                                                             | histogram | `close_reason`                          | web SSE                      |
| `sse_connection_dropped_total`                                                                                | counter   | —                                       | web SSE, server-fault close  |
| `judge_latency_seconds`                                                                                       | histogram | `mode`, `verdict`                       | worker verdict commit        |
| `judge_phase_duration_seconds`, `judge_cpu_seconds`, `judge_cpu_throttled_seconds`, `judge_memory_peak_bytes` | histogram | phase/mode/language/result              | worker sandbox               |
| `judge_cleanup_pending_total`                                                                                 | counter   | phase/mode/language/result              | worker sandbox               |
| `judge_wall_clock_timeouts_total`                                                                             | counter   | `language`                              | worker sandbox               |
| `durable_work_outcomes_total`                                                                                 | counter   | `kind`, `outcome`, `delivery_semantics` | platform worker              |
| `nojv_judge_*`, `nojv_submissions_stuck`                                                                      | gauge     | —                                       | platform worker SQL snapshot |

## Dashboards

| UID                    | Title                           | Reads                                                                                                                 |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `nojv-judge-latency`   | NOJV — Judge Latency            | `judge_latency_seconds` (p95/p99 by mode, throughput by verdict)                                                      |
| `nojv-api-latency`     | NOJV — API Latency              | `api_request_duration_seconds` (p50/p95/p99, top routes, 5xx share)                                                   |
| `nojv-exam-proctoring` | NOJV — Exam Proctoring          | SSE close rate, close reasons, server-fault drops                                                                     |
| `nojv-time-breakdown`  | NOJV — Where Is The Time Going? | API vs `http_server_duration_milliseconds`; `db_client_operation_duration_seconds` by `db_system` (postgresql, redis) |

The JSON files are the source of truth for panel PromQL. Auto-instrumentation metric names can change across OTel SDK versions; if a time-breakdown panel goes blank after an upgrade, run one process with `OTEL_LOG_LEVEL=DEBUG`, find the emitted name and update the panel.

## Grafana Cloud setup

Grafana Cloud holds dashboards only; alerts are evaluated in-cluster. Production pushes the in-cluster Prometheus to it with `remote_write` (about 3.2k active series against the free tier's 10k).

1. Stack: `https://grafana.nojv.tw`, owned by the `nojv.tw@gmail.com` Grafana account (region `prod-ap-northeast-0`, stack ID `1845138`). The custom domain is a DNS-only (unproxied) Cloudflare CNAME `grafana` → `brightholly2440.grafana.net`, the stack's fixed Grafana Cloud name; Grafana Cloud issues its Let's Encrypt certificate, so the record must stay unproxied.
2. Provisioning token: Administration → Users and access → Service accounts → `nojv-provision` with **Admin** role (Editor lacks `dashboards:create`, `dashboards:write`, `folders:create`) → add a token and copy the `glsa_*` value.
3. Push token: Cloud Portal → Access policies → `nojv-prometheus-remote-write` with only `metrics:write`, realm limited to the stack → create a token and copy the `glc_*` value. The stack's Prometheus details give the push URL (`https://prometheus-prod-49-prod-ap-northeast-0.grafana.net/api/prom/push`) and username (instance ID `3614500`).
4. Production: `observability.prometheus.remoteWrite.url` and `.username` live in the private `nojv-production-values` Secret, the `glc_*` token in `nojv-runtime-secrets` as `GRAFANA_CLOUD_PROM_PASSWORD`. Changing either values Secret makes Flux upgrade the release, which rolls web and workers.
5. Add to the git-ignored root `.env` for provisioning:

   ```env
   GRAFANA_STACK_URL=https://grafana.nojv.tw
   GRAFANA_SA_TOKEN=glsa_...
   ```

6. Verify: `prometheus_remote_storage_samples_total` rises and `prometheus_remote_storage_samples_failed_total` stays 0 on the Prometheus `/metrics`, and the stack's `grafanacloud-prom` datasource answers `count(node_filesystem_avail_bytes)`.

## In-cluster stack (no external cloud)

`values-single-machine.yaml` enables the collector, Prometheus, node-exporter and Grafana; the GKE overlay leaves them off (use Google Cloud Managed Service for Prometheus there).

| Component     | Value                                           | Endpoint / behavior                                                                                                                                                                                                                                                   |
| ------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collector     | `observability.collector.enabled`               | OTLP HTTP `http://<release>-otel-collector.<ns>.svc:4318`; `:8889/metrics`, or remote-writes when `collector.remoteWriteUrl` is set                                                                                                                                   |
| Prometheus    | `observability.prometheus.enabled`              | Scrapes every 30s: `otel-collector`, `node-exporter`, `cloudflared`, `cnpg-postgres` (`<release>-pg-metrics:9187`); PVC, 15d retention                                                                                                                                |
| Remote write  | `observability.prometheus.remoteWrite.url`      | Optional push to Grafana Cloud; `username` = instance ID, password from runtime secret key `GRAFANA_CLOUD_PROM_PASSWORD`                                                                                                                                              |
| Node exporter | `observability.prometheus.nodeExporter.enabled` | DaemonSet feeding `nojv-node-disk-usage`                                                                                                                                                                                                                              |
| Grafana       | `observability.grafana.enabled`                 | ClusterIP Service `:3000` (reach it with `kubectl -n nojv port-forward svc/nojv-grafana 3000`) or `observability.grafana.ingress`; provisioned Prometheus datasource (`uid: prometheus`) and chart dashboards                                                         |
| Alerting      | `observability.grafana.alerting.enabled`        | Evaluates the chart copy of `slo-alerts.json` in this Grafana every minute and emails the runtime secret's `SMTP_USER` through `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` and `mailer.smtpPort`; `nojv-pg-backup-stale` is rendered only when `postgres.cnpg.backup.enabled` |

1. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://nojv-otel-collector.nojv.svc:4318` (no headers) in `nojv-runtime-secrets` and restart web and workers.
2. Set the Grafana admin password: `observability.grafana.adminPassword`, or leave it empty and set `GRAFANA_ADMIN_PASSWORD` in the runtime secret.
3. Keep `observability.grafana.alerting.enabled` on (single-machine default). Grafana Cloud sees these series only through `observability.prometheus.remoteWrite`, and a free stack hibernates when idle, so it holds dashboards but is not an alerting home.

## Provision dashboards and alerts

In-cluster alerting needs no provisioning step: the rules ship with the chart. `pnpm grafana:provision` is for an optional Grafana Cloud stack. It loads `.env` itself and:

1. POSTs each `infra/grafana/dashboards/*.json` to `/api/dashboards/db` with `overwrite: true` (idempotent by UID; URL `https://grafana.nojv.tw/d/<uid>`).
2. Upserts every rule in `slo-alerts.json` (PUT, then POST if missing) when both `GRAFANA_ALERT_FOLDER_UID` and `GRAFANA_PROM_DATASOURCE_UID` are set; otherwise prints `[skip] alert rules`.
3. Provisions the `NOJV SLO Alerts` email contact point and a notification policy routing `team=nojv` when `GRAFANA_ALERT_EMAIL` is set; otherwise prints `[skip] contact point`. The policy replaces the stack's root policy, so on a shared stack leave it unset and add a child route in the UI.

Provisioning only upserts. After removing a dashboard or rule from the JSON files, delete it in Grafana Cloud by UID (`DELETE /api/dashboards/uid/<uid>`, `DELETE /api/v1/provisioning/alert-rules/<uid>`).

Verify:

```bash
curl -s -H "Authorization: Bearer $GRAFANA_SA_TOKEN" \
  "$GRAFANA_STACK_URL/api/dashboards/uid/nojv-judge-latency" | jq .dashboard.title
```

Then send a test notification through the contact point.

## Judge recovery monitoring

The platform worker (or `WORKER_MODE=all`) reads these gauges from PostgreSQL on each 30s collection with a 3s statement timeout, independent of judge workers and Temporal:

| Metric                                               | Meaning                                                                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nojv_judge_queue_depth`                             | Executions in `queued`, `waiting_capacity` or `recovering`                                                                                                                       |
| `nojv_judge_queue_oldest_seconds`                    | Age of the oldest of those                                                                                                                                                       |
| `nojv_judge_executions_blocked`                      | Executions in `blocked`                                                                                                                                                          |
| `nojv_submissions_stuck`                             | Due `queued`/`waiting_capacity`/`recovering`/`finalizing` executions with progress older than 10 minutes, plus `running` ones with stale progress and an expired or absent lease |
| `nojv_judge_legacy_system_errors`                    | SE submissions with no `JudgeExecution`                                                                                                                                          |
| `nojv_judge_recovery_last_success_timestamp_seconds` | Database time of the last valid snapshot                                                                                                                                         |

Aggregate with `max`, not `sum`: every platform replica reports the same totals. Labels never carry IDs or error text. A failed or invalid snapshot publishes nothing.

Verify before accepting a release:

1. All six gauges are present in the alert datasource.
2. In an isolated environment, pause judge consumption and confirm queue metrics rise while the last-success timestamp stays fresh.
3. Break the observer (stop the platform worker or its database access) and confirm `nojv-judge-recovery-observer-stale` fires within about 3 minutes.
4. Restore service; confirm the queue drains and alerts resolve.
5. Confirm a test notification reaches the on-call route.

## Add a metric

1. Put it next to the closest existing metric (see Key code). Histogram for distributions (bucket boundaries belong to the metric); counter named `*_total` for event counts.
2. Keep each metric under about 1k series: labels multiply (× histogram buckets).
3. Never label with user, actor, student, submission, exam, contest, assessment or problem IDs, IP addresses, request/session IDs, raw paths or any user-controlled text. Use fixed enums (as `close_reason` and `probe` do); per-entity detail belongs in logs.
4. Add dashboard panels and alert rules to the JSON files and update the chart copies under `infra/charts/nojv/files/grafana-dashboards/` and `infra/charts/nojv/files/grafana-alerts/` (a unit test keeps the alert copy identical); run `pnpm grafana:provision` only for a Grafana Cloud stack.
5. If it backs an SLO, update the table in [Reliability](../operations/RELIABILITY.md#service-level-objectives).

## Rotate tokens

Annually, and immediately on suspected exposure.

1. Service account: add a new token on `nojv-provision`, update `GRAFANA_SA_TOKEN` wherever provisioning runs, run `pnpm grafana:provision`, revoke the old token.
2. OTLP push: Cloud Portal → Access policies → `nojv-otlp-push` → new token; update `OTEL_EXPORTER_OTLP_HEADERS` in `nojv-runtime-secrets`; `kubectl -n nojv rollout restart deploy/nojv-web deploy/nojv-worker deploy/nojv-worker-platform`; revoke the old token.

## Disable export

Remove `OTEL_EXPORTER_OTLP_ENDPOINT` from the environment (or runtime secret) and restart. There is no other switch.
