import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

const rootDocs = [
  "AGENTS.md",
  "README.md",
  "docs/README.md",
  "docs/plans/README.md",
  "apps/README.md",
  "apps/web/README.md",
  "apps/worker/README.md",
  "apps/sandbox-runner/README.md",
  "packages/README.md",
  "packages/application/README.md",
  "packages/core/README.md",
  "packages/db/README.md",
  "packages/mailer/README.md",
  "packages/redis/README.md",
  "packages/storage/README.md",
  "packages/temporal/README.md",
  "packages/sandbox-docker/README.md",
  "tests/README.md",
  "infra/README.md",
  "tooling/README.md",
];

// Living docs and active plans must link to current paths. Completed plans keep
// their original links as historical evidence.
const docTrees = [
  "docs/architecture",
  "docs/operations",
  "docs/product",
  "docs/runbooks",
  "docs/specs",
  "docs/plans/active",
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
  let cursor = 0;
  while (true) {
    const open = text.indexOf("](", cursor);
    if (open < 0) break;

    let start = open + 2;
    while (/\s/.test(text[start] ?? "")) start++;
    const angleBracketed = text[start] === "<";
    if (angleBracketed) start++;

    let end = start;
    if (angleBracketed) {
      while (end < text.length && text[end] !== ">") end++;
    } else {
      let depth = 1;
      while (end < text.length && depth > 0) {
        if (text[end] === "\\") {
          end += 2;
          continue;
        }
        if (text[end] === "(") depth++;
        if (text[end] === ")") depth--;
        if (depth > 0) end++;
      }
    }

    const rawTarget = text.slice(start, end).trim();
    const target = rawTarget.split(/[\s#]/, 1)[0];
    cursor = end + 1;
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
