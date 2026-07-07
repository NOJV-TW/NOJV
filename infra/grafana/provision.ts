import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  AlertRuleDefsSchema,
  DashboardSchema,
  OptionalEnvSchema,
  RequiredEnvSchema,
  type AlertRuleDef,
  type DashboardModel,
} from "./schemas.ts";

export type { AlertRuleDef, DashboardModel };

export type GrafanaConfig = {
  stackUrl: string;
  saToken: string;
};

export type UploadResult = {
  uid: string;
  url: string;
};

export async function uploadDashboard(
  config: GrafanaConfig,
  dashboard: DashboardModel,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadResult> {
  const response = await fetchImpl(`${config.stackUrl}/api/dashboards/db`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.saToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dashboard,
      overwrite: true,
      message: "Provisioned by nojv grafana:provision script",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Grafana API ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as { uid: string; url: string };
  return { uid: data.uid, url: data.url };
}

export type AlertRuleContext = {
  folderUID: string;
  datasourceUid: string;
};

export function buildAlertRule(def: AlertRuleDef, ctx: AlertRuleContext) {
  const relativeTimeRange = { from: 3600, to: 0 };
  return {
    uid: def.uid,
    title: def.title,
    condition: "C",
    folderUID: ctx.folderUID,
    ruleGroup: "NOJV SLO",
    orgID: 1,
    for: def.for,
    noDataState: def.noDataState ?? "OK",
    execErrState: "Error",
    labels: { severity: def.severity, team: "nojv" },
    annotations: { summary: def.summary, slo: def.slo },
    data: [
      {
        refId: "A",
        relativeTimeRange,
        datasourceUid: ctx.datasourceUid,
        model: {
          refId: "A",
          expr: def.expr,
          instant: true,
          intervalMs: 1000,
          maxDataPoints: 43200,
        },
      },
      {
        refId: "B",
        relativeTimeRange,
        datasourceUid: "__expr__",
        model: { refId: "B", type: "reduce", reducer: "last", expression: "A" },
      },
      {
        refId: "C",
        relativeTimeRange,
        datasourceUid: "__expr__",
        model: {
          refId: "C",
          type: "threshold",
          expression: "B",
          conditions: [{ evaluator: { type: "gt", params: [def.threshold] } }],
        },
      },
    ],
  };
}

export type AlertRulePayload = ReturnType<typeof buildAlertRule>;

export async function uploadAlertRule(
  config: GrafanaConfig,
  rule: AlertRulePayload,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${config.saToken}`,
    "Content-Type": "application/json",
    "X-Disable-Provenance": "true",
  };
  const base = `${config.stackUrl}/api/v1/provisioning/alert-rules`;

  let response = await fetchImpl(`${base}/${rule.uid}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(rule),
  });
  if (response.status === 404) {
    response = await fetchImpl(base, {
      method: "POST",
      headers,
      body: JSON.stringify(rule),
    });
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Grafana alert API ${response.status}: ${body.slice(0, 200)}`);
  }
  return rule.uid;
}

async function provisionDashboards(config: GrafanaConfig, baseDir: string): Promise<number> {
  const dashboardDir = join(baseDir, "dashboards");
  const files = (await readdir(dashboardDir)).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.error(`No dashboard JSON files found in ${dashboardDir}`);
    return 1;
  }

  let failed = 0;
  for (const file of files) {
    const path = join(dashboardDir, file);
    try {
      const json = DashboardSchema.parse(JSON.parse(await readFile(path, "utf8")));
      const result = await uploadDashboard(config, json);
      console.log(`[ok] ${file} -> uid=${result.uid} url=${config.stackUrl}${result.url}`);
    } catch (err) {
      failed++;
      console.error(`[fail] ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return failed;
}

async function provisionAlerts(config: GrafanaConfig, baseDir: string): Promise<number> {
  const folderUID = process.env.GRAFANA_ALERT_FOLDER_UID;
  const datasourceUid = process.env.GRAFANA_PROM_DATASOURCE_UID;
  if (!folderUID || !datasourceUid) {
    console.log(
      "[skip] alert rules — set GRAFANA_ALERT_FOLDER_UID + GRAFANA_PROM_DATASOURCE_UID to provision them",
    );
    return 0;
  }

  const alertsPath = join(baseDir, "alerts", "slo-alerts.json");
  let defs: ReturnType<typeof AlertRuleDefsSchema.parse>;
  try {
    defs = AlertRuleDefsSchema.parse(JSON.parse(await readFile(alertsPath, "utf8")));
  } catch (err) {
    console.error(
      `[fail] alert defs ${alertsPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }

  let failed = 0;
  for (const def of defs) {
    try {
      const uid = await uploadAlertRule(
        config,
        buildAlertRule(def, { folderUID, datasourceUid }),
      );
      console.log(`[ok] alert ${uid}`);
    } catch (err) {
      failed++;
      console.error(
        `[fail] alert ${def.uid}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return failed;
}

const NOJV_CONTACT_POINT_NAME = "NOJV SLO Alerts";
const NOJV_CONTACT_POINT_UID = "nojv-slo-contact";

export function buildContactPoint(email: string) {
  return {
    uid: NOJV_CONTACT_POINT_UID,
    name: NOJV_CONTACT_POINT_NAME,
    type: "email",
    settings: { addresses: email },
    disableResolveMessage: false,
  };
}

export function buildNotificationPolicy() {
  return {
    receiver: NOJV_CONTACT_POINT_NAME,
    group_by: ["grafana_folder", "alertname"],
    routes: [
      {
        receiver: NOJV_CONTACT_POINT_NAME,
        object_matchers: [["team", "=", "nojv"]],
        group_by: ["alertname"],
      },
    ],
  };
}

export type ContactPoint = ReturnType<typeof buildContactPoint>;
export type NotificationPolicy = ReturnType<typeof buildNotificationPolicy>;

const provisioningHeaders = (saToken: string) => ({
  Authorization: `Bearer ${saToken}`,
  "Content-Type": "application/json",
  "X-Disable-Provenance": "true",
});

export async function uploadContactPoint(
  config: GrafanaConfig,
  contactPoint: ContactPoint,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const headers = provisioningHeaders(config.saToken);
  const base = `${config.stackUrl}/api/v1/provisioning/contact-points`;

  let response = await fetchImpl(`${base}/${contactPoint.uid}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(contactPoint),
  });
  if (response.status === 404) {
    response = await fetchImpl(base, {
      method: "POST",
      headers,
      body: JSON.stringify(contactPoint),
    });
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Grafana contact-point API ${response.status}: ${body.slice(0, 200)}`);
  }
  return contactPoint.uid;
}

export async function uploadNotificationPolicy(
  config: GrafanaConfig,
  policy: NotificationPolicy,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(`${config.stackUrl}/api/v1/provisioning/policies`, {
    method: "PUT",
    headers: provisioningHeaders(config.saToken),
    body: JSON.stringify(policy),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Grafana policy API ${response.status}: ${body.slice(0, 200)}`);
  }
}

async function provisionContactPoint(config: GrafanaConfig): Promise<number> {
  const email = process.env.GRAFANA_ALERT_EMAIL;
  if (!email) {
    console.log("[skip] contact point — set GRAFANA_ALERT_EMAIL to provision it");
    return 0;
  }

  try {
    const uid = await uploadContactPoint(config, buildContactPoint(email));
    console.log(`[ok] contact point ${uid}`);
    await uploadNotificationPolicy(config, buildNotificationPolicy());
    console.log("[ok] notification policy");
    return 0;
  } catch (err) {
    console.error(
      `[fail] contact point / policy: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
}

async function main(): Promise<void> {
  const required = RequiredEnvSchema.safeParse(process.env);
  if (!required.success) {
    console.error("Missing or invalid required env vars:");
    for (const issue of required.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    console.error("Set them in .env (see .env.example for the full list)");
    process.exit(1);
  }

  const optional = OptionalEnvSchema.safeParse(process.env);
  if (!optional.success) {
    console.error("Invalid optional env vars:");
    for (const issue of optional.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  const baseDir = import.meta.dirname ?? __dirname;
  const config: GrafanaConfig = {
    stackUrl: required.data.GRAFANA_STACK_URL,
    saToken: required.data.GRAFANA_SA_TOKEN,
  };

  const dashboardFailures = await provisionDashboards(config, baseDir);
  const alertFailures = await provisionAlerts(config, baseDir);
  const contactFailures = await provisionContactPoint(config);

  const failed = dashboardFailures + alertFailures + contactFailures;
  if (failed > 0) {
    console.error(`${failed} provisioning task(s) failed`);
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  await main();
}
