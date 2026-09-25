import { execFileSync, execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const releaseScript = join(repoRoot, "packages/db/prisma/scripts/deploy-release.sh");
const tempDirectories: string[] = [];

function makeHarness(): { bin: string; directory: string; events: string } {
  const directory = mkdtempSync(join(tmpdir(), "nojv-release-migrator-"));
  const bin = join(directory, "bin");
  const packageRoot = join(directory, "db");
  const packageBin = join(packageRoot, "node_modules/.bin");
  mkdirSync(packageBin, { recursive: true });
  cpSync(
    join(repoRoot, "packages/db/prisma/migrations"),
    join(packageRoot, "prisma/migrations"),
    { recursive: true },
  );
  mkdirSync(join(packageRoot, "prisma/scripts"), { recursive: true });
  cpSync(releaseScript, join(packageRoot, "prisma/scripts/deploy-release.sh"));
  const events = join(directory, "events.log");
  tempDirectories.push(directory);
  execFileSync("mkdir", ["-p", bin]);
  writeFileSync(join(bin, "prisma"), "#!/bin/sh\nexit 97\n", { mode: 0o755 });
  for (const [deployment, replicas] of [
    ["nojv-web", "2"],
    ["nojv-worker", "2"],
    ["nojv-worker-platform", "1"],
  ] as const) {
    writeFileSync(join(directory, `${deployment}.replicas`), replicas);
  }
  writeFileSync(join(directory, "hpa-target"), "nojv-web");

  writeFileSync(
    join(packageBin, "prisma"),
    `#!/bin/sh
set -eu
printf 'prisma %s\n' "$*" >> "$EVENT_LOG"
case "$*" in
  *"migrate status"*)
    [ "\${MIGRATIONS_PENDING:-true}" != true ] || exit 1
    ;;
  *"migrate deploy"*)
    for deployment in nojv-web nojv-worker nojv-worker-platform; do
      [ "$(cat "$HARNESS_DIR/$deployment.replicas")" = 0 ] || exit 96
    done
    [ "$(cat "$HARNESS_DIR/hpa-target")" = nojv-web-maintenance ] || \\
      [ "\${HPA_MISSING:-false}" = true ] || exit 95
    printf 'migrations exposed after drain\\n' >> "$EVENT_LOG"
    [ "\${MIGRATE_FAILS:-false}" != true ] || exit 9
    ;;
esac
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "setsid"),
    `#!/bin/sh
exec "$@"
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "timeout"),
    `#!/bin/sh
shift
exec "$@"
`,
    { mode: 0o755 },
  );

  writeFileSync(
    join(bin, "kubectl"),
    `#!/bin/sh
set -eu
printf 'kubectl %s\n' "$*" >> "$EVENT_LOG"
original="$*"
while [ "$1" != get ] && [ "$1" != scale ] && [ "$1" != patch ] && [ "$1" != annotate ]; do shift; done
verb="$1"
shift
case "$verb:$1" in
  get:deployment)
    deployment="$2"
    replicas="$(cat "$HARNESS_DIR/$deployment.replicas")"
    case "$original" in
      *"status.updatedReplicas"*)
        if [ "\${RELEASE_READY_FAILURE:-false}" = true ]; then
          printf '1 1 0 0'
        else
          printf '1 1 %s %s' "$replicas" "$replicas"
        fi
        ;;
      *"status.observedGeneration"*) printf '1 1 %s' "$replicas" ;;
      *"status.replicas"*) printf '%s %s' "$replicas" "$replicas" ;;
      *) printf '%s' "$replicas" ;;
    esac
    ;;
  get:pods)
    if [ "\${WRITER_POD_REMAINS:-false}" = true ]; then printf 'pod/old-writer'; fi
    ;;
  get:horizontalpodautoscaler)
    if [ "\${HPA_ERROR:-false}" = true ]; then echo forbidden >&2; exit 1; fi
    if [ "\${HPA_MISSING:-false}" = true ]; then exit 0; fi
    cat "$HARNESS_DIR/hpa-target"
    ;;
  scale:deployment)
    shift
    names=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --replicas=*) replicas="\${1#--replicas=}" ;;
        *) names="$names $1" ;;
      esac
      shift
    done
    for deployment in $names; do
      printf '%s' "$replicas" > "$HARNESS_DIR/$deployment.replicas"
    done
    ;;
  patch:horizontalpodautoscaler)
    case "$original" in
      *maintenance*) printf nojv-web-maintenance > "$HARNESS_DIR/hpa-target" ;;
      *) printf nojv-web > "$HARNESS_DIR/hpa-target" ;;
    esac
    ;;
esac
`,
    { mode: 0o755 },
  );
  chmodSync(join(bin, "prisma"), 0o755);
  chmodSync(join(bin, "kubectl"), 0o755);
  chmodSync(join(bin, "setsid"), 0o755);
  chmodSync(join(bin, "timeout"), 0o755);
  return { bin, directory, events };
}

