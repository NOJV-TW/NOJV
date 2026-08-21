import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const workspaceRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("..", import.meta.url));
const destination = join(workspaceRoot, "apps/web/static/wasm-oj");
const browserRuntimeDestination = join(workspaceRoot, "apps/web/static/_app/immutable/assets");
const toolchainPackages = [
  "@wasm-oj/toolchain-clang",
  "@wasm-oj/toolchain-go",
  "@wasm-oj/toolchain-java",
  "@wasm-oj/toolchain-javascript",
  "@wasm-oj/toolchain-python",
  "@wasm-oj/toolchain-rust",
];

await rm(join(destination, "toolchains"), { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const packageName of toolchainPackages) {
  const packageRoot = dirname(workspaceRequire.resolve(`${packageName}/package.json`));
  await cp(join(packageRoot, "assets"), join(destination, "toolchains"), {
    recursive: true,
    force: true,
  });
}

const browserPackageRoot = dirname(workspaceRequire.resolve("@wasm-oj/browser/package.json"));
const browserAssetDirectory = join(browserPackageRoot, "dist/assets");
await rm(browserRuntimeDestination, { recursive: true, force: true });
await mkdir(browserRuntimeDestination, { recursive: true });
for (const assetName of (await readdir(browserAssetDirectory)).filter((name) =>
  name.endsWith(".wasm"),
)) {
  await cp(join(browserAssetDirectory, assetName), join(browserRuntimeDestination, assetName));
}

console.log(`Prepared WASM-OJ browser toolchain assets in ${destination}`);
