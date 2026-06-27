import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

const rootDocs = ["AGENT.md", "README.md"];

// Living-doc trees whose intra-repo links must all resolve. docs/plans/ is
// deliberately excluded — archived plans carry historical links to code/docs
// that has since moved or been deleted.
const docTrees = [
  "docs/architecture",
  "docs/operations",
  "docs/product",
  "docs/runbooks",
  "docs/specs",
];

function markdownFilesUnder(dir: string): string[] {
  const abs = join(repoRoot, dir);
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry);
    if (statSync(full).isDirectory()) {
      out.push(...markdownFilesUnder(relative(repoRoot, full)));
    } else if (entry.endsWith(".md")) {
      out.push(relative(repoRoot, full));
    }
  }
  return out;
}

const checkedDocs = [...rootDocs, ...docTrees.flatMap(markdownFilesUnder)];

function relativeLinks(text: string): string[] {
  const links: string[] = [];
  for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = m[1].split("#")[0].trim();
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    links.push(target);
  }
  return links;
}

describe("docs link only to files that exist (doc-drift gate)", () => {
  for (const file of checkedDocs) {
    it(`${file}: every relative doc link resolves to a real path`, () => {
      const absFile = join(repoRoot, file);
      const dir = dirname(absFile);
      const links = relativeLinks(readFileSync(absFile, "utf8"));
      const broken = links.filter((target) => !existsSync(resolve(dir, target)));

      expect(broken, `${file} has dangling links: ${broken.join(", ")}`).toEqual([]);
    });
  }
});
