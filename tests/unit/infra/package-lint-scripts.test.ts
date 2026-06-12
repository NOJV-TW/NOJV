import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

function workspacePackageJsons(): { name: string; scripts: Record<string, string> }[] {
  const out: { name: string; scripts: Record<string, string> }[] = [];
  for (const group of ["packages", "apps"]) {
    const groupDir = join(repoRoot, group);
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = join(groupDir, entry.name, "package.json");
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        name?: string;
        scripts?: Record<string, string>;
      };
      out.push({ name: pkg.name ?? `${group}/${entry.name}`, scripts: pkg.scripts ?? {} });
    }
  }
  return out;
}

describe("workspace lint coverage", () => {
  // turbo silently skips packages without a lint script, so a package with TS
  // source (proxied by a typecheck script) must also carry a lint script —
  // otherwise it is never linted (the @nojv/temporal / sandbox-runner gap).
  it("every package that has a typecheck script also has a lint script", () => {
    const missing = workspacePackageJsons()
      .filter((p) => p.scripts.typecheck && !p.scripts.lint)
      .map((p) => p.name);
    expect(missing).toEqual([]);
  });
});
