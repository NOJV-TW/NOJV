import type { ApiTokenScope, PlatformRole } from "@nojv/core";

import { ForbiddenError } from "../shared/errors";

export type ApiTokenRouteVisibility = "public" | "internal";

export interface ApiTokenRouteRule {
  method: string;
  path: string;
  visibility: ApiTokenRouteVisibility;
  requiredScope: ApiTokenScope | null;
  requiredRole?: PlatformRole;
}

export interface MatchedApiTokenRouteRule extends ApiTokenRouteRule {
  params: Record<string, string>;
}

const TOKEN_ROUTE_RULES: ApiTokenRouteRule[] = [
  {
    method: "GET",
    path: "/api/healthz",
    visibility: "public",
    requiredScope: null,
  },
  {
    method: "POST",
    path: "/api/submissions",
    visibility: "public",
    requiredScope: "submissions:write",
  },
  {
    method: "GET",
    path: "/api/submissions/{id}",
    visibility: "public",
    requiredScope: "submissions:read",
  },
  {
    method: "GET",
    path: "/api/submissions/{id}/source",
    visibility: "public",
    requiredScope: "submissions:read",
  },
  {
    method: "GET",
    path: "/api/admin/healthz",
    visibility: "internal",
    requiredScope: "admin:read",
    requiredRole: "admin",
  },
];

function roleSatisfies(actorRole: PlatformRole, requiredRole: PlatformRole): boolean {
  const rank: Record<PlatformRole, number> = {
    student: 0,
    teacher: 1,
    admin: 2,
  };
  return rank[actorRole] >= rank[requiredRole];
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];
    if (patternPart === undefined || pathPart === undefined) return null;
    if (patternPart.startsWith("{") && patternPart.endsWith("}")) {
      params[patternPart.slice(1, -1)] = decodeURIComponent(pathPart);
      continue;
    }
    if (patternPart !== pathPart) return null;
  }
  return params;
}

export function listApiTokenRouteRules(): ApiTokenRouteRule[] {
  return TOKEN_ROUTE_RULES;
}

export function findApiTokenRouteRule(
  method: string,
  pathname: string,
): MatchedApiTokenRouteRule | null {
  const normalizedMethod = method.toUpperCase();
  for (const rule of TOKEN_ROUTE_RULES) {
    if (rule.method !== normalizedMethod) continue;
    const params = matchPath(rule.path, pathname);
    if (params) return { ...rule, params };
  }
  return null;
}

export function assertApiTokenRuleAccess(input: {
  actorRole: PlatformRole;
  scopes: readonly string[];
  rule: ApiTokenRouteRule;
}): void {
  const requiredScope = input.rule.requiredScope;
  if (requiredScope && !input.scopes.includes(requiredScope)) {
    throw new ForbiddenError("Insufficient API token scope.");
  }

  const requiredRole = input.rule.requiredRole;
  if (requiredRole && !roleSatisfies(input.actorRole, requiredRole)) {
    throw new ForbiddenError("Insufficient platform role.");
  }
}