function runRelease(
  harness: ReturnType<typeof makeHarness>,
  extraEnv: Record<string, string> = {},
) {
  return spawnSync("sh", [join(harness.directory, "db/prisma/scripts/deploy-release.sh")], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${harness.bin}:${process.env.PATH ?? ""}`,
      EVENT_LOG: harness.events,
      HARNESS_DIR: harness.directory,
      DATABASE_URL: "postgresql://unused",
      RELEASE_OPERATION: "upgrade",
      NAMESPACE: "nojv",
      WEB_DEPLOYMENT: "nojv-web",
      MAINTENANCE_DEPLOYMENT: "nojv-web-maintenance",
      WEB_HPA: "nojv-web",
      WEB_HPA_ENABLED: "true",
      WEB_POD_SELECTOR: "app.kubernetes.io/name=nojv-web,!nojv.tw/role",
      JUDGE_DEPLOYMENT: "nojv-worker",
      JUDGE_POD_SELECTOR: "app.kubernetes.io/name=nojv-worker",
      PLATFORM_DEPLOYMENT: "nojv-worker-platform",
      PLATFORM_POD_SELECTOR: "app.kubernetes.io/name=nojv-worker-platform",
      DRAIN_TIMEOUT_SECONDS: "5",
      RESTORE_TIMEOUT_SECONDS: "5",
      POLL_INTERVAL_SECONDS: "0",
      ...extraEnv,
    },
  });
}

function events(harness: ReturnType<typeof makeHarness>): string[] {
  return readFileSync(harness.events, "utf8").trim().split("\n");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("release migrator", () => {
  it("does not ask pnpm to create command shims on the read-only migrator filesystem", () => {
    expect(readFileSync(releaseScript, "utf8")).not.toContain("pnpm exec");
  });

  it("sets CDPATH explicitly without the ambiguous SC1007 assignment form", () => {
    const script = readFileSync(releaseScript, "utf8");
    expect(script).toContain("CDPATH='' cd --");
    expect(script).not.toContain("CDPATH= cd --");
  });

  it("renders the upgrade hook with S3, writable staging, and web HPA RBAC", () => {
    const render = execSync(
      [
        "helm template nojv infra/charts/nojv --is-upgrade",
        "-f infra/charts/nojv/values-gke.yaml",
        "-f tests/fixtures/helm/immutable-image-digests.yaml",
        "-f tests/fixtures/helm/gke-production-config.yaml",
        "-f tests/fixtures/helm/production-external-backups.yaml",
      ].join(" "),
      { cwd: repoRoot, encoding: "utf8" },
    );
    const migrator = render
      .split(/^---$/m)
      .find(
        (document) => /kind:\s*Job/.test(document) && /name:\s*nojv-migrator/.test(document),
      );
    const role = render
      .split(/^---$/m)
      .find(
        (document) =>
          /kind:\s*Role/.test(document) && /name:\s*nojv-web-maintenance/.test(document),
      );
    const schemaFence = render
      .split(/^---$/m)
      .find((document) => /kind:\s*ValidatingAdmissionPolicy/.test(document));
    const schemaFenceBinding = render
      .split(/^---$/m)
      .find((document) => /kind:\s*ValidatingAdmissionPolicyBinding/.test(document));
    const resource = (kind: string, name: string) =>
      render
        .split(/^---$/m)
        .find(
          (document) =>
            new RegExp(`kind:\\s*${kind}`).test(document) &&
            new RegExp(`^  name:\\s*${name}\\s*$`, "m").test(document),
        );

    for (const job of [migrator, resource("Job", "nojv-workloads-ready")]) {
      expect(job).toContain('KUBECONFIG="${TMPDIR:-/tmp}/kubeconfig"');
      expect(job).toContain(
        "certificate-authority: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
      );
      expect(job).toContain("server: https://kubernetes.default.svc");
      expect(job).toContain("tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token");
      expect(job).toContain('chmod 600 "$KUBECONFIG"');
    }
    expect(migrator).toMatch(/name: RELEASE_OPERATION\n\s+value: "upgrade"/);
    expect(resource("Job", "nojv-workloads-ready")).toContain(
      "helm.sh/hook: post-upgrade,post-rollback",
    );
    expect(resource("ServiceAccount", "nojv-web-maintenance")).toContain("post-rollback");
    expect(migrator).toMatch(/name: STATUS_TIMEOUT_SECONDS\n\s+value: "10"/);
    expect(migrator).toMatch(/name: KUBECTL_REQUEST_TIMEOUT_SECONDS\n\s+value: "5"/);
    for (const name of [
      "S3_ENDPOINT",
      "S3_ACCESS_KEY",
      "S3_SECRET_KEY",
      "S3_BUCKET",
      "S3_REGION",
    ]) {
      expect(migrator).toContain(`name: ${name}`);
    }
    expect(migrator).toMatch(/mountPath: \/tmp[\s\S]*emptyDir:/);
    expect(role).toContain('resources: ["deployments/scale"]');
    expect(role).toContain('resources: ["horizontalpodautoscalers"]');
    expect(schemaFence).toContain('resources: ["deployments"]');
    expect(schemaFence).not.toContain("deployments/scale");
    expect(schemaFence).toContain('"nojv.tw/schema-contract" in');
    expect(schemaFence).toContain('"nojv.tw/course-roster-contract" in');
    expect(schemaFence).toContain(
      'object.spec.template.metadata.labels["nojv.tw/course-roster-contract"] == "membership-v1"',
    );
    expect(schemaFence).toContain('"nojv.tw/problem-library-contract" in');
    expect(schemaFence).toContain(
      'object.spec.template.metadata.labels["nojv.tw/problem-library-contract"] == "problem-library-v1"',
    );
    const legacyFenceName = `nojv-schema-fence-${createHash("sha256").update("nojv/nojv").digest("hex").slice(0, 16)}`;
    expect(schemaFence).toContain(`name: ${legacyFenceName}-problem-library-v1\n`);
    expect(schemaFenceBinding).toContain(`policyName: ${legacyFenceName}-problem-library-v1\n`);
    expect(schemaFence).not.toContain("hook-succeeded");
    expect(schemaFenceBinding).not.toContain("hook-succeeded");
    expect(schemaFence).toContain("failurePolicy: Fail");
    expect(schemaFenceBinding).toContain("validationActions: [Deny]");
    for (const name of ["nojv-web", "nojv-worker", "nojv-worker-platform"]) {
      const deployment = resource("Deployment", name);
      expect(deployment).toMatch(/spec:\n\s+replicas: 0/);
      expect(deployment).toContain("nojv.tw/schema-contract: versioned-storage-v1");
      expect(deployment).toContain("nojv.tw/course-roster-contract: membership-v1");
      expect(deployment).toContain("nojv.tw/problem-library-contract: problem-library-v1");
    }
    expect(resource("HorizontalPodAutoscaler", "nojv-web")).toContain(
      "name: nojv-web-maintenance",
    );
  }, 15_000);

  it("rolls a migration-free release out without parking the workloads at zero", () => {
    const render = execSync(
      [
        "helm template nojv infra/charts/nojv --is-upgrade",
        "-f infra/charts/nojv/values-gke.yaml",
        "-f tests/fixtures/helm/immutable-image-digests.yaml",
        "-f tests/fixtures/helm/gke-production-config.yaml",
        "-f tests/fixtures/helm/production-external-backups.yaml",
        "--set migrator.releaseWindow=false",
      ].join(" "),
      { cwd: repoRoot, encoding: "utf8" },
    );
    const resource = (kind: string, name: string) =>
      render
        .split(/^---$/m)
        .find(
          (document) =>
            new RegExp(`kind:\\s*${kind}`).test(document) &&
            new RegExp(`^  name:\\s*${name}\\s*$`, "m").test(document),
        );

    for (const name of ["nojv-web", "nojv-worker", "nojv-worker-platform"]) {
      expect(resource("Deployment", name)).not.toMatch(/spec:\n\s+replicas: 0/);
    }
    expect(resource("HorizontalPodAutoscaler", "nojv-web")).not.toContain(
      "name: nojv-web-maintenance",
    );
    expect(resource("Job", "nojv-workloads-ready")).toMatch(
      /name: RELEASE_WINDOW\n\s+value: "false"/,
    );
  }, 15_000);

  it("restores drained workloads even when the release window flag says false", () => {
    const harness = makeHarness();
    writeFileSync(join(harness.directory, "hpa-target"), "nojv-web-maintenance");
    writeFileSync(join(harness.directory, "nojv-web.replicas"), "0");
    writeFileSync(join(harness.directory, "nojv-worker.replicas"), "0");
    writeFileSync(join(harness.directory, "nojv-worker-platform.replicas"), "0");

    const result = spawnSync(
      "sh",
      [join(repoRoot, "infra/charts/nojv/files/release-workloads.sh")],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${harness.bin}:${process.env.PATH ?? ""}`,
          EVENT_LOG: harness.events,
          HARNESS_DIR: harness.directory,
          RELEASE_WINDOW: "false",
          NAMESPACE: "nojv",
          WEB_DEPLOYMENT: "nojv-web",
          MAINTENANCE_DEPLOYMENT: "nojv-web-maintenance",
          WEB_HPA: "nojv-web",
          WEB_HPA_ENABLED: "true",
          WEB_READY_REPLICAS: "2",
          WEB_POD_SELECTOR: "app.kubernetes.io/name=nojv-web,!nojv.tw/role",
          JUDGE_DEPLOYMENT: "nojv-worker",
          JUDGE_READY_REPLICAS: "2",
          JUDGE_POD_SELECTOR: "app.kubernetes.io/name=nojv-worker",
          PLATFORM_DEPLOYMENT: "nojv-worker-platform",
          PLATFORM_READY_REPLICAS: "1",
          PLATFORM_POD_SELECTOR: "app.kubernetes.io/name=nojv-worker-platform",
          READY_TIMEOUT_SECONDS: "5",
          POLL_INTERVAL_SECONDS: "0",
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("drained by the migrator");
    expect(events(harness)).toContainEqual(
      expect.stringContaining("scale deployment nojv-web --replicas=2"),
    );
    expect(readFileSync(join(harness.directory, "hpa-target"), "utf8")).toBe("nojv-web");
  }, 15_000);

  it("leaves a migration-free release serving when the readiness check fails", () => {
    const harness = makeHarness();
    writeFileSync(join(harness.directory, "hpa-target"), "nojv-web");

    const result = spawnSync(
      "sh",
      [join(repoRoot, "infra/charts/nojv/files/release-workloads.sh")],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${harness.bin}:${process.env.PATH ?? ""}`,
          EVENT_LOG: harness.events,
          HARNESS_DIR: harness.directory,
          RELEASE_WINDOW: "false",
          RELEASE_READY_FAILURE: "true",
          NAMESPACE: "nojv",
          WEB_DEPLOYMENT: "nojv-web",
          MAINTENANCE_DEPLOYMENT: "nojv-web-maintenance",
          WEB_HPA: "nojv-web",
          WEB_HPA_ENABLED: "true",
          WEB_READY_REPLICAS: "2",
          WEB_POD_SELECTOR: "app.kubernetes.io/name=nojv-web,!nojv.tw/role",
          JUDGE_DEPLOYMENT: "nojv-worker",
          JUDGE_READY_REPLICAS: "2",
          JUDGE_POD_SELECTOR: "app.kubernetes.io/name=nojv-worker",
          PLATFORM_DEPLOYMENT: "nojv-worker-platform",
          PLATFORM_READY_REPLICAS: "1",
          PLATFORM_POD_SELECTOR: "app.kubernetes.io/name=nojv-worker-platform",
          READY_TIMEOUT_SECONDS: "1",
          POLL_INTERVAL_SECONDS: "0",
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(events(harness)).not.toContainEqual(expect.stringContaining("scale deployment"));
    expect(events(harness)).not.toContainEqual(
      expect.stringContaining("patch horizontalpodautoscaler"),
    );
    expect(readFileSync(join(harness.directory, "hpa-target"), "utf8")).toBe("nojv-web");
  });

  it("rejects Kubernetes versions without the GA admission fence API", () => {
    const result = spawnSync(
      "helm",
      [
        "template",
        "nojv",
        "infra/charts/nojv",
        "--kube-version",
        "1.29.0",
        "-f",
        "infra/charts/nojv/values-single-machine.yaml",
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("requires kubeVersion: >=1.30.0-0");
  });

  it("applies migrations only after draining every writer", () => {
    const harness = makeHarness();
    const result = runRelease(harness);
    expect(result.status, result.stderr).toBe(0);

    const log = events(harness);
    const drained = log.findIndex((line) =>
      line.includes("scale deployment nojv-web nojv-worker nojv-worker-platform --replicas=0"),
    );
    const migrated = log.findIndex((line) => line.includes("prisma migrate deploy"));
    expect(drained).toBeGreaterThanOrEqual(0);
    expect(migrated).toBeGreaterThan(drained);
    expect(log).toContain("migrations exposed after drain");

    writeFileSync(join(harness.directory, "nojv-web.replicas"), "2");
    writeFileSync(join(harness.directory, "nojv-worker.replicas"), "2");
    writeFileSync(join(harness.directory, "nojv-worker-platform.replicas"), "1");
    execFileSync("sh", [join(repoRoot, "infra/charts/nojv/files/release-workloads.sh")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${harness.bin}:${process.env.PATH ?? ""}`,
        EVENT_LOG: harness.events,
        HARNESS_DIR: harness.directory,
        NAMESPACE: "nojv",
        WEB_DEPLOYMENT: "nojv-web",
        MAINTENANCE_DEPLOYMENT: "nojv-web-maintenance",
        WEB_HPA: "nojv-web",
        WEB_HPA_ENABLED: "true",
        WEB_READY_REPLICAS: "2",
        WEB_POD_SELECTOR: "app.kubernetes.io/name=nojv-web,!nojv.tw/role",
        JUDGE_DEPLOYMENT: "nojv-worker",
        JUDGE_READY_REPLICAS: "2",
        JUDGE_POD_SELECTOR: "app.kubernetes.io/name=nojv-worker",
        PLATFORM_DEPLOYMENT: "nojv-worker-platform",
        PLATFORM_READY_REPLICAS: "1",
        PLATFORM_POD_SELECTOR: "app.kubernetes.io/name=nojv-worker-platform",
        READY_TIMEOUT_SECONDS: "5",
        POLL_INTERVAL_SECONDS: "0",
      },
    });
    expect(readFileSync(join(harness.directory, "hpa-target"), "utf8")).toBe("nojv-web");
    const releaseLog = events(harness);
    const releaseScale = releaseLog.findIndex((line) =>
      line.includes("scale deployment nojv-web --replicas=2"),
    );
    const enableHpa = releaseLog.findIndex(
      (line, index) => index > releaseScale && line.includes("patch horizontalpodautoscaler"),
    );
    expect(releaseScale).toBeGreaterThan(migrated);
    expect(enableHpa).toBeGreaterThan(releaseScale);
  }, 15_000);

  it("waits for the maintenance page to be available before draining web", () => {
    const harness = makeHarness();
    writeFileSync(join(harness.directory, "nojv-web-maintenance.replicas"), "1");
    const result = runRelease(harness);
    expect(result.status, result.stderr).toBe(0);

    const log = events(harness);
    const gate = log.findIndex(
      (line) =>
        line.includes("get deployment nojv-web-maintenance") &&
        line.includes("availableReplicas"),
    );
    const drained = log.findIndex((line) =>
      line.includes("scale deployment nojv-web nojv-worker nojv-worker-platform --replicas=0"),
    );
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(drained).toBeGreaterThan(gate);
  }, 15_000);

  it("leaves the release serving when the maintenance page never becomes available", () => {
    const harness = makeHarness();
    writeFileSync(join(harness.directory, "nojv-web-maintenance.replicas"), "0");
    const result = runRelease(harness, { MAINTENANCE_READY_TIMEOUT_SECONDS: "0" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Timed out waiting for the maintenance page");
    expect(events(harness)).not.toContainEqual(expect.stringContaining("--replicas=0"));
    expect(readFileSync(join(harness.directory, "nojv-web.replicas"), "utf8")).toBe("2");
    expect(readFileSync(join(harness.directory, "hpa-target"), "utf8")).toBe("nojv-web");
  }, 15_000);

  it("drains without a maintenance gate when the page was not rendered", () => {
    const harness = makeHarness();
    const result = runRelease(harness);
    expect(result.status, result.stderr).toBe(0);
    expect(events(harness)).not.toContainEqual(expect.stringContaining("availableReplicas"));
  }, 15_000);

  it("keeps the first HPA-enabled upgrade safe when the old release has no HPA", () => {
    const harness = makeHarness();
    const result = runRelease(harness, { HPA_MISSING: "true" });

    expect(result.status, result.stderr).toBe(0);
    expect(events(harness)).not.toContainEqual(
      expect.stringContaining("patch horizontalpodautoscaler"),
    );
    expect(result.stderr).toContain("is absent; continuing without HPA cutover");
  }, 15_000);

  it("does not treat an HPA API error as a missing HPA", () => {
    const harness = makeHarness();
    const result = runRelease(harness, { HPA_ERROR: "true" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unable to inspect HPA nojv-web");
  }, 15_000);

  it("re-enters maintenance when the post-upgrade workloads do not become ready", () => {
    const harness = makeHarness();
    writeFileSync(join(harness.directory, "hpa-target"), "nojv-web-maintenance");

    const result = spawnSync(
      "sh",
      [join(repoRoot, "infra/charts/nojv/files/release-workloads.sh")],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${harness.bin}:${process.env.PATH ?? ""}`,
          EVENT_LOG: harness.events,
          HARNESS_DIR: harness.directory,
          RELEASE_READY_FAILURE: "true",
          NAMESPACE: "nojv",
          WEB_DEPLOYMENT: "nojv-web",
          MAINTENANCE_DEPLOYMENT: "nojv-web-maintenance",
          WEB_HPA: "nojv-web",
          WEB_HPA_ENABLED: "true",
          WEB_READY_REPLICAS: "2",
          WEB_POD_SELECTOR: "app.kubernetes.io/name=nojv-web,!nojv.tw/role",
          JUDGE_DEPLOYMENT: "nojv-worker",
          JUDGE_READY_REPLICAS: "2",
          JUDGE_POD_SELECTOR: "app.kubernetes.io/name=nojv-worker",
          PLATFORM_DEPLOYMENT: "nojv-worker-platform",
          PLATFORM_READY_REPLICAS: "1",
          PLATFORM_POD_SELECTOR: "app.kubernetes.io/name=nojv-worker-platform",
          READY_TIMEOUT_SECONDS: "1",
          POLL_INTERVAL_SECONDS: "0",
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(events(harness)).toContainEqual(
      expect.stringContaining(
        "scale deployment nojv-web nojv-worker nojv-worker-platform --replicas=0",
      ),
    );
    expect(readFileSync(join(harness.directory, "hpa-target"), "utf8")).toBe(
      "nojv-web-maintenance",
    );
  });

  it("keeps workloads in maintenance when the migration run fails", () => {
    const harness = makeHarness();
    const result = runRelease(harness, { MIGRATE_FAILS: "true" });
    expect(result.status).toBe(9);

    const log = events(harness);
    expect(log).not.toContainEqual(
      expect.stringContaining("scale deployment nojv-web --replicas=2"),
    );
    expect(readFileSync(join(harness.directory, "nojv-web.replicas"), "utf8")).toBe("0");
    expect(result.stderr).toContain("compatibility may have changed");
  });

  it("retries a release that is already in maintenance", () => {
    const harness = makeHarness();
    writeFileSync(join(harness.directory, "hpa-target"), "nojv-web-maintenance");
    writeFileSync(join(harness.directory, "nojv-web.replicas"), "0");
    writeFileSync(join(harness.directory, "nojv-worker.replicas"), "0");
    writeFileSync(join(harness.directory, "nojv-worker-platform.replicas"), "0");

    const result = runRelease(harness);
    expect(result.status, result.stderr).toBe(0);
    expect(events(harness)).toContainEqual(expect.stringContaining("prisma migrate deploy"));
  });

  it("keeps migrations out of Prisma while an old writer pod remains", () => {
    const harness = makeHarness();
    const result = runRelease(harness, {
      WRITER_POD_REMAINS: "true",
      DRAIN_TIMEOUT_SECONDS: "1",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Timed out waiting for web and Temporal workers");
    expect(events(harness)).not.toContainEqual(
      expect.stringContaining("prisma migrate deploy"),
    );
  });

  it("drains writers on every release with pending migrations", () => {
    const harness = makeHarness();
    for (let run = 0; run < 2; run++) {
      expect(runRelease(harness).status).toBe(0);
    }
    expect(
      events(harness).filter((line) => line === "migrations exposed after drain"),
    ).toHaveLength(2);
  });

  it("releases without a maintenance window when no migrations are pending", () => {
    const harness = makeHarness();

    const result = runRelease(harness, { MIGRATIONS_PENDING: "false" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("without a maintenance window");

    const log = events(harness);
    expect(log).not.toContainEqual(expect.stringContaining("--replicas=0"));
    expect(log).not.toContainEqual(expect.stringContaining("patch horizontalpodautoscaler"));
    expect(log).not.toContainEqual(expect.stringContaining("prisma migrate deploy"));
  });
});
