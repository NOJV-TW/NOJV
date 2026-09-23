import { describe, expect, it } from "vitest";

import { runProcess } from "../../../apps/sandbox-runner/src/judges/run-process.js";

const spin = (ms: number) =>
  `const end = process.cpuUsage().user + ${String(ms * 1000)}; while (process.cpuUsage().user < end);`;

describe("runProcess through nojv-exec", () => {
  it("charges only the program, not the runner", async () => {
    const result = await runProcess(["/bin/sh", "-c", "exit 0"], { timeoutMs: 5_000 });
    expect(result.exitCode).toBe(0);
    expect(result.timeMs).toBeLessThan(50);
  });

  it("counts CPU used by child processes", async () => {
    const result = await runProcess(
      [
        process.execPath,
        "-e",
        `require("node:child_process").execFileSync(process.execPath, ["-e", ${JSON.stringify(spin(400))}])`,
      ],
      { timeoutMs: 5_000 },
    );
    expect(result.exitCode).toBe(0);
    expect(result.timeMs).toBeGreaterThanOrEqual(400);
  });

  it("stops a program at its CPU limit with SIGXCPU", async () => {
    const result = await runProcess(["/bin/sh", "-c", "while :; do :; done"], {
      timeoutMs: 1_000,
      cpuSeconds: 1,
    });
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe("SIGXCPU");
    expect(result.timeMs).toBeGreaterThanOrEqual(900);
    expect(result.timeMs).toBeLessThan(1_500);
  });

  it("kills a program that sleeps past the wall budget", async () => {
    const started = Date.now();
    const result = await runProcess(["sleep", "10"], { timeoutMs: 200 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("reports peak resident memory", async () => {
    const result = await runProcess(
      [process.execPath, "-e", "Buffer.alloc(128 * 1024 * 1024, 1)"],
      { timeoutMs: 5_000 },
    );
    expect(result.exitCode).toBe(0);
    expect(result.memoryKb).toBeGreaterThanOrEqual(128 * 1024);
  });

  it.runIf(process.platform === "linux")(
    "leaves no descendant alive, even one that left the session",
    async () => {
      const result = await runProcess(
        ["sh", "-c", "setsid sh -c 'echo $$; exec sleep 30' & sleep 0.3"],
        { timeoutMs: 5_000 },
      );
      const pid = Number(result.stdout.trim());
      expect(pid).toBeGreaterThan(0);
      expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
    },
  );
});
