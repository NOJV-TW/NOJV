import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
};

// Main worker entry.
await build({
  ...shared,
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
});

// Temporal workflows entry. Must be emitted as a separate file because
// worker-app.ts passes `workflowsPath: require.resolve("./workflows/index.js")`
// and Temporal re-bundles the workflow code in its own isolated sandbox for
// determinism — it cannot be inlined into the main bundle.
await build({
  ...shared,
  entryPoints: ["src/workflows/index.ts"],
  outfile: "dist/workflows/index.js",
});
