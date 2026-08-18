import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const workspaceRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const forgePackage = dirname(workspaceRequire.resolve("@wasm-oj/forge/package.json"));
const destination = join(fileURLToPath(new URL("..", import.meta.url)), "apps/web/static/forge");

await mkdir(destination, { recursive: true });
await cp(join(forgePackage, "public/toolchains"), join(destination, "toolchains"), {
  recursive: true,
  force: true,
});
await cp(
  join(forgePackage, "public/toolchain-cache-sw.js"),
  join(destination, "toolchain-cache-sw.js"),
);

console.log(`Prepared Forge browser assets in ${destination}`);
