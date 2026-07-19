import { describe, expect, it } from "vitest";

import { registryDomain } from "@nojv/application";

const { parseRegistryScopes, authorizeRegistryAccess } = registryDomain;

function repo(name: string, ...actions: string[]) {
  return { type: "repository", name, actions };
}

describe("parseRegistryScopes", () => {
  it("parses repository scopes with multiple actions", () => {
    expect(parseRegistryScopes(["repository:t/alice/run:pull,push"])).toEqual([
      repo("t/alice/run", "pull", "push"),
    ]);
  });

  it("keeps colons inside the repository name", () => {
    expect(parseRegistryScopes(["repository:t/alice/run:v1:pull"])).toEqual([
      repo("t/alice/run:v1", "pull"),
    ]);
  });

  it("drops malformed scopes", () => {
    expect(parseRegistryScopes(["repository", "repository:name", "x::"])).toEqual([]);
  });
});

describe("authorizeRegistryAccess", () => {
  it("teacher gets push+pull only inside their namespace", () => {
    const granted = authorizeRegistryAccess({ kind: "teacher", namespace: "alice" }, [
      repo("t/alice/run", "pull", "push"),
      repo("t/bob/run", "pull", "push"),
      repo("demo/x", "pull", "push"),
      repo("system/web", "pull"),
    ]);
    expect(granted).toEqual([repo("t/alice/run", "pull", "push"), repo("demo/x", "pull")]);
  });

  it("teacher namespace match is exact segment, not a prefix", () => {
    const granted = authorizeRegistryAccess({ kind: "teacher", namespace: "al" }, [
      repo("t/alice/run", "pull", "push"),
    ]);
    expect(granted).toEqual([]);
  });

  it("judge pulls everything but never pushes", () => {
    const granted = authorizeRegistryAccess({ kind: "judge" }, [
      repo("t/alice/run", "pull", "push"),
      repo("demo/x", "pull"),
    ]);
    expect(granted).toEqual([repo("t/alice/run", "pull"), repo("demo/x", "pull")]);
  });

  it("anonymous pulls demo only", () => {
    const granted = authorizeRegistryAccess({ kind: "anonymous" }, [
      repo("demo/x", "pull", "push"),
      repo("t/alice/run", "pull"),
    ]);
    expect(granted).toEqual([repo("demo/x", "pull")]);
  });

  it("credential principals never get catalog access", () => {
    const granted = authorizeRegistryAccess({ kind: "teacher", namespace: "alice" }, [
      { type: "registry", name: "catalog", actions: ["*"] },
    ]);
    expect(granted).toEqual([]);
  });
});
