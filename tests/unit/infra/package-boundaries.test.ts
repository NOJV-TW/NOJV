import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

const ALLOWED: Record<string, string[]> = {
  core: [],
  db: [],
  redis: ["@nojv/core"],
  storage: ["@nojv/core"],
  "sandbox-docker": [],
  application: [
    "@nojv/core",
    "@nojv/db",
    "@nojv/redis",
    "@nojv/storage",
    "@nojv/sandbox-docker",
    "@nojv/mailer",
  ],
  temporal: ["@nojv/core"],
};

function nojvImportsOf(pkg: string): Map<string, string> {
  const files = globSync(`packages/${pkg}/src/**/*.ts`, { cwd: repoRoot });
  const found = new Map<string, string>();
  for (const rel of files) {
    const source = readFileSync(join(repoRoot, rel), "utf8");
    for (const m of source.matchAll(/@nojv\/[a-z-]+/g)) {
      const dep = m[0];
      if (!found.has(dep)) found.set(dep, rel);
    }
  }
  return found;
}

describe("package dependency boundaries (ARCHITECTURE.md Dependency Rules)", () => {
  for (const [pkg, allowed] of Object.entries(ALLOWED)) {
    it(`@nojv/${pkg} only imports its allowed packages`, () => {
      const found = nojvImportsOf(pkg);
      const violations = [...found.entries()]
        .filter(([dep]) => dep !== `@nojv/${pkg}` && !allowed.includes(dep))
        .map(([dep, file]) => `${dep} (in ${file})`);
      expect(violations, `@nojv/${pkg} must not import: ${violations.join(", ")}`).toEqual([]);
    });
  }
});
