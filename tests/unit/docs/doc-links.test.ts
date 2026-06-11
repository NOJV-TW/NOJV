import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

const indexDocs = ["AGENT.md", "docs/runbooks/README.md"];

function relativeLinks(text: string): string[] {
  const links: string[] = [];
  for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = m[1].split("#")[0].trim();
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    links.push(target);
  }
  return links;
}

describe("index docs link only to files that exist (doc-drift gate)", () => {
  for (const file of indexDocs) {
    it(`${file}: every relative doc link resolves to a real path`, () => {
      const absFile = join(repoRoot, file);
      const dir = dirname(absFile);
      const links = relativeLinks(readFileSync(absFile, "utf8"));
      const broken = links.filter((target) => !existsSync(resolve(dir, target)));

      expect(links.length).toBeGreaterThan(0);
      expect(broken, `${file} has dangling links: ${broken.join(", ")}`).toEqual([]);
    });
  }
});
