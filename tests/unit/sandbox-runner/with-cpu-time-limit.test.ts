import { describe, expect, it } from "vitest";

import { withCpuTimeLimit } from "../../../apps/sandbox-runner/src/utils.js";

describe("withCpuTimeLimit", () => {
  it("returns the command unchanged without a positive CPU limit", () => {
    expect(withCpuTimeLimit(["python3", "sol.py"])).toEqual(["python3", "sol.py"]);
    expect(withCpuTimeLimit(["x"], {})).toEqual(["x"]);
    expect(withCpuTimeLimit(["x"], { cpuSeconds: 0 })).toEqual(["x"]);
  });

  it("wraps with a rounded-up ulimit -t", () => {
    const wrapped = withCpuTimeLimit(["python3", "sol.py"], { cpuSeconds: 2.1 });
    expect(wrapped[0]).toBe("bash");
    expect(wrapped[1]).toBe("-c");
    expect(wrapped[2]).toBe('ulimit -t 3; exec "$@"');
    expect(wrapped.slice(3)).toEqual(["--", "python3", "sol.py"]);
  });

  it("never applies a host-UID-wide process limit", () => {
    process.env.SANDBOX_NPROC_LIMIT = "64";
    try {
      expect(withCpuTimeLimit(["python3", "sol.py"])).toEqual(["python3", "sol.py"]);
      expect(withCpuTimeLimit(["python3", "sol.py"], { cpuSeconds: 5 })[2]).not.toContain(
        "ulimit -u",
      );
    } finally {
      delete process.env.SANDBOX_NPROC_LIMIT;
    }
  });
});
