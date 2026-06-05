import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { internalOpenApiDocument } from "$lib/server/openapi/internal-document";
import { openApiDocument as publicOpenApiDocument } from "$lib/server/openapi/public-document";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "../../apps/web/src/routes/api");

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

// SvelteKit route segments -> OpenAPI path template:
//   [id]        -> {id}
//   [...path]   -> {path}
function routeDirToOpenApiPath(dir: string): string {
  const rel = path.relative(apiRoot, dir).split(path.sep).join("/");
  const segments = rel
    .split("/")
    .map((seg) => seg.replace(/^\[\.\.\.(.+)\]$/, "{$1}").replace(/^\[(.+)\]$/, "{$1}"));
  return `/api/${segments.join("/")}`.replace(/\/$/, "");
}

// Walk the filesystem for every +server.ts and the HTTP methods it exports.
function actualOperations(): Set<string> {
  const ops = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== "+server.ts") continue;
      const src = readFileSync(full, "utf8");
      const apiPath = routeDirToOpenApiPath(dir);
      for (const method of HTTP_METHODS) {
        if (new RegExp(`export const ${method}\\b`).test(src)) {
          ops.add(`${method} ${apiPath}`);
        }
      }
    }
  };
  walk(apiRoot);
  return ops;
}

function documentedOperations(doc: {
  paths: Record<string, Record<string, unknown>>;
}): Set<string> {
  const ops = new Set<string>();
  for (const [apiPath, item] of Object.entries(doc.paths)) {
    for (const method of Object.keys(item)) {
      if (HTTP_METHODS.includes(method.toUpperCase() as (typeof HTTP_METHODS)[number])) {
        ops.add(`${method.toUpperCase()} ${apiPath}`);
      }
    }
  }
  return ops;
}

// Drift guard for hand-written OpenAPI documents. The internal document is a
// curated, intentionally NON-exhaustive maintainer reference, so we do not
// require every route to be documented (a new endpoint may legitimately be left
// out). What must always hold is the other direction: the documents must never
// describe an operation that no longer has a real handler. This catches the
// realistic drift — a route renamed, removed, or its method changed — leaving a
// stale, lying entry in the docs.
describe("OpenAPI contract stays in sync with API routes", () => {
  const actual = actualOperations();
  const documented = new Set<string>([
    ...documentedOperations(publicOpenApiDocument),
    ...documentedOperations(internalOpenApiDocument),
  ]);

  it("documents no operation that lacks a real +server.ts handler (no phantom paths)", () => {
    const phantom = [...documented].filter((op) => !actual.has(op)).sort();
    expect(
      phantom,
      `These operations are described in the OpenAPI documents but no +server.ts exports them — a route was renamed, removed, or changed method, and the docs are now stale:\n${phantom.join("\n")}`,
    ).toEqual([]);
  });

  it("sanity: the route scan and the documents both produced operations", () => {
    // Guards against a silently broken scan (e.g. apiRoot moved) that would
    // make the phantom check vacuously pass.
    expect(actual.size).toBeGreaterThan(0);
    expect(documented.size).toBeGreaterThan(0);
  });
});
