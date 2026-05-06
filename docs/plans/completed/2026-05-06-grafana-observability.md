# Grafana Observability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up Grafana Cloud dashboards backed by OpenTelemetry metrics from `apps/web` and `apps/worker`, replacing the `[monitoring TBD]` markers in `RELIABILITY.md` with real PromQL-driven SLO measurement.

**Architecture:** OTel SDK in both Node apps → OTLP HTTP exporter → Grafana Cloud Hosted Prometheus (free tier, ap-northeast-0). Auto-instrumentations cover http/pg/redis/undici; manual instrumentation adds 5 SLO-specific metrics. 5 dashboards provisioned via Grafana service account API. No Alloy / Prometheus self-host.

**Tech Stack:**

- `@opentelemetry/sdk-node` (^0.205.0)
- `@opentelemetry/auto-instrumentations-node` (^0.62.0) — http, pg, ioredis, undici, dns
- `@opentelemetry/exporter-metrics-otlp-http`
- `@opentelemetry/api` — manual histogram/counter
- Grafana Cloud Hosted Prometheus + provisioning API
- Existing: pino logger, SvelteKit hooks.server.ts, Temporal Node SDK

---

## Pre-Flight

**Verification before starting any task:**

```bash
pnpm --filter @nojv/web typecheck && pnpm --filter @nojv/worker typecheck
```

Both should be green. Re-verify after every task that touches code.

---

## Task 0: Reformat `.secrets/grafana.env` to KEY=VALUE

**Why:** OTel SDK reads env vars; River-block syntax cannot be parsed by `dotenv` / Node `process.env`.

**Files:**

- Modify: `/Users/takala/code/NOJV/.secrets/grafana.env`

**Step 1: Replace file content**

Use `Read` first to capture the 3 secret values (URL, username, password from the River block; SA_TOKEN; STACK_URL) without printing them. Then `Write` the file with this template (interpolating actual values):

```
# Grafana Cloud — local development secrets (gitignored, do NOT commit)
# Region: prod-ap-northeast-0  Stack: takalawang  Created: 2026-05-06

# Hosted Prometheus / OTLP push credentials (basic auth: instance_id : token)
GRAFANA_OTLP_ENDPOINT=https://otlp-gateway-prod-ap-northeast-0.grafana.net/otlp
GRAFANA_OTLP_INSTANCE_ID=<from River block: username>
GRAFANA_OTLP_TOKEN=<from River block: password>

# Grafana service account (dashboard provisioning via /api/dashboards/db)
GRAFANA_STACK_URL=<existing GRAFANA_STACK_URL>
GRAFANA_SA_TOKEN=<existing GRAFANA_SA_TOKEN>
```

**Step 2: Verify**

Run: `grep -c '^GRAFANA_' /Users/takala/code/NOJV/.secrets/grafana.env`
Expected: `5`

Run: `git -C /Users/takala/code/NOJV check-ignore -v .secrets/grafana.env`
Expected: `.gitignore:NN:.secrets/	.secrets/grafana.env`

**Step 3: NO commit** — file is gitignored.

---

## Task 1: Update `.env.example` with placeholder env vars

**Files:**

- Modify: `/Users/takala/code/NOJV/.env.example` (or create if missing)

**Step 1: Append placeholders**

```env
# --- Grafana Cloud observability ---
# Get from https://grafana.com/orgs/<your-org>/stacks then "Send Metrics via OTLP"
# Leave empty to disable telemetry export (no-op SDK)
GRAFANA_OTLP_ENDPOINT=
GRAFANA_OTLP_INSTANCE_ID=
GRAFANA_OTLP_TOKEN=
# Optional: separate per-app service name override
OTEL_SERVICE_NAME_WEB=nojv-web
OTEL_SERVICE_NAME_WORKER=nojv-worker
# /metrics endpoint protection (random secret, web only)
METRICS_TOKEN=
```

**Step 2: Verify**

```bash
grep -c "GRAFANA_OTLP" /Users/takala/code/NOJV/.env.example
```

Expected: `3`

**Step 3: Commit**

```bash
git -C /Users/takala/code/NOJV add .env.example .gitignore
git -C /Users/takala/code/NOJV commit -m "chore(observability): add Grafana OTLP env placeholders"
```

---

## Task 2: Add OTel dependencies to `apps/web` and `apps/worker`

**Files:**

