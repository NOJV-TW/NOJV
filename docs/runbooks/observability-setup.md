# Observability Setup Runbook

## Overview

NOJV ships **metrics-only** observability against Grafana Cloud. Application
processes (`apps/web`, `apps/worker`) bootstrap an OpenTelemetry SDK on
startup and push to Grafana Cloud Hosted Prometheus via OTLP HTTP. Five
dashboards live at <https://takalawang.grafana.net> covering judge latency,
API latency, scoreboard updates, exam proctoring, and a request-time
breakdown.

What this stack measures:

- Custom histogram + counter SLO metrics emitted from app code
- Auto-instrumented HTTP / Postgres / Redis / undici client durations

What it does **not** measure (deliberately, today):

- **Logs** — still go to GCP Cloud Logging via the existing pino pipeline,
  not to Grafana Loki.
- **Traces** — span processors are an empty list in the SDK config; no
  spans are exported. Future expansion only if a real debugging need shows
  up.

> Region: `prod-ap-northeast-0` (Grafana Cloud free tier). Free tier caps
> total active series at 10k. Cardinality budget is roughly: ~3,750 series
> for `api_request_duration_seconds` (≈150 routes × 5 methods × 5 status
> classes), ~18 for `judge_latency_seconds`, plus single-digit counts for
> the others — comfortably under cap.

## First-time setup

### Grafana Cloud account

Sign up at <https://grafana.com> using a work email. The free tier is
sufficient for production at current load. Once provisioned, your stack URL
follows the pattern `https://<orgname>.grafana.net` (we use
`https://takalawang.grafana.net`).

### Service account + token

The service account is used by `pnpm grafana:provision` to upload dashboard
JSON via the Grafana HTTP API.

1. **Stack admin → Administration → Users and access → Service accounts → Add service account.**
2. Set **Role = Admin**. Editor is _not_ enough — by default the Editor role
   has Viewer-scoped folder/dashboard permissions on this stack, and
   `pnpm grafana:provision` needs `dashboards:create`, `dashboards:write`,
   and `folders:create`. Admin guarantees those.
3. **Add service account token** → name it `nojv-provision`, no expiry (or
   set a 1-year reminder; see "Token rotation" below). Copy the
   `glsa_*` token once — Grafana never shows it again.

### Cloud Access Policy (OTLP push token)

The OTLP push token is _separate_ from the service-account token. It lives
under **Cloud Portal → Access policies**.

1. **Create access policy** → name `nojv-otlp-push`, scope `metrics:write`
   on your stack.
2. **Create token** under that policy → copy the `glc_*` token once.
3. Find the **instance ID** (numeric) and the OTLP gateway URL on the
   **Connections → OpenTelemetry → OTLP** page. Gateway URL for our region
   is `https://otlp-gateway-prod-ap-northeast-0.grafana.net/otlp`.

### Populate `.env`

Append the Grafana keys to your existing root-level `.env` (see
`.env.example` for the full set, including the optional alert-rule
provisioning vars):

```env
# OTLP push (consumed by apps/web + apps/worker on boot)
GRAFANA_OTLP_ENDPOINT=https://otlp-gateway-prod-ap-northeast-0.grafana.net/otlp
GRAFANA_OTLP_INSTANCE_ID=1234567
GRAFANA_OTLP_TOKEN=glc_...

# Dashboard provisioning (consumed by `pnpm grafana:provision` only)
GRAFANA_STACK_URL=https://takalawang.grafana.net
GRAFANA_SA_TOKEN=glsa_...
```

`.env` is git-ignored. Never check these in.

## Local development

```bash
pnpm dev
```

Both `apps/web` (Vite) and `apps/worker` (`node --env-file=.env`) load
`.env` automatically, so no manual sourcing is needed.

Both apps detect the three `GRAFANA_OTLP_*` vars on boot and start the
SDK. To verify the SDK is actually exporting:

```bash
OTEL_LOG_LEVEL=DEBUG pnpm dev
```

Look for `OTLPExportDelegate items to be sent` (success) or
`OTLPExporter ... failed` (config issue) in the logs. Successful exports
happen every 30s.

If any of the three OTLP push vars are unset or empty, the SDK
**no-ops** — zero metrics, zero startup cost, zero noise. CI and unit
tests run without these.

## Production deployment

### Web (in-cluster)

Inject the three required secrets through the chart's runtime secret (the same
`nojv-runtime-secrets` the web Deployment references):

- `GRAFANA_OTLP_ENDPOINT`
- `GRAFANA_OTLP_INSTANCE_ID`
- `GRAFANA_OTLP_TOKEN`

