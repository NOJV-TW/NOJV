import { listApiTokenRouteRules } from "@nojv/application";

import { internalOpenApiDocument } from "./internal-document";

type OperationObject = Record<string, unknown>;
type PathsObject = Record<string, Record<string, OperationObject>>;
type SchemasObject = Record<string, unknown>;

const ANONYMOUS_PATHS = [
  "/api/livez",
  "/api/readyz",
  "/api/healthz",
  "/api/openapi.public.json",
] as const;

function collectRefNames(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefNames(item, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") {
        const name = value.split("/").pop();
        if (name) out.add(name);
      } else {
        collectRefNames(value, out);
      }
    }
  }
}

const fullPaths = internalOpenApiDocument.paths as PathsObject;
const fullSchemas = internalOpenApiDocument.components.schemas as SchemasObject;

const tokenPaths: PathsObject = {};
for (const rule of listApiTokenRouteRules()) {
  if (rule.visibility !== "public") continue;
  const operation = fullPaths[rule.path]?.[rule.method.toLowerCase()];
  if (!operation) continue;
  (tokenPaths[rule.path] ??= {})[rule.method.toLowerCase()] = operation;
}
for (const anonymousPath of ANONYMOUS_PATHS) {
  const pathItem = fullPaths[anonymousPath];
  if (pathItem) tokenPaths[anonymousPath] = pathItem;
}

const neededSchemas = new Set<string>();
collectRefNames(tokenPaths, neededSchemas);
let grew = true;
while (grew) {
  grew = false;
  for (const name of [...neededSchemas]) {
    const before = neededSchemas.size;
    collectRefNames(fullSchemas[name], neededSchemas);
    if (neededSchemas.size > before) grew = true;
  }
}

const usedTags = new Set<string>();
for (const pathItem of Object.values(tokenPaths)) {
  for (const operation of Object.values(pathItem)) {
    const tags = (operation as { tags?: readonly string[] }).tags;
    for (const tag of tags ?? []) usedTags.add(tag);
  }
}

export const tokenOpenApiDocument = {
  openapi: internalOpenApiDocument.openapi,
  info: {
    ...internalOpenApiDocument.info,
    title: "NOJV API Token",
    summary: "API routes callable with personal API tokens",
    description:
      "Describes the anonymous system endpoints and API routes callable with a personal API token (Authorization: Bearer). Tokens are created at /account/api-tokens and each protected route requires the listed scope. Routes not in this document are session-only and not part of the token contract. Token auth is rejected while the token owner has an active exam session, and tokens never carry admin elevation. Admin-scoped token routes are documented in the Full API document.",
  },
  tags: internalOpenApiDocument.tags.filter((tag) => usedTags.has(tag.name)),
  paths: tokenPaths,
  components: {
    securitySchemes: internalOpenApiDocument.components.securitySchemes,
    schemas: Object.fromEntries(
      Object.entries(fullSchemas).filter(([name]) => neededSchemas.has(name)),
    ),
  },
};
