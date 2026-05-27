import { describe, expect, it } from "vitest";

import { runProcess } from "../../../apps/sandbox-runner/src/judges/run-process.js";

describe("runProcess env forwarding", () => {
  it("forwards env vars to the child process", async () => {
    const result = await runProcess(
      ["node", "-e", "process.stdout.write(process.env.FOO ?? '')"],
      { timeoutMs: 5_000, env: { FOO: "bar" } },
    );
    expect(result.stdout).toBe("bar");
  });

  it("does not set the var when no env is passed", async () => {
    const result = await runProcess(
      ["node", "-e", "process.stdout.write(process.env.FOO ?? 'unset')"],
      { timeoutMs: 5_000 },
    );
    expect(result.stdout).toBe("unset");
  });

  it("reports a launch failure (spawnError) when a bash-wrapped command cannot exec", async () => {
    // cpuSeconds forces the bash ulimit wrapper; a missing binary fails inside
    // it (exit 126/127) rather than at spawn(). Must still surface as SE-able.
    const result = await runProcess(["/nonexistent/binary"], {
      timeoutMs: 5_000,
      cpuSeconds: 3,
    });
    expect(result.spawnError).toBe(true);
  });
});