Optional: `OTEL_SERVICE_NAME_WEB` defaults to `nojv-web`.

The web SDK relies on the SvelteKit adapter-node lifecycle for shutdown.
There is **no explicit flush** — the last 0–30s of metrics may be lost if
the container is killed mid-interval. Accepted trade-off; rolling Pod
replacements are short-lived, so the sample loss is negligible over time.

### Worker (in-cluster)

Same three OTLP secrets from the runtime secret on the worker
Deployment. Optional: `OTEL_SERVICE_NAME_WORKER` defaults to `nojv-worker`.

Unlike the web, the worker **does** have an explicit shutdown hook.
`apps/worker/src/index.ts:gracefulShutdown` awaits `shutdownOtel()` after
`app.shutdown()` so the last metric interval is flushed before
`process.exit(0)`. SIGTERM from the K8s pod lifecycle triggers this path.

### Boot path

The OTel SDK starts **before any application code runs** via top-of-file
side-effect imports:

- `apps/web/src/hooks.server.ts:1` → `import "$lib/server/otel"`
- `apps/worker/src/index.ts:1` → `import "./otel.js"`

The worker boots OTel via the side-effect `import "./otel.js"` at the very
top of `apps/worker/src/index.ts` — before anything imports `pg` or
`ioredis`, so the auto-instrumentation hooks can monkey-patch those modules
first. In dev, `--import tsx` is the TypeScript loader (it transpiles the
`.ts` entry on the fly); the OTel ordering still comes from that top-of-file
import, not from a separate bootstrap file. There is no
`apps/worker/src/otel-bootstrap.ts`.

### Auto-instrumentation

`getNodeAutoInstrumentations()` from `@opentelemetry/auto-instrumentations-node`
is enabled with **fs and dns disabled** to keep noise down. The
instrumented modules currently producing metrics:

- `http` — server + client
- `pg` — Postgres queries (powers the `db_client_operation_duration_seconds`
  histogram on the time-breakdown dashboard)
- `ioredis` — Redis client commands
- `undici` — outbound HTTP via the Node global fetch

`spanProcessors: []` is set explicitly — auto-instrumentation would
otherwise emit traces too. Metrics-only is the design.

## Adding a new metric

### Histogram vs counter checklist

- **Histogram**: anything where you care about a distribution (latency,
  payload size, queue depth at sample time). Bucket boundaries belong to
  the metric, not the dashboard.
- **Counter**: monotonic event tally. `xxx_total` naming convention.
  Compute rates in PromQL via `rate()`.

Add new metrics in the closest existing file:

| Surface           | File                                  |
| ----------------- | ------------------------------------- |
| Web request flow  | `apps/web/src/lib/server/metrics.ts`  |
| Judge / worker    | `apps/worker/src/activities/utils.ts` |
| Redis-side timing | `packages/redis/src/metrics.ts`       |

### Cardinality budget

Free-tier ceiling is **10k active series** total across the stack. We sit
at roughly 4k today. Rough budget for adding a new label dimension: total
series for the metric = (cardinality of label A) × (cardinality of label
B) × ... × (number of histogram buckets if histogram). Stay under 1k for
any single metric to leave headroom.

### Forbidden label patterns

**Never use as labels**:

- `userId`, `actorId`, `studentId`
- `submissionId`, `examId`, `contestId`, `assessmentId`, `problemId`
- IP addresses, request IDs, session IDs, raw paths with IDs in them
- Anything user-controllable (free-text fields, query params)

These are cardinality bombs. Each unique value spawns a new series; a
busy day can produce tens of thousands of series in a single label and
push you past the cap. If you need per-entity drill-down, use logs (Cloud
Logging) or traces, not metrics.

Bucketed labels are fine — `close_reason` on
`sse_connection_duration_seconds_count` (a small, fixed set of reasons)
keeps cardinality low while preserving signal.

## Updating dashboards

Dashboard JSON lives at `infra/grafana/dashboards/`. To roll out edits:

```bash
pnpm grafana:provision
```

The script self-loads `.env` via `node --env-file=.env`, so it picks up
`GRAFANA_STACK_URL` and `GRAFANA_SA_TOKEN` without any extra sourcing.

The provisioning script POSTs each JSON to `/api/dashboards/db` with
`overwrite: true`, so reruns are idempotent — same UID gets updated in
place. UIDs are baked into each JSON (`nojv-judge-latency`,
`nojv-api-latency`, etc.) and form the URL path:
`https://takalawang.grafana.net/d/<uid>`.

To verify a dashboard exists at the expected UID:

