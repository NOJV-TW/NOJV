import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { WASM_OJ_SERVER_IDENTITY } from "@nojv/core";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function dependencies(packagePath: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(repoRoot, packagePath), "utf8")) as {
    dependencies: Record<string, string>;
  };
  return manifest.dependencies;
}

function identityVersions(): { server: string; clang: string; python: string } {
  const match = /^wasm-oj-server@([^+]+)\+clang@([^+]+)\+python@([^+]+)$/.exec(
    WASM_OJ_SERVER_IDENTITY,
  );
  if (!match) throw new Error(`unrecognised identity ${WASM_OJ_SERVER_IDENTITY}`);
  return { server: match[1], clang: match[2], python: match[3] };
}

describe("WASM-OJ server identity pins", () => {
  it("pins the worker's @wasm-oj/server to the identity's server version", () => {
    expect(dependencies("apps/worker/package.json")["@wasm-oj/server"]).toBe(
      identityVersions().server,
    );
  });

  it("pins the worker's @wasm-oj/core, the source of its libc++ PCH header, with the server", () => {
    expect(dependencies("apps/worker/package.json")["@wasm-oj/core"]).toBe(
      identityVersions().server,
    );
  });

  it("pins the web toolchains the worker mirrors to the identity's versions", () => {
    const web = dependencies("apps/web/package.json");
    const { clang, python } = identityVersions();
    expect(web["@wasm-oj/toolchain-clang"]).toBe(clang);
    expect(web["@wasm-oj/toolchain-python"]).toBe(python);
  });
});
