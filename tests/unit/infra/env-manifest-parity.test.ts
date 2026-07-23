import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { workerEnvSchema } from "../../../apps/worker/src/env";
import { mailerEnvSchema } from "../../../packages/mailer/src/index";
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

const renderedCharts = new Map<string, string>();
function renderChart(valuesFile = "values-gke.yaml"): string {
  const cached = renderedCharts.get(valuesFile);
  if (cached) return cached;
  const gkeFixture =
    valuesFile === "values-gke.yaml"
      ? " -f tests/fixtures/helm/gke-production-config.yaml"
      : "";
  const rendered = execSync(
    `helm template nojv infra/charts/nojv -f infra/charts/nojv/${valuesFile} -f tests/fixtures/helm/immutable-image-digests.yaml${gkeFixture} -f tests/fixtures/helm/production-external-backups.yaml`,
    { cwd: repoRoot, encoding: "utf8" },
  );
  renderedCharts.set(valuesFile, rendered);
  return rendered;
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
};

function requiredKubernetesEnvKeys(): string[] {
  const required: string[] = [];
  for (const key of Object.keys(validK8sEnv)) {
    const withoutKey = Object.fromEntries(
      Object.entries(validK8sEnv).filter(([candidate]) => candidate !== key),
    );
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

const validProductionMailerEnv: Record<string, string> = {
  NODE_ENV: "production",
  MAILER_MODE: "smtp",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "465",
  SMTP_USER: "mailer@example.com",
  SMTP_PASS: "secret",
  SMTP_FROM: "NOJV <no-reply@example.com>",
  APP_BASE_URL: "https://nojv.example.com",
};

function requiredProductionMailerKeys(): string[] {
  return Object.keys(validProductionMailerEnv).filter((key) => {
    const without = Object.fromEntries(
      Object.entries(validProductionMailerEnv).filter(([candidate]) => candidate !== key),
    );
    return !mailerEnvSchema.safeParse(without).success;
  });
}

function requiredProductionStorageKeys(): string[] {
  const required: string[] = [];
  for (const key of Object.keys(validStorageEnv)) {
    if (key === "NODE_ENV") continue;
    const without = Object.fromEntries(
      Object.entries(validStorageEnv).filter(([candidate]) => candidate !== key),
    );
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
    it.skip("requires helm to render infra/charts/nojv", () => undefined);
  });
}

describe("env schema baseline (no helm required)", () => {
  it("the valid baseline env parses (sanity check for the drop-one probe)", () => {
    expect(workerEnvSchema.safeParse(validK8sEnv).success).toBe(true);
  });

  it("the production storage baseline parses (sanity check for the drop-one probe)", () => {
    expect(storageEnvSchema.safeParse(validStorageEnv).success).toBe(true);
  });

  it("the production mailer baseline parses (sanity check for the drop-one probe)", () => {
    expect(mailerEnvSchema.safeParse(validProductionMailerEnv).success).toBe(true);
  });

  it("the local env example is a valid explicit sink without stray SMTP config", () => {
    const mailerKeys = new Set([
      "NODE_ENV",
      "MAILER_MODE",
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_USER",
      "SMTP_PASS",
      "SMTP_FROM",
      "APP_BASE_URL",
    ]);
    const example = Object.fromEntries(
      readFileSync(join(repoRoot, ".env.example"), "utf8")
        .split("\n")
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map<[string, string]>((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        })
        .filter(([key]) => mailerKeys.has(key)),
    );
    expect(mailerEnvSchema.parse(example)).toMatchObject({
      NODE_ENV: "development",
      MAILER_MODE: "sink",
      APP_BASE_URL: "http://localhost:5173",
    });
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

  it("web Deployment does not ship advanced-mode build env (registry image-ref path needs none)", () => {
    const web = isolateDoc(renderChart(), "Deployment", "nojv-web");
    const names = containerEnvNames(web);
    expect(names.has("EXECUTION_BACKEND")).toBe(false);
    expect(names.has("ADVANCED_IMAGE_REGISTRY")).toBe(false);
  });
});

describe("Dockerfiles that frozen-install must ship the full pnpm workspace", () => {
  const workspaceManifest = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const patchBlock = /^patchedDependencies:\n((?: {2}.+\n)+)/m.exec(workspaceManifest);
  const hasPatches = Boolean(patchBlock?.[1]?.trim());
  const toolingManifests = readdirSync(join(repoRoot, "tooling"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `tooling/${entry.name}/package.json`)
    .sort();

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

  it.each(frozenInstallDockerfiles)(
    "%s prevents pnpm scripts from replacing the filtered frozen install",
    (file) => {
      const dockerfile = readFileSync(join(dockerDir, file), "utf8");
      const install = dockerfile.indexOf("RUN pnpm install");
      const disableAutoInstall = dockerfile.indexOf(
        "ENV pnpm_config_verify_deps_before_run=false",
      );
      const firstBuild = dockerfile.indexOf("RUN pnpm --filter");
      expect(disableAutoInstall).toBeGreaterThan(install);
      expect(disableAutoInstall).toBeLessThan(firstBuild);
    },
  );

  it.each(frozenInstallDockerfiles)(
    "%s copies every tooling workspace manifest before installing",
    (file) => {
      const dockerfile = readFileSync(join(dockerDir, file), "utf8");
      const beforeInstall = dockerfile.slice(0, dockerfile.indexOf("RUN pnpm install"));
      for (const manifest of toolingManifests) {
        expect(beforeInstall).toContain(`COPY ${manifest} `);
      }
    },
  );
});

describeHelm("production web secret parity across deploy surfaces", () => {
  const requiredWebEnv = ["S3_REGION"] as const;

  it.each(requiredWebEnv)("web Deployment provides %s", (key) => {
    const web = isolateDoc(renderChart(), "Deployment", "nojv-web");
    expect(containerEnvNames(web).has(key)).toBe(true);
  });
});

describeHelm("worker Kubernetes privilege boundaries", () => {
  it("enforces the restricted Pod Security profile in the sandbox namespace", () => {
    const namespace = isolateDoc(renderChart(), "Namespace", "nojv-sandbox");
    for (const mode of ["enforce", "audit", "warn"]) {
      expect(namespace).toContain(`pod-security.kubernetes.io/${mode}: restricted`);
      expect(namespace).toContain(`pod-security.kubernetes.io/${mode}-version: latest`);
    }
  });

  it("binds sandbox and registry permissions to separate worker identities", () => {
    const render = renderChart();
    const sandboxAccess = isolateDoc(render, "RoleBinding", "nojv-worker-judge-sandbox-access");
    const registryAccess = isolateDoc(
      render,
      "RoleBinding",
      "nojv-worker-platform-registry-gc-access",
    );

    expect(sandboxAccess).toContain("name: nojv-worker-judge");
    expect(sandboxAccess).not.toContain("name: nojv-worker-platform");
    expect(registryAccess).toContain("name: nojv-worker-platform");
    expect(registryAccess).not.toContain("name: nojv-worker-judge");
  });

  it("mounts API credentials only for workers that use the Kubernetes API", () => {
    const enabled = renderChart();
    const disabled = renderChart("values.yaml");
    const judge = isolateDoc(enabled, "Deployment", "nojv-worker");
    const enabledPlatform = isolateDoc(enabled, "Deployment", "nojv-worker-platform");
    const disabledPlatform = isolateDoc(disabled, "Deployment", "nojv-worker-platform");

    expect(judge).toContain("serviceAccountName: nojv-worker-judge");
    expect(judge).toContain("automountServiceAccountToken: true");
    expect(enabledPlatform).toContain("serviceAccountName: nojv-worker-platform");
    expect(enabledPlatform).toContain("automountServiceAccountToken: true");
    expect(disabledPlatform).toContain("automountServiceAccountToken: false");
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

describeHelm("mailer env schema ↔ chart deployment parity", () => {
  it.each(["values-gke.yaml", "values-single-machine.yaml"])(
    "%s configures web and platform worker for production SMTP only",
    (valuesFile) => {
      const rendered = renderChart(valuesFile);
      for (const name of ["nojv-web", "nojv-worker-platform"]) {
        const deployment = isolateDoc(rendered, "Deployment", name);
        const provided = containerEnvNames(deployment);
        const missing = requiredProductionMailerKeys().filter((key) => !provided.has(key));
        expect(
          missing,
          `${name} is missing production mailer env: ${missing.join(", ")}`,
        ).toEqual([]);
        expect(deployment).toContain("name: MAILER_MODE\n              value: smtp");
        expect(deployment).toContain('name: SMTP_PORT\n              value: "465"');
        for (const key of [
          "SMTP_HOST",
          "SMTP_USER",
          "SMTP_PASS",
          "SMTP_FROM",
          "APP_BASE_URL",
        ]) {
          const start = deployment.indexOf(`- name: ${key}`);
          const next = deployment.indexOf("\n            - name:", start + 1);
          const entry = deployment.slice(start, next === -1 ? undefined : next);
          expect(entry, `${name} ${key} must be a required secret reference`).toContain(
            `key: ${key}`,
          );
          expect(entry).not.toContain("optional: true");
        }
      }
    },
  );

  it.each(["values-gke.yaml", "values-single-machine.yaml"])(
    "%s keeps judge-only workers independent from mailer env",
    (valuesFile) => {
      const judge = isolateDoc(renderChart(valuesFile), "Deployment", "nojv-worker");
      const provided = containerEnvNames(judge);
      expect(provided.has("NODE_ENV")).toBe(true);
      for (const key of requiredProductionMailerKeys().filter((key) => key !== "NODE_ENV")) {
        expect(provided.has(key), `judge worker must not receive ${key}`).toBe(false);
      }
    },
  );

  it("documents every required SMTP secret with non-empty production placeholders", () => {
    const example = readFileSync(
      join(repoRoot, "infra/charts/nojv/secret.example.yaml"),
      "utf8",
    );
    expect(example).toContain('APP_BASE_URL: "https://nojv.example.com"');
    expect(example).toMatch(/SMTP_HOST: "[^"]+"/);
    expect(example).toMatch(/SMTP_USER: "[^"]+"/);
    expect(example).toMatch(/SMTP_PASS: "[^"]+"/);
    expect(example).toMatch(/SMTP_FROM: "[^"]+"/);
    expect(example).not.toMatch(/^\s+SMTP_PORT:/m);
  });

  it("allows network-policy-constrained platform workers to reach the SMTP port", () => {
    const policy = isolateDoc(
      renderChart("values-gke.yaml"),
      "NetworkPolicy",
      "platform-smtp-egress",
    );
    expect(policy).toContain("nojv-mailer: enabled");
    expect(policy).toContain("port: 465\n          protocol: TCP");
  });
});

describe("Flux release artifact atomicity", () => {
  it("packages one source identity and its images with the chart instead of HelmRelease inline values", () => {
    const helmRelease = readFileSync(join(repoRoot, "infra/flux/helmrelease.yaml"), "utf8");
    const gitRepository = readFileSync(
      join(repoRoot, "infra/flux/git-repository.yaml"),
      "utf8",
    );
    const workflow = readFileSync(join(repoRoot, ".github/workflows/build-images.yml"), "utf8");

    expect(helmRelease).toContain(
      "valuesFiles:\n        - infra/charts/nojv/values.yaml\n        - infra/charts/nojv/values-single-machine.yaml",
    );
    expect(helmRelease).toContain("reconcileStrategy: Revision");
    expect(helmRelease).toContain("timeout: 125m");
    expect(helmRelease).not.toContain("\n  values:\n    image:\n");
    expect(gitRepository).toContain("branch: deploy");
    expect(workflow).toContain("IMAGE_TAG: ${{ needs.prepare-release.outputs.image_tag }}");
    for (const component of ["web", "worker", "sandbox", "migrator"]) {
      expect(workflow).toContain(
        `IMAGE_DIGEST_${component.toUpperCase()}: \${{ needs.build-${component}.outputs.digest }}`,
      );
    }
    expect(workflow).toContain('node scripts/update-deploy-image-values.mjs "$VALUES_FILE"');
    expect(workflow).toContain('git add "$VALUES_FILE"');
    expect(workflow).toContain('DEPLOY_TAG="nojv-deploy-${IMAGE_TAG}"');
    expect(workflow).toContain(
      'git push --atomic "--force-with-lease=refs/heads/deploy:${DEPLOY_TIP}" origin',
    );
    expect(workflow).not.toContain("infra/flux/helmrelease.yaml");
  });
});
