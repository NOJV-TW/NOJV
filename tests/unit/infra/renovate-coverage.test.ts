import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

interface CustomManager {
  managerFilePatterns: string[];
  matchStrings: string[];
  description: string;
}

const config = JSON.parse(readFileSync(".github/renovate.json", "utf8")) as {
  enabledManagers: string[];
  customManagers: CustomManager[];
};

const MANAGED_FILES = [
  "docs/runbooks/k8s-single-machine.md",
  "infra/gcp/gke/temporal/HA-PRODUCTION.md",
  "infra/charts/nojv/values.yaml",
];

describe("Renovate coverage", () => {
  it("replaces Dependabot for every ecosystem it covered", () => {
    expect(existsSync(".github/dependabot.yml")).toBe(false);
    expect(config.enabledManagers).toEqual(
      expect.arrayContaining(["npm", "github-actions", "dockerfile", "docker-compose"]),
    );
  });

  it.each(config.customManagers.map((manager) => [manager.description, manager] as const))(
    "%s still matches a pinned version",
    (_description, manager) => {
      const files = MANAGED_FILES.filter((file) =>
        manager.managerFilePatterns.some((pattern) =>
          new RegExp(pattern.slice(1, -1)).test(file),
        ),
      );
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        const matched = manager.matchStrings.some((source) => new RegExp(source).test(text));
        expect(matched, `${file} has no match for ${manager.description}`).toBe(true);
      }
    },
  );

  it("pins the Temporal chart wherever it is installed", () => {
    for (const file of [
      "docs/runbooks/k8s-single-machine.md",
      "infra/gcp/gke/temporal/HA-PRODUCTION.md",
    ]) {
      const text = readFileSync(file, "utf8");
      const installs =
        text.match(/helm upgrade --install temporal temporal\/temporal[^\n]*/g) ?? [];
      expect(installs.length).toBeGreaterThan(0);
      for (const line of installs) expect(line).toMatch(/--version \d+\.\d+\.\d+/);
    }
  });
});
