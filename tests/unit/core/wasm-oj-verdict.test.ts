import { describe, expect, it } from "vitest";

import { wasmOjTerminationVerdict } from "@nojv/core";

describe("wasmOjTerminationVerdict", () => {
  it.each(["instruction-limit", "logical-time-limit", "wall-time-limit"])(
    "maps %s to TLE",
    (termination) => {
      expect(wasmOjTerminationVerdict(termination, 0)).toBe("TLE");
    },
  );

  it("maps memory-limit to MLE", () => {
    expect(wasmOjTerminationVerdict("memory-limit", 0)).toBe("MLE");
  });

  it("maps a clean exit to AC", () => {
    expect(wasmOjTerminationVerdict("exited", 0)).toBe("AC");
  });

  it("maps a non-zero exit to RE", () => {
    expect(wasmOjTerminationVerdict("exited", 1)).toBe("RE");
    expect(wasmOjTerminationVerdict("exited", -1)).toBe("RE");
  });

  it.each(["trap", "output-limit", "filesystem-limit"])("maps %s to RE", (termination) => {
    expect(wasmOjTerminationVerdict(termination, 0)).toBe("RE");
  });
});
