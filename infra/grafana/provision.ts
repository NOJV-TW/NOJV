import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export type GrafanaConfig = {
  stackUrl: string;
  saToken: string;
};

export type DashboardModel = {
  uid: string;
  title: string;
  schemaVersion: number;
  panels: unknown[];
  [key: string]: unknown;
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

async function main(): Promise<void> {
  const stackUrl = process.env.GRAFANA_STACK_URL;
  const saToken = process.env.GRAFANA_SA_TOKEN;
  if (!stackUrl || !saToken) {
    console.error("Missing GRAFANA_STACK_URL or GRAFANA_SA_TOKEN env vars");
    console.error("Source .secrets/grafana.env first");
    process.exit(1);
  }

  const dashboardDir = join(import.meta.dirname ?? __dirname, "dashboards");
  const files = (await readdir(dashboardDir)).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.error(`No dashboard JSON files found in ${dashboardDir}`);
    process.exit(1);
  }

  const config: GrafanaConfig = { stackUrl, saToken };
  let failed = 0;

  for (const file of files) {
    const path = join(dashboardDir, file);
    try {
      const json = JSON.parse(await readFile(path, "utf8")) as DashboardModel;
      const result = await uploadDashboard(config, json);
      console.log(`[ok] ${file} -> uid=${result.uid} url=${stackUrl}${result.url}`);
    } catch (err) {
      failed++;
      console.error(`[fail] ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failed > 0) {
    console.error(`${failed}/${files.length} dashboards failed`);
    process.exit(1);
  }
}

// Run main() only when invoked directly (not when imported by tests)
const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  await main();
}
