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
});
