import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const dispatchFile = join(repoRoot, "packages/temporal/src/dispatch.ts");
const workflowsDir = join(repoRoot, "apps/worker/src/workflows");

function matchAll(text: string, re: RegExp): string[] {
  return [...text.matchAll(re)].map((m) => m[1]);
}

function workflowFilesText(): string {
  return readdirSync(workflowsDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(join(workflowsDir, f), "utf8"))
    .join("\n");
}

function exportedWorkflowNames(): Set<string> {
  const index = readFileSync(join(workflowsDir, "index.ts"), "utf8");
  const names = new Set<string>();
  for (const block of matchAll(index, /export\s*\{([^}]*)\}/g)) {
    for (const ident of block.split(",")) {
      const name = ident
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

describe("Temporal workflow/query registration (string-name drift guard)", () => {
  const dispatch = readFileSync(dispatchFile, "utf8");

  it('every workflow.start("name") in dispatch is exported from workflows/index.ts', () => {
    const started = matchAll(dispatch, /workflow\.start\(\s*"([^"]+)"/g);
    const exported = exportedWorkflowNames();
    const unregistered = started.filter((name) => !exported.has(name));
    expect(
      unregistered,
      `dispatched workflows not registered in the worker bundle: ${unregistered.join(", ")}`,
    ).toEqual([]);
    expect(started.length).toBeGreaterThan(0);
  });

  it('every handle.query("name") in dispatch has a matching defineQuery in a workflow', () => {
    const queried = matchAll(dispatch, /\.query(?:<[^>]*>)?\(\s*"([^"]+)"/g);
    const defined = new Set(
      matchAll(workflowFilesText(), /defineQuery(?:<[^>]*>)?\(\s*"([^"]+)"/g),
    );
    const unhandled = queried.filter((name) => !defined.has(name));
    expect(
      unhandled,
      `queried names with no defineQuery handler: ${unhandled.join(", ")}`,
    ).toEqual([]);
    expect(queried.length).toBeGreaterThan(0);
  });
});
