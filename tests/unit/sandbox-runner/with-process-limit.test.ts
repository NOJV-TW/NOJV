import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withProcessLimit } from "../../../apps/sandbox-runner/src/utils.js";

describe("withProcessLimit", () => {
  let savedNproc: string | undefined;

  beforeEach(() => {
    savedNproc = process.env.SANDBOX_NPROC_LIMIT;
    delete process.env.SANDBOX_NPROC_LIMIT;
  });

  afterEach(() => {
    if (savedNproc === undefined) delete process.env.SANDBOX_NPROC_LIMIT;
    else process.env.SANDBOX_NPROC_LIMIT = savedNproc;
  });

  it("returns the command unchanged when neither limit applies", () => {
    expect(withProcessLimit(["python3", "sol.py"])).toEqual(["python3", "sol.py"]);
  });

  it("wraps with ulimit -t when cpuSeconds is provided", () => {
    const wrapped = withProcessLimit(["python3", "sol.py"], { cpuSeconds: 3 });
    expect(wrapped[0]).toBe("bash");
    expect(wrapped[1]).toBe("-c");
    const script = wrapped[2]!;
    expect(script).toContain("ulimit -t 3");
    expect(script).not.toContain("ulimit -u");
    expect(script).toMatch(/exec "\$@"$/);
    expect(wrapped.slice(3)).toEqual(["--", "python3", "sol.py"]);
  });

  it("rounds up fractional cpuSeconds", () => {
    const wrapped = withProcessLimit(["x"], { cpuSeconds: 2.1 });
    expect(wrapped[2]).toContain("ulimit -t 3");
  });

  it("omits ulimit -t when cpuSeconds is absent or non-positive", () => {
    expect(withProcessLimit(["x"])).toEqual(["x"]);
    expect(withProcessLimit(["x"], {})).toEqual(["x"]);
    expect(withProcessLimit(["x"], { cpuSeconds: 0 })).toEqual(["x"]);
  });

  it("sets ulimit -u from the env and ulimit -t together", () => {
    process.env.SANDBOX_NPROC_LIMIT = "64";
    const wrapped = withProcessLimit(["python3", "sol.py"], { cpuSeconds: 5 });
    const script = wrapped[2]!;
    expect(script).toContain("ulimit -u 64");
    expect(script).toContain("ulimit -t 5");
    expect(script).toMatch(/exec "\$@"$/);
  });

  it("sets only ulimit -u when the env is set and no cpuSeconds", () => {
    process.env.SANDBOX_NPROC_LIMIT = "64";
    const wrapped = withProcessLimit(["python3", "sol.py"]);
    const script = wrapped[2]!;
    expect(script).toContain("ulimit -u 64");
    expect(script).not.toContain("ulimit -t");
  });
});
