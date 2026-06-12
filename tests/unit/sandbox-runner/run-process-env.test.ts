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
    const result = await runProcess(["/nonexistent/binary"], {
      timeoutMs: 5_000,
      cpuSeconds: 3,
    });
    expect(result.spawnError).toBe(true);
  });

  it("keeps a genuine RE when a program spoofs the exec-failure stderr but exits non-126/127", async () => {
    const result = await runProcess(
      [
        "node",
        "-e",
        String.raw`process.stderr.write('exec: foo: cannot execute\n'); process.exit(1)`,
      ],
      { timeoutMs: 5_000, cpuSeconds: 3 },
    );
    expect(result.spawnError).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});
