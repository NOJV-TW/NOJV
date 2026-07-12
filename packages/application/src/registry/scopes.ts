export interface RegistryAccessEntry {
  type: string;
  name: string;
  actions: string[];
}

export type RegistryPrincipal =
  | { kind: "anonymous" }
  | { kind: "teacher"; namespace: string }
  | { kind: "judge" }
  | { kind: "admin" };

export const REGISTRY_DEMO_PREFIX = "demo/";
export const REGISTRY_TEACHER_PREFIX = "t/";

export function parseRegistryScopes(scopes: string[]): RegistryAccessEntry[] {
  const entries: RegistryAccessEntry[] = [];
  for (const scope of scopes) {
    const parts = scope.split(":");
    if (parts.length < 3) continue;
    const type = parts[0];
    const actionsRaw = parts[parts.length - 1];
    if (!type || !actionsRaw) continue;
    const actions = actionsRaw
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    const name = parts.slice(1, -1).join(":");
    if (!name || actions.length === 0) continue;
    entries.push({ type, name, actions });
  }
  return entries;
}

function allowedRepositoryActions(principal: RegistryPrincipal, name: string): string[] {
  switch (principal.kind) {
    case "admin":
      return ["pull", "push", "delete"];
    case "judge":
      return ["pull"];
    case "teacher": {
      const own = `${REGISTRY_TEACHER_PREFIX}${principal.namespace}`;
      if (name === own || name.startsWith(`${own}/`)) return ["pull", "push"];
      if (name.startsWith(REGISTRY_DEMO_PREFIX)) return ["pull"];
      return [];
    }
    case "anonymous":
      return name.startsWith(REGISTRY_DEMO_PREFIX) ? ["pull"] : [];
  }
}

export function authorizeRegistryAccess(
  principal: RegistryPrincipal,
  requested: RegistryAccessEntry[],
): RegistryAccessEntry[] {
  const granted: RegistryAccessEntry[] = [];
  for (const entry of requested) {
    if (entry.type === "registry") {
      if (principal.kind === "admin" && entry.name === "catalog") {
        granted.push({ type: "registry", name: "catalog", actions: ["*"] });
      }
      continue;
    }
    if (entry.type !== "repository") continue;
    const allowed = allowedRepositoryActions(principal, entry.name);
    const actions = entry.actions.filter((a) => allowed.includes(a));
    if (actions.length > 0) {
      granted.push({ type: "repository", name: entry.name, actions });
    }
  }
  return granted;
}
