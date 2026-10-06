import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { WASM_OJ_SERVER_VERSIONS } from "@nojv/core";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workerDockerfile = readFileSync(join(repoRoot, "infra/docker/worker.Dockerfile"), "utf8");

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

  it("builds the worker image's native runtime from the forge tag of the server version", () => {
    expect(workerDockerfile).toContain(
      `ARG WASM_OJ_FORGE_TAG=v${WASM_OJ_SERVER_VERSIONS.server}\n`,
    );
    expect(workerDockerfile).toMatch(/^ARG WASM_OJ_FORGE_COMMIT=[0-9a-f]{40}$/mu);
    expect(workerDockerfile).toContain(
      `test "$(git rev-parse 'FETCH_HEAD^{commit}')" = "$WASM_OJ_FORGE_COMMIT"`,
    );
  });

  it("installs the worker image's server toolchains at the identity's versions", () => {
    const { clang, python } = WASM_OJ_SERVER_VERSIONS;
    expect(dependencies("infra/docker/wasm-oj-toolchains/package.json")).toEqual({
      "@wasm-oj/toolchain-clang": clang,
      "@wasm-oj/toolchain-python": python,
    });
    const lock = JSON.parse(
      readFileSync(join(repoRoot, "infra/docker/wasm-oj-toolchains/package-lock.json"), "utf8"),
    ) as { packages: Record<string, { version?: string }> };
    expect(lock.packages["node_modules/@wasm-oj/toolchain-clang"]?.version).toBe(clang);
    expect(lock.packages["node_modules/@wasm-oj/toolchain-python"]?.version).toBe(python);
  });

  it("copies the WASM-OJ layers into the worker image before any app layer", () => {
    const firstAppCopy = workerDockerfile.indexOf("COPY --from=builder");
    for (const layer of [
      "COPY --link --from=wasm-oj-runtime /rootfs/ /\n",
      "COPY --link --from=wasm-oj-toolchains /rootfs/ /\n",
    ]) {
      const index = workerDockerfile.indexOf(layer);
      expect(index).toBeGreaterThan(0);
      expect(index).toBeLessThan(firstAppCopy);
    }
  });
});