```bash
curl -s -H "Authorization: Bearer $GRAFANA_SA_TOKEN" \
  "$GRAFANA_STACK_URL/api/dashboards/uid/nojv-judge-latency" | jq .dashboard.title
```

## Provisioning SLO alert rules

Alert-rule definitions live at `infra/grafana/alerts/slo-alerts.json` —
one compact entry per SLO (PromQL expression, threshold, `for` duration,
severity, summary). `pnpm grafana:provision` expands each into a Grafana
provisioned-alert-rule payload and upserts it by UID (PUT, falling back to
POST for a rule that does not exist yet).

Alert provisioning is **opt-in**: the script only touches alert rules when
both of these are set in `.env`:

```env
GRAFANA_ALERT_FOLDER_UID=<uid of the Grafana folder the rules live in>
GRAFANA_PROM_DATASOURCE_UID=<uid of the Hosted Prometheus datasource>
```

Find the datasource UID under **Connections → Data sources** in the
Grafana UI (or `GET /api/datasources`); create a folder for the rules and
read its UID from the folder URL. When either var is unset the script
prints `[skip] alert rules` and provisions dashboards only.

Five rules are provisioned — judge latency (simple + advanced), API p99,
scoreboard p95, and SSE drop rate. Thresholds mirror the SLO table in
`RELIABILITY.md`.

**Contact point + notification policy.** Set `GRAFANA_ALERT_EMAIL` in
`.env` and `pnpm grafana:provision` also provisions an email contact
point (`NOJV SLO Alerts`) plus a notification policy routing the
`team=nojv` SLO alerts to it. When `GRAFANA_ALERT_EMAIL` is unset the
script prints `[skip] contact point` and leaves alert delivery unwired.

⚠️ Grafana's notification-policy tree is a singleton — provisioning it
**replaces the stack's root policy**. This is intended for a
NOJV-dedicated Grafana stack. On a shared stack, leave
`GRAFANA_ALERT_EMAIL` unset and add the contact point as a child route
in the Grafana UI instead. Non-email channels (Slack, PagerDuty) are
likewise configured in the UI under **Alerting → Contact points**.

## Token rotation

### When

- **Annually**, calendar-driven, regardless of incident.
- **Immediately** on suspected leak (push to public repo, sent in clear,
  appearance in CI logs).

### How

1. Grafana UI → **Administration → Service accounts → nojv-provision →
   Add service account token** → create the new token.
2. Update `GRAFANA_SA_TOKEN` in `.env` (local) and in GCP Secret Manager
   (production).
3. Run `pnpm grafana:provision` once with the new token to confirm it
   works.
4. Revoke the old token from the same Service Account page.

OTLP push tokens (`glc_*`) rotate via **Cloud Portal → Access policies →
nojv-otlp-push → Tokens**. Same flow: create new, swap into the runtime secret,
restart the affected Deployment (`kubectl rollout restart`), revoke old.

## Disabling telemetry

- **Dev**: leave `GRAFANA_OTLP_*` empty. SDK no-ops on boot.
- **Prod**: same. Removing the secrets from the running revision and
  triggering a redeploy disables export with no code change.

The SDK detects unset/empty values in `apps/web/src/lib/server/otel.ts`
and `apps/worker/src/otel.ts` and bails out before constructing the
exporter. There is no kill switch beyond env config — by design, so an
ops-time mistake can't accidentally enable telemetry against the wrong
stack.

## Known limitations

- **No traces.** `spanProcessors: []` is intentional. Distributed tracing
  would be useful one day but adds cost and noise; metrics-only is
  sufficient for current SLOs.
- **No log correlation in Grafana.** Logs go to GCP Cloud Logging. To
  correlate a metric blip with logs you currently jump between Grafana
  and the Cloud Logging console.
- **SSE active-connection count is approximated.** We measure
  `sse_connection_duration_seconds` (a histogram observed on close) and
  `sse_connection_dropped_total` (counter incremented on server-fault
  close). There is no live gauge of currently-open SSE connections —
  inferring "open right now" from close-event rate is approximate.
- **`where-is-the-time-going` auto-instrumentation metric names.** The
  OpenTelemetry semantic conventions for HTTP / DB metric names
  occasionally shift between SDK versions. If the panels labelled
  "Postgres / Redis client operation duration (auto)" go blank after an
  SDK bump, check the generated metric name (`OTEL_LOG_LEVEL=DEBUG` on
  one process, look for `db.client.operation.duration` vs alternative
  names) and update the dashboard's PromQL to match. The dashboard's
  text panel notes this caveat for future readers.