- Modify: `apps/web/package.json`
- Modify: `apps/worker/package.json`
- Modify: `pnpm-lock.yaml` (regenerated)

**Step 1: Install in `apps/web`**

```bash
pnpm --filter @nojv/web add \
  @opentelemetry/api@^1.9.0 \
  @opentelemetry/sdk-node@^0.205.0 \
  @opentelemetry/auto-instrumentations-node@^0.62.0 \
  @opentelemetry/exporter-metrics-otlp-http@^0.205.0 \
  @opentelemetry/resources@^2.1.0 \
  @opentelemetry/semantic-conventions@^1.40.0
```

**Step 2: Install in `apps/worker`** (same set)

```bash
pnpm --filter @nojv/worker add \
  @opentelemetry/api@^1.9.0 \
  @opentelemetry/sdk-node@^0.205.0 \
  @opentelemetry/auto-instrumentations-node@^0.62.0 \
  @opentelemetry/exporter-metrics-otlp-http@^0.205.0 \
  @opentelemetry/resources@^2.1.0 \
  @opentelemetry/semantic-conventions@^1.40.0
```

**Step 3: Verify**

```bash
pnpm --filter @nojv/web typecheck && pnpm --filter @nojv/worker typecheck
```

Both green.

**Step 4: Commit**

```bash
git add apps/web/package.json apps/worker/package.json pnpm-lock.yaml
git commit -m "chore(deps): add OpenTelemetry SDK to web and worker"
```

---

## Task 3: Create shared OTel init module

**Why:** Both apps need the same SDK boot sequence (resource attrs, OTLP exporter, periodic reader, auto-instrumentations). Extract to `@nojv/redis`-style shared util? **No** — keep per-app to avoid circular package deps and to allow each app to control instrumentation set independently.

**Files:**

- Create: `apps/web/src/lib/server/otel.ts`
- Create: `apps/worker/src/otel.ts`

**Step 1: Write `apps/web/src/lib/server/otel.ts`**

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from "@opentelemetry/semantic-conventions/incubating";

let started = false;
let sdk: NodeSDK | null = null;

export function startOtel(): void {
  if (started) return;
  const endpoint = process.env.GRAFANA_OTLP_ENDPOINT;
  const instanceId = process.env.GRAFANA_OTLP_INSTANCE_ID;
  const token = process.env.GRAFANA_OTLP_TOKEN;
  if (!endpoint || !instanceId || !token) {
    return; // no-op when not configured (local dev without metrics)
  }

  const auth = Buffer.from(`${instanceId}:${token}`).toString("base64");

  const exporter = new OTLPMetricExporter({
    url: `${endpoint.replace(/\/$/, "")}/v1/metrics`,
    headers: { Authorization: `Basic ${auth}` },
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME_WEB ?? "nojv-web",
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.0.0",
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV ?? "development",
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 30_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
      }),
    ],
  });

  sdk.start();
  started = true;

  process.on("SIGTERM", () => {
    sdk?.shutdown().catch(() => undefined);
  });
}
```

**Step 2: Write `apps/worker/src/otel.ts`** — same module, but service name defaults to `nojv-worker` (env `OTEL_SERVICE_NAME_WORKER`).

**Step 3: Verify**

```bash
pnpm --filter @nojv/web typecheck && pnpm --filter @nojv/worker typecheck
```

**Step 4: Commit**

```bash
git add apps/web/src/lib/server/otel.ts apps/worker/src/otel.ts
git commit -m "feat(observability): OTel NodeSDK init with Grafana OTLP exporter"
```

---

## Task 4: Wire OTel init into entry points

**Why:** SDK must `start()` BEFORE any imports that auto-instrumentation hooks (http, pg, ioredis), otherwise hooks are missed.

**Files:**

- Modify: `apps/web/src/hooks.server.ts` — top of file, before any other import that touches http/db
- Modify: `apps/worker/src/index.ts` — top of file

**Step 1: web — add to TOP of `hooks.server.ts`**

```typescript
import { startOtel } from "$lib/server/otel";
startOtel();
// ... rest of existing imports
```

**Step 2: worker — add to TOP of `apps/worker/src/index.ts`**

```typescript
import { startOtel } from "./otel.js";
startOtel();
// ... rest of existing imports
```

**Step 3: Smoke test (web)**

```bash
# Source the secrets
set -a && source /Users/takala/code/NOJV/.secrets/grafana.env && set +a
pnpm --filter @nojv/web dev &
WEB_PID=$!
sleep 8 # allow first metric export
curl -sf http://localhost:5173/api/healthz
sleep 35 # wait for next 30s export interval
kill $WEB_PID
```

**Step 4: Verify in Grafana Cloud**

Open `https://takalawang.grafana.net/explore`, datasource = `grafanacloud-takalawang-prom`, query:

