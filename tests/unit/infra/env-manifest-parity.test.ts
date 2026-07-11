import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { workerEnvSchema } from "../../../apps/worker/src/env";
import { storageEnvSchema } from "../../../packages/storage/src/env";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

function helmAvailable(): boolean {
  try {
    execSync("helm version", { cwd: repoRoot, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

let renderedChart: string | undefined;
function renderChart(): string {
  if (renderedChart === undefined) {
    renderedChart = execSync(
      "helm template nojv infra/charts/nojv -f infra/charts/nojv/values-gke.yaml",
      { cwd: repoRoot, encoding: "utf8" },
    );
  }
  return renderedChart;
}

function isolateDoc(render: string, kind: string, name: string): string {
  const doc = render
    .split(/^---$/m)
    .find(
      (d) => new RegExp(`^kind:\\s*${kind}\\s*$`, "m").test(d) && d.includes(`name: ${name}`),
    );
  if (doc === undefined) {
    throw new Error(`rendered chart has no ${kind}/${name}`);
  }
  return doc;
}

const validK8sEnv: Record<string, string> = {
  NODE_ENV: "production",
  PORT: "8080",
  REDIS_URL: "redis://localhost:6379",
  TEMPORAL_ADDRESS: "temporal:7233",
  TEMPORAL_NAMESPACE: "default",
  SANDBOX_IMAGE: "img:latest",
  WORKER_CONCURRENCY: "4",
  WORKER_MODE: "all",
  EXECUTION_BACKEND: "kubernetes",
  K8S_NAMESPACE: "nojv-sandbox",
  K8S_CPU_REQUEST: "500m",
  K8S_CPU_LIMIT: "1",
  K8S_MEMORY_REQUEST: "256Mi",
  K8S_MEMORY_LIMIT: "512Mi",
  EGRESS_PROXY_IMAGE: "egress-proxy:latest",
};

function requiredKubernetesEnvKeys(): string[] {
  const required: string[] = [];
  for (const key of Object.keys(validK8sEnv)) {
    const withoutKey = { ...validK8sEnv };
    delete withoutKey[key];
    if (!workerEnvSchema.safeParse(withoutKey).success) required.push(key);
  }
  return required;
}

const validStorageEnv: Record<string, string> = {
  NODE_ENV: "production",
  S3_ENDPOINT: "https://storage.googleapis.com",
  S3_ACCESS_KEY: "a",
  S3_SECRET_KEY: "s",
};

function requiredProductionStorageKeys(): string[] {
  const required: string[] = [];
  for (const key of Object.keys(validStorageEnv)) {
    if (key === "NODE_ENV") continue;
    const without = { ...validStorageEnv };
    delete without[key];
    if (!storageEnvSchema.safeParse(without).success) required.push(key);
  }
  return required;
}

function containerEnvNames(yamlText: string): Set<string> {
  const names = new Set<string>();
  let inEnv = false;
  let envIndent = -1;
  for (const line of yamlText.split("\n")) {
    const envMatch = /^(\s*)env:\s*$/.exec(line);
    if (envMatch) {
      inEnv = true;
      envIndent = envMatch[1].length;
      continue;
    }
    if (!inEnv) continue;
    if (line.trim() !== "" && line.length - line.trimStart().length <= envIndent) {
      inEnv = false;
      continue;
    }
    const nameMatch = /^\s+- name:\s*(\S+)\s*$/.exec(line);
    if (nameMatch) names.add(nameMatch[1]);
  }
  return names;
}

const helm = helmAvailable();
const describeHelm = helm ? describe : describe.skip;
if (!helm) {
  describe.skip("env ↔ chart parity (skipped: helm not installed)", () => {
    it.skip("requires helm to render infra/charts/nojv", () => {});
  });
}

describe("env schema baseline (no helm required)", () => {
  it("the valid baseline env parses (sanity check for the drop-one probe)", () => {
    expect(workerEnvSchema.safeParse(validK8sEnv).success).toBe(true);
  });

  it("the production storage baseline parses (sanity check for the drop-one probe)", () => {
    expect(storageEnvSchema.safeParse(validStorageEnv).success).toBe(true);
  });
});

describeHelm("env schema ↔ chart deployment parity", () => {
  it("GKE worker Deployment provides every env the kubernetes backend requires", () => {
    const worker = isolateDoc(renderChart(), "Deployment", "nojv-worker");
    const provided = containerEnvNames(worker);
    const missing = requiredKubernetesEnvKeys().filter((k) => !provided.has(k));
    expect(
      missing,
      `nojv-worker Deployment is missing required env (worker would crashloop on boot): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("web Deployment sets EXECUTION_BACKEND so advanced-mode gating matches the worker", () => {
    const web = isolateDoc(renderChart(), "Deployment", "nojv-web");
    expect(containerEnvNames(web).has("EXECUTION_BACKEND")).toBe(true);
  });

  it("web Deployment no longer ships ADVANCED_IMAGE_REGISTRY (ZIP prebuild is dev-only)", () => {
    const web = isolateDoc(renderChart(), "Deployment", "nojv-web");
    expect(containerEnvNames(web).has("ADVANCED_IMAGE_REGISTRY")).toBe(false);
  });
});

describe("Dockerfiles that frozen-install must ship the pnpm patch files", () => {
  const workspaceManifest = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const patchBlock = /^patchedDependencies:\n((?:  .+\n)+)/m.exec(workspaceManifest);
  const hasPatches = patchBlock !== null && patchBlock[1]!.trim().length > 0;

  const dockerDir = join(repoRoot, "infra/docker");
  const frozenInstallDockerfiles = readdirSync(dockerDir)
    .filter((f) => f.endsWith(".Dockerfile"))
    .filter((f) => readFileSync(join(dockerDir, f), "utf8").includes("--frozen-lockfile"));

  it("the repo declares pnpm patches (otherwise this guard is moot)", () => {
    expect(hasPatches).toBe(true);
  });

  it.each(frozenInstallDockerfiles)("%s copies patches/ before installing", (file) => {
    expect(readFileSync(join(dockerDir, file), "utf8")).toMatch(/COPY patches\//);
  });
});

describeHelm("production web secret parity across deploy surfaces", () => {
  const requiredWebEnv = ["S3_REGION"] as const;

  it.each(requiredWebEnv)("web Deployment provides %s", (key) => {
    const web = isolateDoc(renderChart(), "Deployment", "nojv-web");
    expect(containerEnvNames(web).has(key)).toBe(true);
  });
});

describeHelm("storage env schema ↔ chart deployment parity", () => {
  it.each([
    ["GKE worker", "nojv-worker"],
    ["web", "nojv-web"],
  ])(
    "%s Deployment provides every storage credential required in production",
    (_name, name) => {
      const deployment = isolateDoc(renderChart(), "Deployment", name);
      const provided = containerEnvNames(deployment);
      const missing = requiredProductionStorageKeys().filter((k) => !provided.has(k));
      expect(
        missing,
        `${name} Deployment is missing storage env (judging / image storage would fail in production): ${missing.join(", ")}`,
      ).toEqual([]);
    },
  );
});