- **OAuth callback latency.** Captured by the outer
  `api_request_duration_seconds` timer. The Task 7 fix moved the timer
  out of `handle` exit hooks that better-auth shortcuts past, so the
  metric now covers all `handle` exit paths. Drill into
  `route="/api/auth/callback/[provider]"` if investigating an OAuth
  regression.

## PromQL queries used by each dashboard panel

Future agents shouldn't have to reverse-engineer the JSON. The panel ↔
expression map below mirrors `infra/grafana/dashboards/*.json` exactly.

### NOJV — Judge Latency (`nojv-judge-latency`)

| Panel                                      | Expression                                                                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| p95 judge latency by mode                  | `histogram_quantile(0.95, sum by (mode, le) (rate(judge_latency_seconds_bucket[5m])))`                                             |
| p99 judge latency by mode                  | `histogram_quantile(0.99, sum by (mode, le) (rate(judge_latency_seconds_bucket[5m])))`                                             |
| Throughput (submissions/min) by verdict    | `sum by (verdict) (rate(judge_latency_seconds_count[1m])) * 60`                                                                    |
| System error rate (RE + CE share of total) | `sum(rate(judge_latency_seconds_count{verdict=~"runtime_error\|compile_error"}[5m])) / sum(rate(judge_latency_seconds_count[5m]))` |
| Current p95 judge latency (15m)            | `histogram_quantile(0.95, sum by (le) (rate(judge_latency_seconds_bucket[15m])))`                                                  |

### NOJV — API Latency (`nojv-api-latency`)

| Panel                                  | Expression                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| p99 / p95 / p50 API latency (overall)  | `histogram_quantile(0.99, sum by (le) (rate(api_request_duration_seconds_bucket[5m])))` (and 0.95 / 0.50 variants)          |
| p99 by route — top 10 slowest          | `topk(10, histogram_quantile(0.99, sum by (route, le) (rate(api_request_duration_seconds_bucket[5m]))))`                    |
| Request rate (req/min) by status class | `sum by (status_class) (rate(api_request_duration_seconds_count[1m])) * 60`                                                 |
| 5xx error rate (share of total)        | `sum(rate(api_request_duration_seconds_count{status_class="5xx"}[5m])) / sum(rate(api_request_duration_seconds_count[5m]))` |
| Current p99 API latency (15m)          | `histogram_quantile(0.99, sum by (le) (rate(api_request_duration_seconds_bucket[15m])))`                                    |

### NOJV — Scoreboard Update (`nojv-scoreboard`)

| Panel                                 | Expression                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| p95 scoreboard update latency by mode | `histogram_quantile(0.95, sum by (mode, le) (rate(scoreboard_update_latency_seconds_bucket[5m])))` |
| p99 scoreboard update latency by mode | `histogram_quantile(0.99, sum by (mode, le) (rate(scoreboard_update_latency_seconds_bucket[5m])))` |
| Updates per minute by mode            | `sum by (mode) (rate(scoreboard_update_latency_seconds_count[1m])) * 60`                           |
| Current p95 scoreboard update (15m)   | `histogram_quantile(0.95, sum by (le) (rate(scoreboard_update_latency_seconds_bucket[15m])))`      |

### NOJV — Exam Proctoring (`nojv-exam-proctoring`)

| Panel                                                    | Expression                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| SSE close events per minute (proxy for connection churn) | `sum(rate(sse_connection_duration_seconds_count[1m])) * 60`               |
| SSE close reasons (last 1h)                              | `sum by (close_reason) (rate(sse_connection_duration_seconds_count[1h]))` |
| SSE drops (server fault) per hour                        | `sum(rate(sse_connection_dropped_total[1h])) * 3600`                      |

### NOJV — Where Is The Time Going? (`nojv-time-breakdown`)

| Panel                                          | Expression                                                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p95: app-level vs HTTP server                  | `histogram_quantile(0.95, sum by (le) (rate(api_request_duration_seconds_bucket[5m])))` and `... (rate(http_server_request_duration_seconds_bucket[5m]))` |
| p95: Postgres client operation duration (auto) | `histogram_quantile(0.95, sum by (le) (rate(db_client_operation_duration_seconds_bucket[5m])))`                                                           |
| p95: Redis client operation duration (auto)    | `histogram_quantile(0.95, sum by (le) (rate(redis_client_duration_seconds_bucket[5m])))`                                                                  |

## Related Docs

- [Reliability Invariants](../operations/RELIABILITY.md) — SLO table with per-row
  dashboard links
- [Deployment Guide](../operations/DEPLOYMENT.md) — env-var injection for production
- [Incident Recovery Runbook](./incident-recovery.md) — what to do when
  an SLO burns
