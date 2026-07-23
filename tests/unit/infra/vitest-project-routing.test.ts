import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import vitestConfig from "../../../vitest.config";

interface TestProject {
  test?: {
    name?: string;
    include?: string[];
    exclude?: string[];
    globalSetup?: string[];
  };
}

const K8S_TEST_GLOB = "tests/integration/k8s/**/*.test.ts";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

afterEach(() => vi.unstubAllEnvs());

function project(name: string): TestProject {
  const projects = vitestConfig.test?.projects as TestProject[];
  const result = projects.find((candidate) => candidate.test?.name === name);
  if (!result) throw new Error(`missing Vitest project ${name}`);
  return result;
}

describe("Vitest project routing", () => {
  it("caps worker concurrency to protect developer machines", () => {
    expect(vitestConfig.test?.maxWorkers).toBe("50%");
  });

  it("keeps K8s tests out of ordinary integration", () => {
    expect(project("integration").test).toMatchObject({
      include: ["tests/integration/**/*.test.ts"],
      exclude: [K8S_TEST_GLOB],
    });
    expect(project("k8s-integration").test).toMatchObject({
      include: [K8S_TEST_GLOB],
      globalSetup: ["tests/setup/k8s-global-setup.ts"],
    });
  });

  it("uses explicit package and Nightly entry points", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const nightly = readFileSync(
      join(repoRoot, ".github/workflows/nightly-sandbox.yml"),
      "utf8",
    );

    expect(packageJson.scripts["test:integration:k8s"]).toBe(
      "vitest run --project k8s-integration",
    );
    expect(packageJson.scripts["test:coverage"]).toBe(
      "vitest run --coverage --project unit --project integration",
    );
    expect(nightly).toContain("run: pnpm test:integration:k8s");
    expect(nightly).not.toContain("run: pnpm vitest run tests/integration/k8s");
  });

  it("fails closed before a K8s project runs without explicit opt-in", async () => {
    const { default: globalSetup } = await import("../../setup/k8s-global-setup");

    vi.stubEnv("REQUIRE_K8S", "");
    expect(globalSetup).toThrow(/REQUIRE_K8S=1/);
    vi.stubEnv("REQUIRE_K8S", "1");
    expect(globalSetup).not.toThrow();
  });
});
