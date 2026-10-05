import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { WASM_OJ_SERVER_VERSIONS } from "@nojv/core";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function dependencies(packagePath: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(repoRoot, packagePath), "utf8")) as {
    dependencies: Record<string, string>;
  };
  return manifest.dependencies;
}

describe("WASM-OJ server identity pins", () => {
  it("pins the worker's @wasm-oj/server to the identity's server version", () => {
    expect(dependencies("apps/worker/package.json")["@wasm-oj/server"]).toBe(
      WASM_OJ_SERVER_VERSIONS.server,
    );
  });

  it("pins the worker's @wasm-oj/core, the source of its libc++ PCH header, with the server", () => {
    expect(dependencies("apps/worker/package.json")["@wasm-oj/core"]).toBe(
      WASM_OJ_SERVER_VERSIONS.server,
    );
  });

  it("pins the web toolchains the worker mirrors to the identity's versions", () => {
    const web = dependencies("apps/web/package.json");
    const { clang, python } = WASM_OJ_SERVER_VERSIONS;
    expect(web["@wasm-oj/toolchain-clang"]).toBe(clang);
    expect(web["@wasm-oj/toolchain-python"]).toBe(python);
  });
});
