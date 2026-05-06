import { describe, expect, it } from "vitest";

import { validateRequiredPaths } from "../../../packages/core/src/index";

describe("validateRequiredPaths", () => {
  it("returns ok when every required file is uploaded", () => {
    const result = validateRequiredPaths(
      ["src/main.c", "src/utils.c", "Makefile"],
      ["src/main.c", "Makefile"],
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("reports a missing_file error when one required file is absent", () => {
    const result = validateRequiredPaths(["src/main.c"], ["src/main.c", "Makefile"]);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ kind: "missing_file", path: "Makefile" }]);
  });

  it("treats a trailing-slash entry as a folder requirement satisfied by a nested file", () => {
    const result = validateRequiredPaths(["src/utils/foo.c"], ["src/"]);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("reports missing_folder when no upload starts with the folder prefix", () => {
    const result = validateRequiredPaths(["docs/readme.md"], ["src/"]);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ kind: "missing_folder", path: "src/" }]);
  });

  it("treats a folder requirement as satisfied by an exact-prefix file", () => {
    const result = validateRequiredPaths(["src/main.c"], ["src/"]);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("returns ok when requiredPaths is empty regardless of uploads", () => {
    expect(validateRequiredPaths([], []).ok).toBe(true);
    expect(validateRequiredPaths(["src/main.c"], []).ok).toBe(true);
    expect(validateRequiredPaths(["src/main.c"], []).errors).toEqual([]);
  });

  it("requires exact match for files (substring/suffix is not enough)", () => {
    const result = validateRequiredPaths(["src/main.c"], ["main.c"]);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ kind: "missing_file", path: "main.c" }]);
  });
});
