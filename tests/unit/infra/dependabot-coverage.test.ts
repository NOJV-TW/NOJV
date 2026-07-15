import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("Dependabot manifest coverage", () => {
  it("scans every directory containing a production Docker or Compose manifest", () => {
    const config = readFileSync(join(repoRoot, ".github/dependabot.yml"), "utf8");
    const directories = [
      "/",
      "/infra/docker",
      "/infra/docker/demo-advanced-grade",
      "/infra/docker/demo-advanced-run",
      "/apps/web/src/lib/server/advanced-scaffold/files/grade",
      "/apps/web/src/lib/server/advanced-scaffold/files/run",
      "/apps/web/src/lib/server/advanced-scaffold/files/service",
    ];

    expect(config).toContain('package-ecosystem: "docker"');
    expect(config).toContain("directories:");
    expect(config).toContain("group-by: dependency-name");
    for (const directory of directories) {
      expect(config).toContain(`- "${directory}"`);
    }
  });
});
