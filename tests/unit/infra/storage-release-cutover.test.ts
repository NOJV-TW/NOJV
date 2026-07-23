import { execFileSync, execSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const cutoverScript = join(repoRoot, "packages/db/prisma/scripts/deploy-release.sh");
const tempDirectories: string[] = [];

function makeHarness(): { bin: string; directory: string; events: string; status: string } {
  const directory = mkdtempSync(join(tmpdir(), "nojv-storage-cutover-"));
  const bin = join(directory, "bin");
  const events = join(directory, "events.log");
  const status = join(directory, "contract-status");
  const statusCalls = join(directory, "status-calls");
  tempDirectories.push(directory);
  execFileSync("mkdir", ["-p", bin]);
  writeFileSync(status, "pending");
  writeFileSync(statusCalls, "0");
  for (const [deployment, replicas] of [
    ["nojv-web", "2"],
    ["nojv-worker", "2"],
    ["nojv-worker-platform", "1"],
  ] as const) {
    writeFileSync(join(directory, `${deployment}.replicas`), replicas);
  }
  writeFileSync(join(directory, "hpa-target"), "nojv-web");
  writeFileSync(join(directory, "keda-paused"), "");

  writeFileSync(
    join(bin, "node"),
    `#!/bin/sh
set -eu
printf 'node %s stage=%s\n' "$*" "\${PRISMA_MIGRATIONS_PATH:-full}" >> "$EVENT_LOG"
case "$*" in
  *"storage-pointer-cutover.ts status"*)
    calls="$(( $(cat "$HARNESS_DIR/status-calls") + 1 ))"
    printf '%s' "$calls" > "$HARNESS_DIR/status-calls"
    if [ "\${STATUS_TIMEOUT_ON_CALL:-0}" -eq "$calls" ]; then exit 124; fi
    cat "$HARNESS_DIR/contract-status"
    ;;
  *"storage-pointer-cutover.ts backfill"*)
    [ "\${FAIL_STEP:-}" != backfill ]
    ;;
  *"storage-pointer-cutover.ts verify"*)
    [ "\${FAIL_STEP:-}" != verify ]
    ;;
  *"storage-pointer-cutover.ts preflight"*)
    [ "\${FAIL_STEP:-}" != preflight ]
    ;;
esac
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "prisma"),
    `#!/bin/sh
set -eu
printf 'prisma %s stage=%s\n' "$*" "\${PRISMA_MIGRATIONS_PATH:-full}" >> "$EVENT_LOG"
case "$*" in
  *"migrate resolve --rolled-back"*)
    printf pending > "$HARNESS_DIR/contract-status"
    ;;
  *"migrate deploy"*)
    if [ -z "\${PRISMA_MIGRATIONS_PATH:-}" ]; then
      case "\${FINAL_MIGRATE_RESULT:-success}" in
        pending-fail) exit 9 ;;
        applied-fail)
          printf applied > "$HARNESS_DIR/contract-status"
          exit 9
          ;;
        unsafe-fail)
          printf unsafe > "$HARNESS_DIR/contract-status"
          exit 9
          ;;
      esac
    fi
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
  get:pods) ;;
  get:horizontalpodautoscaler)
    cat "$HARNESS_DIR/hpa-target"
    ;;
  get:scaledobject)
    case "$original" in
      *jsonpath*) cat "$HARNESS_DIR/keda-paused" ;;
    esac
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
  annotate:scaledobject)
    case "$original" in
      *paused-replicas=0*) printf 0 > "$HARNESS_DIR/keda-paused" ;;
      *paused-replicas-*) : > "$HARNESS_DIR/keda-paused" ;;
    esac
    ;;
