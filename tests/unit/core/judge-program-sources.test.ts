import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CPP_STANDARD_HEADER_INCLUDES,
  PYTHON_INTERACTOR_WRAPPER,
  PYTHON_VALIDATOR_WRAPPER,
  cppStandardHeader,
} from "@nojv/core";

const wrappersDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../apps/sandbox-runner/assets/wrappers",
);

describe("DOMjudge Python wrappers", () => {
  it.each([
    ["python-validator.py", PYTHON_VALIDATOR_WRAPPER],
    ["python-interactor-domjudge.py", PYTHON_INTERACTOR_WRAPPER],
  ])("matches the sandbox runner's %s byte for byte", (file, wrapper) => {
    expect(wrapper).toBe(readFileSync(join(wrappersDir, file), "utf8"));
  });
});

describe("platform bits/stdc++.h shim", () => {
  it("is the libc++ PCH header followed by the remaining standard headers", () => {
    expect(cppStandardHeader("#pragma once\n")).toBe(
      `#pragma once\n\n${CPP_STANDARD_HEADER_INCLUDES}`,
    );
  });

  it("lists only standard header includes, one per line", () => {
    const lines = CPP_STANDARD_HEADER_INCLUDES.split("\n");

    expect(lines.pop()).toBe("");
    expect(lines.every((line) => /^#include <[a-z_]+>$/.test(line))).toBe(true);
    expect(lines.at(0)).toBe("#include <any>");
    expect(lines.at(-1)).toBe("#include <version>");
  });
});
