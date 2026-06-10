import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routesRoot = path.resolve(__dirname, "../../../apps/web/src/routes");
const frontendDoc = path.resolve(__dirname, "../../../docs/architecture/FRONTEND.md");

function pageDirToUrl(dir: string): string {
  const rel = path.relative(routesRoot, dir).split(path.sep).join("/");
  if (rel === "") return "/";
  const segments = rel.split("/").filter((seg) => !/^\(.+\)$/.test(seg));
  return `/${segments.join("/")}`.replace(/\/+$/, "") || "/";
}

const ROUTE_ENDPOINT_FILES = new Set(["+page.svelte", "+page.server.ts", "+server.ts"]);

function filesystemPageRoutes(): Set<string> {
  const urls = new Set<string>();
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (ROUTE_ENDPOINT_FILES.has(entry.name)) {
        urls.add(pageDirToUrl(dir));
      }
    }
  };
  walk(routesRoot);
  return urls;
}

function documentedRoutes(): string[] {
  const doc = readFileSync(frontendDoc, "utf8");
  const routes: string[] = [];
  for (const line of doc.split("\n")) {
    const cell = /^\|\s*`(\/[^`]*)`/.exec(line);
    if (cell?.[1]) routes.push(cell[1]);
  }
  return routes;
}

describe("FRONTEND.md route map stays in sync with the filesystem", () => {
  const fsRoutes = filesystemPageRoutes();
  const docRoutes = documentedRoutes();

  it("parses a non-trivial number of documented routes", () => {
    expect(docRoutes.length).toBeGreaterThan(20);
  });

  it("every documented route resolves to a real +page route file", () => {
    const dead = docRoutes.filter((r) => !fsRoutes.has(r));
    expect(dead, `FRONTEND.md lists routes that no longer exist: ${dead.join(", ")}`).toEqual(
      [],
    );
  });
});