```promql
{service_name="nojv-web"}
```

Expected: at least one series visible (http_server_request_duration_seconds, nodejs_eventloop_lag_seconds, etc.).

**Step 5: Commit**

```bash
git add apps/web/src/hooks.server.ts apps/worker/src/index.ts
git commit -m "feat(observability): boot OTel SDK at process start"
```

---

## Task 5: Add `/api/metrics` endpoint (web only, optional Prometheus scrape path)

**Why:** Even with OTLP push, having a `/metrics` Prometheus scrape endpoint lets local debug + future GCP Managed Prometheus scrape. Token-protected.

**Skip if** OTLP push works and there is no plan for scrape — re-evaluate after Task 4 verification.

**Files:**

- Create: `apps/web/src/routes/api/metrics/+server.ts`

(Detailed code spec deferred — decide after Task 4 outcome.)

---

## Task 6: Manual SLO instrumentation — `judge_latency_seconds`

**Files:**

- Modify: `packages/temporal/src/activities/submission.ts` (the `completeSubmission` activity)
- Create: `packages/temporal/src/activities/metrics.ts`
- Create: `tests/unit/temporal/activities/metrics.test.ts`

**Step 1: Write failing test**

```typescript
// tests/unit/temporal/activities/metrics.test.ts
import { describe, it, expect } from "vitest";
import { judgeLatencyHistogram, recordJudgeLatency } from "../../../../packages/temporal/src/activities/metrics";

describe("judge latency metric", () => {
  it("records latency in seconds with mode + verdict labels", () => {
    const observed: Array<{ value: number; attrs: Record<string, string> }> = [];
    const fakeHistogram = {
      record: (value: number, attrs: Record<string, string>) => observed.push({ value, attrs }),
    } as unknown as typeof judgeLatencyHistogram;
    recordJudgeLatency(fakeHistogram, { startedAt: 1000, completedAt: 4500, mode: "standard", verdict: "AC" });
    expect(observed).toEqual([{ value: 3.5, attrs: { mode: "standard", verdict: "AC" } }]);
  });
});
```

**Step 2: Run — expect FAIL** (`recordJudgeLatency not exported`).

```bash
pnpm exec vitest run tests/unit/temporal/activities/metrics.test.ts
```

**Step 3: Implement**

```typescript
// packages/temporal/src/activities/metrics.ts
import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("@nojv/temporal", "0.1.0");

export const judgeLatencyHistogram = meter.createHistogram("judge_latency_seconds", {
  description: "End-to-end judge latency from submission.createdAt to verdict commit",
  unit: "s",
});

export function recordJudgeLatency(
  hist: typeof judgeLatencyHistogram,
  args: { startedAt: number; completedAt: number; mode: "standard" | "advanced"; verdict: string },
): void {
  const seconds = (args.completedAt - args.startedAt) / 1000;
  hist.record(seconds, { mode: args.mode, verdict: args.verdict });
}
```

**Step 4: Run — expect PASS**.

**Step 5: Wire into `completeSubmission`** — at the end of the activity, call `recordJudgeLatency(judgeLatencyHistogram, { startedAt: submission.createdAt.getTime(), completedAt: Date.now(), mode, verdict })`.

**Step 6: Re-run typecheck + unit tests**

```bash
pnpm --filter @nojv/temporal typecheck && pnpm exec vitest run tests/unit/temporal
```

**Step 7: Commit**

```bash
git commit -am "feat(observability): instrument judge_latency_seconds histogram"
```

---

## Task 7: Manual SLO instrumentation — `api_request_duration_seconds`

**Why:** Auto http instrumentation gives `http.server.request.duration` but with raw URL paths (`/problems/abc123`, `/problems/def456` are different series → cardinality explosion). Need route-template label.

**Files:**

