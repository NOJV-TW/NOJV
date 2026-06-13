import { describe, expect, it } from "vitest";

import {
  problemCreateSchema,
  requiredPathSchema,
  requiredPathsSchema,
  validateRequiredPaths,
} from "../../../packages/core/src/index";

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

  it("folder requirement is NOT satisfied by a literal directory entry", () => {
    const result = validateRequiredPaths(["src/"], ["src/"]);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ kind: "missing_folder", path: "src/" }]);
  });
});

describe("requiredPathSchema", () => {
  it.each([["src/main.c"], ["src/"], ["Makefile"], ["a.b-c_d/e.f"], ["file with space"]])(
    "accepts %s",
    (path) => {
      expect(requiredPathSchema.safeParse(path).success).toBe(true);
    },
  );

  it("rejects '..' (parent traversal)", () => {
    expect(requiredPathSchema.safeParse("..").success).toBe(false);
  });

  it("rejects path traversal segments anywhere in the string", () => {
    expect(requiredPathSchema.safeParse("src/../etc/passwd").success).toBe(false);
  });

  it("rejects absolute (leading-slash) paths", () => {
    expect(requiredPathSchema.safeParse("/abs/path").success).toBe(false);
  });

  it("rejects dot segments", () => {
    expect(requiredPathSchema.safeParse("./main.c").success).toBe(false);
    expect(requiredPathSchema.safeParse("src/./main.c").success).toBe(false);
  });

  it("rejects colon characters", () => {
    expect(requiredPathSchema.safeParse("a:b").success).toBe(false);
  });

  it("rejects empty strings", () => {
    expect(requiredPathSchema.safeParse("").success).toBe(false);
  });

  it("rejects paths longer than 300 characters", () => {
    expect(requiredPathSchema.safeParse("a".repeat(301)).success).toBe(false);
  });
});

describe("requiredPathsSchema", () => {
  it("accepts up to 50 valid paths", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `f${i}.c`);
    expect(requiredPathsSchema.safeParse(fifty).success).toBe(true);
  });

  it("rejects an array of 51 paths", () => {
    const fiftyOne = Array.from({ length: 51 }, (_, i) => `f${i}.c`);
    expect(requiredPathsSchema.safeParse(fiftyOne).success).toBe(false);
  });
});

describe("problemCreateSchema integration with advancedRequiredPaths", () => {
  const baseProblemInput = {
    difficulty: "easy",
    inputFormat: "n",
    memoryLimitMb: 256,
    outputFormat: "n",
    statement: "Compute n.",
    tags: [],
    timeLimitMs: 1000,
    title: "Sample",
    visibility: "public",
  } as const;

  it("rejects non-special_env problems with a non-empty advancedRequiredPaths", () => {
    const result = problemCreateSchema.safeParse({
      ...baseProblemInput,
      type: "full_source",
      advancedRequiredPaths: ["src/main.c"],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const hasGuardIssue = result.error.issues.some(
        (issue) =>
          issue.path.length === 1 &&
          issue.path[0] === "advancedRequiredPaths" &&
          issue.message === "validation_onlyAllowedForSpecialEnv",
      );
      expect(hasGuardIssue).toBe(true);
    }
  });

  it("accepts special_env problems with a non-empty advancedRequiredPaths", () => {
    const result = problemCreateSchema.safeParse({
      ...baseProblemInput,
      type: "special_env",
      advancedImageRef: "ghcr.io/example/judge:1.0.0",
      advancedImageSource: "registry",
      advancedRequiredPaths: ["src/main.c", "src/"],
    });

    expect(result.success).toBe(true);
  });
});