esac
`,
    { mode: 0o755 },
  );
  chmodSync(join(bin, "node"), 0o755);
  chmodSync(join(bin, "prisma"), 0o755);
  chmodSync(join(bin, "kubectl"), 0o755);
  chmodSync(join(bin, "setsid"), 0o755);
  chmodSync(join(bin, "timeout"), 0o755);
  return { bin, directory, events, status };
}

function runCutover(
  harness: ReturnType<typeof makeHarness>,
  extraEnv: Record<string, string> = {},
) {
  return spawnSync("sh", [cutoverScript], {
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
      WEB_HPA: "nojv-web",
      WEB_HPA_ENABLED: "true",
      WEB_POD_SELECTOR: "app.kubernetes.io/name=nojv-web",
      JUDGE_DEPLOYMENT: "nojv-worker",
      JUDGE_KEDA_SCALED_OBJECT: "nojv-worker",
      JUDGE_KEDA_ENABLED: "true",
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

describe("storage release cutover", () => {
  it("does not ask pnpm to create command shims on the read-only migrator filesystem", () => {
    const expand = readFileSync(
      join(repoRoot, "packages/db/prisma/scripts/deploy-expand.sh"),
      "utf8",
    );
    expect(readFileSync(cutoverScript, "utf8")).not.toContain("pnpm exec");
    expect(expand).not.toContain("pnpm exec");
  });

  it("sets CDPATH explicitly without the ambiguous SC1007 assignment form", () => {
    const expand = readFileSync(
      join(repoRoot, "packages/db/prisma/scripts/deploy-expand.sh"),
      "utf8",
    );
    expect(expand).toContain("CDPATH='' cd --");
    expect(expand).not.toContain("CDPATH= cd --");
  });

  it("renders the upgrade hook with S3, writable staging, and all autoscaler RBAC", () => {
    const render = execSync(
      [
        "helm template nojv infra/charts/nojv --is-upgrade",
        "-f infra/charts/nojv/values-gke.yaml",
        "-f tests/fixtures/helm/immutable-image-digests.yaml",
        "-f tests/fixtures/helm/gke-production-config.yaml",
        "-f tests/fixtures/helm/production-external-backups.yaml",
        "--set worker.judge.keda.enabled=true",
        "--set worker.judge.keda.prometheusAddress=http://prometheus",
        "--set worker.judge.keda.query=queue_depth",
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
            new RegExp(`name:\\s*${name}(?:\\s|$)`).test(document),
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
    expect(role).toContain('resources: ["scaledobjects"]');
    expect(schemaFence).toContain('resources: ["deployments"]');
    expect(schemaFence).not.toContain("deployments/scale");
    expect(schemaFence).toContain('"nojv.tw/schema-contract" in');
    expect(schemaFence).toContain("failurePolicy: Fail");
    expect(schemaFenceBinding).toContain("validationActions: [Deny]");
    for (const name of ["nojv-web", "nojv-worker", "nojv-worker-platform"]) {
      const deployment = resource("Deployment", name);
      expect(deployment).toMatch(/spec:\n\s+replicas: 0/);
      expect(deployment).toContain("nojv.tw/schema-contract: versioned-storage-v1");
    }
    expect(resource("HorizontalPodAutoscaler", "nojv-web")).toContain(
      "name: nojv-web-maintenance",
    );
    expect(resource("ScaledObject", "nojv-worker")).toContain(
      'autoscaling.keda.sh/paused-replicas: "0"',
    );
  }, 15_000);

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

  it("stages expand before draining and exposes contract only after every verification", () => {
    const harness = makeHarness();
    const result = runCutover(harness);
    expect(result.status, result.stderr).toBe(0);

    const log = events(harness);
    const staged = log.findIndex((line) => line.includes("prisma migrate deploy stage=/"));
    const drained = log.findIndex((line) =>
      line.includes("scale deployment nojv-web nojv-worker nojv-worker-platform --replicas=0"),
    );
    const backfill = log.findIndex((line) =>
      line.includes("storage-pointer-cutover.ts backfill"),
    );
    const verify = log.findIndex((line) => line.includes("storage-pointer-cutover.ts verify"));
    const preflight = log.findIndex((line) =>
      line.includes("storage-pointer-cutover.ts preflight"),
    );
    const contract = log.findLastIndex((line) =>
      line.includes("prisma migrate deploy stage=full"),
    );
    expect(staged).toBeGreaterThanOrEqual(0);
    expect(drained).toBeGreaterThan(staged);
    expect(backfill).toBeGreaterThan(drained);
    expect(verify).toBeGreaterThan(backfill);
    expect(preflight).toBeGreaterThan(verify);
    expect(contract).toBeGreaterThan(preflight);

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
        WEB_HPA: "nojv-web",
        WEB_HPA_ENABLED: "true",
        WEB_READY_REPLICAS: "2",
        WEB_POD_SELECTOR: "app.kubernetes.io/name=nojv-web",
        JUDGE_DEPLOYMENT: "nojv-worker",
        JUDGE_KEDA_SCALED_OBJECT: "nojv-worker",
        JUDGE_KEDA_ENABLED: "true",
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
    expect(readFileSync(join(harness.directory, "keda-paused"), "utf8")).toBe("");
    const releaseLog = events(harness);
    const releaseScale = releaseLog.findIndex((line) =>
      line.includes("scale deployment nojv-web --replicas=2"),
    );
    const enableHpa = releaseLog.findIndex(
      (line, index) => index > releaseScale && line.includes("patch horizontalpodautoscaler"),
    );
    expect(releaseScale).toBeGreaterThan(contract);
    expect(enableHpa).toBeGreaterThan(releaseScale);
  }, 15_000);

  it("re-enters maintenance when the post-upgrade workloads do not become ready", () => {
    const harness = makeHarness();
    writeFileSync(join(harness.directory, "hpa-target"), "nojv-web-maintenance");
    writeFileSync(join(harness.directory, "keda-paused"), "0");

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
          WEB_HPA: "nojv-web",
          WEB_HPA_ENABLED: "true",
          WEB_READY_REPLICAS: "2",
          WEB_POD_SELECTOR: "app.kubernetes.io/name=nojv-web",
          JUDGE_DEPLOYMENT: "nojv-worker",
          JUDGE_KEDA_SCALED_OBJECT: "nojv-worker",
          JUDGE_KEDA_ENABLED: "true",
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
    expect(readFileSync(join(harness.directory, "keda-paused"), "utf8")).toBe("0");
  });

  it("keeps workloads drained after backfill starts", () => {
    const harness = makeHarness();
    const result = runCutover(harness, { FAIL_STEP: "verify" });
    expect(result.status).not.toBe(0);

    const log = events(harness);
    expect(log).not.toContainEqual(expect.stringContaining("prisma migrate deploy stage=full"));
    expect(log).not.toContainEqual(
      expect.stringContaining("scale deployment nojv-web --replicas=2"),
    );
    expect(readFileSync(join(harness.directory, "nojv-web.replicas"), "utf8")).toBe("0");
    expect(result.stderr).toContain("compatibility may have changed");
  });

  it("drains and fails closed before backfill when the initial schema state is unsafe", () => {
    const harness = makeHarness();
    writeFileSync(harness.status, "unsafe");
    const result = runCutover(harness);
    expect(result.status).not.toBe(0);

    const log = events(harness);
    expect(log).not.toContainEqual(expect.stringContaining("stage=/"));
    expect(log).not.toContainEqual(
      expect.stringContaining("storage-pointer-cutover.ts backfill"),
    );
    expect(log).not.toContainEqual(expect.stringContaining("prisma migrate deploy stage=full"));
    expect(log).not.toContainEqual(
      expect.stringContaining("scale deployment nojv-web --replicas=2"),
    );
    expect(readFileSync(join(harness.directory, "nojv-web.replicas"), "utf8")).toBe("0");
    expect(result.stderr).toContain("legacy storage schema is intact");
  });

  it("fails closed when the contract transaction rolls back", () => {
    const harness = makeHarness();
    const result = runCutover(harness, { FINAL_MIGRATE_RESULT: "pending-fail" });
    expect(result.status).toBe(9);

    const log = events(harness);
    expect(log).not.toContainEqual(
      expect.stringContaining("scale deployment nojv-web --replicas=2"),
    );
    expect(readFileSync(join(harness.directory, "nojv-web.replicas"), "utf8")).toBe("0");
    expect(result.stderr).toContain("compatibility may have changed");
  });

  it("fails closed when the contract applied before a later migration failed", () => {
    const harness = makeHarness();
    const result = runCutover(harness, { FINAL_MIGRATE_RESULT: "applied-fail" });
    expect(result.status).toBe(9);
    expect(events(harness)).not.toContainEqual(
      expect.stringContaining("scale deployment nojv-web --replicas=2"),
    );
    expect(readFileSync(join(harness.directory, "nojv-web.replicas"), "utf8")).toBe("0");
    expect(result.stderr).toContain("keeping workloads in maintenance");
  });

  it("fails closed when physical schema state and migration history disagree", () => {
    const harness = makeHarness();
    const result = runCutover(harness, { FINAL_MIGRATE_RESULT: "unsafe-fail" });
    expect(result.status).toBe(9);
    expect(events(harness)).not.toContainEqual(
      expect.stringContaining("scale deployment nojv-web --replicas=2"),
    );
    expect(readFileSync(join(harness.directory, "nojv-web.replicas"), "utf8")).toBe("0");
    expect(result.stderr).toContain("keeping workloads in maintenance");
  });

  it("retries a post-contract release that is already in maintenance", () => {
    const harness = makeHarness();
    writeFileSync(harness.status, "applied");
    writeFileSync(join(harness.directory, "hpa-target"), "nojv-web-maintenance");
    writeFileSync(join(harness.directory, "keda-paused"), "0");
    writeFileSync(join(harness.directory, "nojv-web.replicas"), "0");
    writeFileSync(join(harness.directory, "nojv-worker.replicas"), "0");
    writeFileSync(join(harness.directory, "nojv-worker-platform.replicas"), "0");

    const result = runCutover(harness);
    expect(result.status, result.stderr).toBe(0);
    expect(events(harness)).toContainEqual(
      expect.stringContaining("prisma migrate deploy stage=full"),
    );
  });

  it("repairs a rolled-back contract record before staging migrations", () => {
    const harness = makeHarness();
    writeFileSync(harness.status, "recoverable");
    const result = runCutover(harness);
    expect(result.status, result.stderr).toBe(0);

    const log = events(harness);
    const resolved = log.findIndex((line) =>
      line.includes(
        "prisma migrate resolve --rolled-back 20260716000012_versioned_blob_pointers_contract",
      ),
    );
    const staged = log.findIndex((line) => line.includes("prisma migrate deploy stage=/"));
    expect(resolved).toBeGreaterThanOrEqual(0);
    expect(staged).toBeGreaterThan(resolved);
  });

  it("bounds the initial status probe before maintenance starts", () => {
    const harness = makeHarness();
    const result = runCutover(harness, { STATUS_TIMEOUT_ON_CALL: "1" });
    expect(result.status).not.toBe(0);
    expect(events(harness)).not.toContainEqual(
      expect.stringContaining(
        "scale deployment nojv-web nojv-worker nojv-worker-platform --replicas=0",
      ),
    );
  });
});
