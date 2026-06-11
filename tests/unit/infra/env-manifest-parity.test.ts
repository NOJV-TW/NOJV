import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { workerEnvSchema } from "../../../apps/worker/src/env";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

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

function containerEnvNames(yamlText: string, stopAtSidecar: RegExp): Set<string> {
  const names = new Set<string>();
  let inEnv = false;
  let envIndent = -1;
  for (const line of yamlText.split("\n")) {
    if (stopAtSidecar.test(line)) break;
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

describe("env schema ↔ deployment manifest parity", () => {
  it("the valid baseline env parses (sanity check for the drop-one probe)", () => {
    expect(workerEnvSchema.safeParse(validK8sEnv).success).toBe(true);
  });

  it("GKE worker manifest provides every env the kubernetes backend requires", () => {
    const manifest = readFileSync(
      join(repoRoot, "infra/gcp/gke/worker.deployment.yaml"),
      "utf8",
    );
    const provided = containerEnvNames(manifest, /^\s+- name: cloudsql-proxy\b/);
    const missing = requiredKubernetesEnvKeys().filter((k) => !provided.has(k));
    expect(
      missing,
      `worker.deployment.yaml is missing required env (worker would crashloop on boot): ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("web Cloud Run manifest sets EXECUTION_BACKEND so advanced-mode gating matches the worker", () => {
    const manifest = readFileSync(join(repoRoot, "infra/gcp/web.cloudrun.yaml"), "utf8");
    expect(containerEnvNames(manifest, /\0/).has("EXECUTION_BACKEND")).toBe(true);
  });
});