- Modify: `apps/web/src/hooks.server.ts` — wrap `resolve` to extract `event.route.id` (SvelteKit's static route pattern, e.g. `/(app)/problems/[id]`).
- Create: `apps/web/src/lib/server/metrics.ts`

**Step 1: Write metric module**

```typescript
// apps/web/src/lib/server/metrics.ts
import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("@nojv/web", "0.1.0");

export const apiRequestDuration = meter.createHistogram("api_request_duration_seconds", {
  description: "API request duration measured at the SvelteKit hook boundary",
  unit: "s",
});
```

**Step 2: Wrap `resolve` in `hooks.server.ts`**

Inside the existing `handle` chain, after `setSecurityHeaders`:

```typescript
const startTime = performance.now();
const response = await resolve(event);
const durationSec = (performance.now() - startTime) / 1000;
apiRequestDuration.record(durationSec, {
  route: event.route.id ?? "unmatched",
  method: event.request.method,
  status_class: `${Math.floor(response.status / 100)}xx`,
});
```

Exclude streaming routes and SSE (route IDs ending with `/stream`):

```typescript
if (!event.route.id?.endsWith("/stream")) {
  apiRequestDuration.record(...);
}
```

**Step 3: Verify route IDs are stable templates**

```bash
grep -rn 'route\.id' /Users/takala/code/NOJV/apps/web/src
```

`event.route.id` returns the template (`/(app)/problems/[id]`), confirmed.

**Step 4: Smoke test + Grafana query**

```promql
histogram_quantile(0.99, sum by (route, le) (rate(api_request_duration_seconds_bucket[5m])))
```

**Step 5: Commit**

---

## Task 8: Manual SLO instrumentation — `scoreboard_update_latency_seconds`

**Files:**

- Modify: `packages/redis/src/scoreboard.ts` — wrap `updateScoreboard`
- Create: `packages/redis/src/metrics.ts`

(Same pattern as Task 7. Histogram with label `mode={icpc|ioi}`, recorded inside `updateScoreboard` between input validation and `zadd`.)

---

## Task 9: Manual SLO instrumentation — SSE connection lifecycle

**Files:**

- Modify: `apps/web/src/routes/api/events/stream/+server.ts`
- Add to: `apps/web/src/lib/server/metrics.ts`

**Metrics:**

- `sse_connection_duration_seconds` (histogram) — recorded on close
- `sse_connection_dropped_total` (counter) — incremented when close reason is server-side fault

Wire on `request.signal.addEventListener("abort", ...)`.

---

## Task 10: Manual SLO instrumentation — `exam_heartbeat_miss_total`

**Files:**

- Modify: `apps/web/src/routes/api/exam-session/heartbeat/+server.ts`
- Add to: `apps/web/src/lib/server/metrics.ts`

**Logic:** when handler computes `now - lastHeartbeatAt > 30_000`, increment counter with label `examId`. (Keep cardinality bounded — if there are > 50 active exams, drop label and use only `gap_bucket={30s,60s,120s,>120s}`.)

---

## Task 11: Define dashboard JSON files

**Files:**

- Create: `infra/grafana/dashboards/judge-latency.json`
- Create: `infra/grafana/dashboards/api-latency.json`
- Create: `infra/grafana/dashboards/scoreboard.json`
- Create: `infra/grafana/dashboards/exam-proctoring.json`
- Create: `infra/grafana/dashboards/where-is-the-time-going.json`

**Step 1:** Use Grafana 11+ schema (`schemaVersion: 39`). Each dashboard has 3-6 panels. Refer to existing public dashboards on grafana.com/dashboards as starting templates (Node.js exporter dashboard #11159 covers most node panels).

**Step 2:** Each dashboard top-level fields:

```json
{
  "uid": "nojv-judge-latency",
  "title": "NOJV — Judge Latency",
  "tags": ["nojv", "slo"],
  "schemaVersion": 39,
  "panels": [...]
}
```

**Detailed panel queries listed in `docs/runbooks/observability-setup.md` (Task 13).**

---

## Task 12: Dashboard provisioning script

**Files:**

- Create: `infra/grafana/provision.ts`
- Create: `infra/grafana/provision.test.ts` (offline test against mock fetch)

**Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { uploadDashboard } from "./provision";

describe("provisionDashboard", () => {
  it("POSTs to /api/dashboards/db with overwrite:true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"status":"success","uid":"nojv-judge-latency"}'));
    await uploadDashboard(
      { stackUrl: "https://x.grafana.net", saToken: "glsa_x" },
      { uid: "nojv-judge-latency", title: "T", panels: [] },
      fetchMock,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://x.grafana.net/api/dashboards/db",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer glsa_x" }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.overwrite).toBe(true);
    expect(body.dashboard.uid).toBe("nojv-judge-latency");
  });
});
```

**Step 2:** Implement minimal `uploadDashboard` and a CLI entry that reads all 5 JSON files from `infra/grafana/dashboards/*.json` and uploads each.

**Step 3:** Add npm script:

```json
// root package.json
"scripts": {
  "grafana:provision": "tsx infra/grafana/provision.ts"
}
```

**Step 4: Real provisioning run**

```bash
set -a && source /Users/takala/code/NOJV/.secrets/grafana.env && set +a
pnpm grafana:provision
```

Expected output (per dashboard): `[ok] uid=nojv-judge-latency url=https://takalawang.grafana.net/d/nojv-judge-latency/...`

**Step 5: Visual verification**

Open each `url` from output, confirm panels render (may show "No data" until traffic flows — that's fine).

**Step 6: Commit**

```bash
git add infra/grafana/ package.json
git commit -m "feat(observability): 5 dashboards + provisioning script"
```

---

## Task 13: Runbook + RELIABILITY + QUALITY_SCORE updates

**Files:**

- Create: `docs/runbooks/observability-setup.md`
- Modify: `docs/RELIABILITY.md` — replace `[monitoring TBD]` markers with dashboard links
- Modify: `docs/QUALITY_SCORE.md` — Reliability A- → A; Next Upgrade column updated; new ledger entry
- Modify: `docs/DEPLOYMENT.md` — add Grafana Cloud env-var section
- Modify: `AGENT.md` (root index) — add observability runbook to "Doc Index by Task"

**Runbook covers:**

1. Token rotation flow (Grafana Cloud + `.secrets/grafana.env` + GCP Secret Manager)
2. Dashboard re-provisioning (`pnpm grafana:provision`)
3. PromQL queries used by each panel (so future agents can extend without reverse-engineering JSON)
4. Cardinality budget (10k active series free tier — current usage estimate)
5. Adding a new metric checklist
6. Disabling telemetry in dev (leave env vars empty → SDK no-op)

**Commit:**

```bash
git commit -m "docs(observability): runbook + RELIABILITY/QUALITY_SCORE updates"
```

---

## Task 14: Move plan to completed

```bash
git mv docs/plans/active/2026-05-06-grafana-observability.md docs/plans/completed/
git commit -m "docs(plans): mark grafana observability plan complete"
```

---

## Final Verification

```bash
pnpm -w typecheck            # 17/17 green
pnpm turbo run lint          # 18/18 green
pnpm -w format               # clean
pnpm -w test:unit            # all green (with new metric tests)
pnpm grafana:provision       # 5 dashboards uploaded
```

Manually verify in Grafana Cloud:

1. Each of the 5 dashboard URLs renders panels
2. `{service_name="nojv-web"}` and `{service_name="nojv-worker"}` both have at least one series
3. `judge_latency_seconds_bucket`, `api_request_duration_seconds_bucket`, `scoreboard_update_latency_seconds_bucket` all present after a real submission flow

---

## Out of Scope (deliberately deferred)

- **Alerting** — set up after 1 week of baseline data
- **Logs to Grafana Loki** — pino → stdout → GCP Cloud Logging is sufficient
- **Traces to Grafana Tempo** — add only if a specific debugging need arises
- **GCP Managed Prometheus** — only consider if free tier becomes a constraint

---

## Risks

| Risk                                          | Mitigation                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| Cardinality explosion (10k free tier)         | All `userId` / `submissionId` labels banned. Route templates only. Audit after 1 week.  |
| OTel SDK init too late                        | Top-of-file import in entry points; verified in Task 4 smoke test.                      |
| OTLP endpoint wrong region                    | Region encoded in token metadata (`prod-ap-northeast-0`). Use exact endpoint from spec. |
| Dashboard JSON drift vs schema                | Tests in `provision.test.ts` validate POST contract. Manual verify in UI.               |
| Token leak via logs                           | Auth header set at exporter init only; pino redacts via existing config.                |

---

## Related Skills

- `@superpowers:test-driven-development` — for Tasks 6, 7, 12
- `@superpowers:verification-before-completion` — final verification step
- `@superpowers:executing-plans` — use this skill in execution session
