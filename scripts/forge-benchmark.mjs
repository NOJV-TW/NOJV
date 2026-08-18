import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(new URL("..", import.meta.url)));
const workerRequire = createRequire(new URL("../apps/worker/package.json", import.meta.url));
const forgePackage = dirname(workerRequire.resolve("@wasm-oj/forge/package.json"));
const forgeServerEntry = join(forgePackage, "lib/server.js");
const { createServerForge, resolveServerForgePaths } = await import(
  pathToFileURL(forgeServerEntry).href
);
const paths = resolveServerForgePaths({ cacheDirectory: join(root, ".tmp/forge-benchmark") });

await mkdir(paths.cacheDirectory, { recursive: true });

const source = `#include <iostream>

int main() {
  long long a;
  long long b;
  if (!(std::cin >> a >> b)) return 0;
  std::cout << a + b << '\\n';
}
`;
const cases = [
  ["1 2\n", "3\n"],
  ["100 250\n", "350\n"],
  ["-5 8\n", "3\n"],
];

const forge = await createServerForge({
  cacheDirectory: paths.cacheDirectory,
  toolchainDirectory: paths.toolchainDirectory,
  runtimeDirectory: dirname(paths.compilerExecutable),
  artifactCache: true,
});

try {
  const startedAt = performance.now();
  const build = await forge.compile(
    {
      language: "cpp",
      target: "wasip1",
      optimization: "release",
      entry: "main.cpp",
      files: { "main.cpp": source },
      name: "NOJV Forge benchmark",
      projectId: "nojv-forge-benchmark",
    },
    { cache: true },
  );
  const compileMs = Math.round(performance.now() - startedAt);

  if (!build.success || !build.artifact) {
    console.error(
      JSON.stringify({ ok: false, compileMs, diagnostics: build.diagnostics }, null, 2),
    );
    process.exitCode = 1;
  } else {
    const runs = [];
    for (const [input, expected] of cases) {
      const run = await forge.run(build.artifact, {
        stdin: input,
        resources: {
          logicalTimeLimitMs: 1_000,
          memoryLimitBytes: 256 * 1024 * 1024,
          wallTimeLimitMs: 3_000,
        },
      });
      if (run.code !== 0 || run.termination !== "exited" || run.stdout !== expected) {
        throw new Error(`Forge benchmark parity failure: ${JSON.stringify(run)}`);
      }
      runs.push({
        durationMs: run.durationMs,
        cost: run.metrics.cost,
        memoryBytes: run.metrics.memoryBytes,
      });
    }
    const durations = runs.map((run) => run.durationMs).sort((a, b) => a - b);
    console.log(
      JSON.stringify(
        {
          ok: true,
          language: "cpp",
          compileMs,
          cacheHit: build.cacheHit,
          runCount: runs.length,
          p50RunMs: durations[Math.floor(durations.length * 0.5)],
          p95RunMs:
            durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)],
          runs,
        },
        null,
        2,
      ),
    );
  }
} finally {
  forge.dispose();
}
