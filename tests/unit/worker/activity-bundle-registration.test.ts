import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// A proxied activity missing from its queue's bundle only fails at runtime
// ("Activity function not registered"), which mocked tests never reach.

const WORKER_SRC = new URL("../../../apps/worker/src/", import.meta.url);

const QUEUE_BUNDLES = [
  {
    bundle: "activities/judge-bundle.ts",
    queue: "JUDGE_TASK_QUEUE",
    workflows: ["workflows/submission-judge.ts", "workflows/rejudge.ts"],
  },
  {
    bundle: "activities/platform-bundle.ts",
    queue: "PLATFORM_TASK_QUEUE",
    workflows: [
      "workflows/contest-lifecycle.ts",
      "workflows/exam-auto-close.ts",
      "workflows/plagiarism-check.ts",
    ],
  },
];

function readWorkerFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, WORKER_SRC), "utf8");
}

function proxiedActivityNames(workflowSource: string): Set<string> {
  const proxyConsts = [...workflowSource.matchAll(/const (\w+) = proxyActivities/g)].map(
    (m) => m[1],
  );
  const names = new Set<string>();
  for (const proxy of proxyConsts) {
    for (const call of workflowSource.matchAll(new RegExp(`\\b${proxy}\\.(\\w+)\\(`, "g"))) {
      names.add(call[1]);
    }
  }
  return names;
}

function bundleExportNames(bundleSource: string): Set<string> {
  const names = new Set<string>();
  for (const block of bundleSource.matchAll(/export \{([^}]*)\} from/g)) {
    for (const raw of block[1].split(",")) {
      const name = raw.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

describe.each(QUEUE_BUNDLES)("$queue activity registration", ({ bundle, workflows }) => {
  const exported = bundleExportNames(readWorkerFile(bundle));

  it.each(workflows)("%s only proxies activities exported by the bundle", (workflow) => {
    const used = proxiedActivityNames(readWorkerFile(workflow));
    expect(used.size).toBeGreaterThan(0);
    const missing = [...used].filter((name) => !exported.has(name));
    expect(missing).toEqual([]);
  });
});
