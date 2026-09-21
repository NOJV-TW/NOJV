import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { buildNetpolProbePodManifest } from "../../../apps/worker/src/services/k8s-netpol-probe";

const execute = promisify(execFile);

async function runProbeShell(allowedFailures: number, deniedReached: boolean) {
  const directory = await mkdtemp(join(tmpdir(), "nojv-netpol-shell-"));
  try {
    await writeFile(
      join(directory, "wget"),
      `#!/bin/sh
case "$*" in
  *10.0.0.10:8080*)
    count=0
    [ ! -f "$PROBE_TEST_DIR/allowed" ] || count=$(cat "$PROBE_TEST_DIR/allowed")
    count=$((count+1))
    echo "$count" > "$PROBE_TEST_DIR/allowed"
    [ "$count" -gt "$PROBE_TEST_ALLOWED_FAILURES" ]
    ;;
  *10.0.0.11:8080*)
    echo denied >> "$PROBE_TEST_DIR/denied"
    [ "$PROBE_TEST_DENIED_REACHED" = true ]
    ;;
  *) exit 99 ;;
esac
`,
      { mode: 0o700 },
    );
    await writeFile(
      join(directory, "sleep"),
      '#!/bin/sh\necho "$1" >> "$PROBE_TEST_DIR/delays"\n',
      { mode: 0o700 },
    );
    const pod = buildNetpolProbePodManifest({
      namespace: "nojv-sandbox-test-shell",
      image: "unused",
      podName: "probe",
      allowedTargetIp: "10.0.0.10",
      deniedTargetIp: "10.0.0.11",
    });
    const { stdout } = await execute("sh", ["-c", pod.spec!.containers[0]!.command![2]!], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH ?? ""}`,
        PROBE_TEST_DIR: directory,
        PROBE_TEST_ALLOWED_FAILURES: String(allowedFailures),
        PROBE_TEST_DENIED_REACHED: String(deniedReached),
      },
      timeout: 5_000,
    });
    const lines = async (name: string) =>
      (await readFile(join(directory, name), "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean);
    return {
      markers: stdout.trim().split("\n"),
      allowedAttempts: Number((await lines("allowed"))[0]),
      deniedAttempts: (await lines("denied")).length,
      delays: await lines("delays"),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("NetworkPolicy probe shell", () => {
  it("bounds failed positive controls and never runs the denied probe", async () => {
    expect(await runProbeShell(3, false)).toEqual({
      markers: ["ALLOWED_BLOCKED"],
      allowedAttempts: 3,
      deniedAttempts: 0,
      delays: ["1", "1"],
    });
  });

  it("retries transient positive failures before one denied control", async () => {
    expect(await runProbeShell(2, false)).toEqual({
      markers: ["ALLOWED_REACHED", "DENIED_BLOCKED"],
      allowedAttempts: 3,
      deniedAttempts: 1,
      delays: ["1", "1"],
    });
  });

  it("does not retry a reachable denied target", async () => {
    expect(await runProbeShell(0, true)).toEqual({
      markers: ["ALLOWED_REACHED", "DENIED_REACHED"],
      allowedAttempts: 1,
      deniedAttempts: 1,
      delays: [],
    });
  });
});
