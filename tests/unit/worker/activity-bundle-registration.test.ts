import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  JUDGE_CLEANUP_TASK_QUEUE,
  JUDGE_STATE_TASK_QUEUE,
  PLATFORM_TASK_QUEUE,
  TEST_JUDGE_TASK_QUEUE,
} from "@nojv/temporal";

import {
  JUDGE_CLEANUP_QUEUE,
  JUDGE_STATE_QUEUE,
  PLATFORM_QUEUE,
  TEST_JUDGE_QUEUE,
} from "../../../apps/worker/src/workflows/activity-options";

const WORKER_SRC = new URL("../../../apps/worker/src/", import.meta.url);

const QUEUE_BUNDLES = [
  {
    bundle: "activities/judge-bundle.ts",
    queue: "JUDGE_TASK_QUEUE",
    workflows: ["workflows/durable-judge.ts"],
  },
  {
    bundle: "activities/platform-bundle.ts",
    queue: "PLATFORM_TASK_QUEUE",
    workflows: [
      "workflows/contest-lifecycle.ts",
      "workflows/exam-auto-close.ts",
      "workflows/assignment-due-soon.ts",
      "workflows/plagiarism-check.ts",
      "workflows/submission-sweeper.ts",
      "workflows/lifecycle-reconciler.ts",
      "workflows/registry-gc.ts",
      "workflows/durable-work.ts",
    ],
  },
  {
    bundle: "activities/test-judge-bundle.ts",
    queue: "TEST_JUDGE_TASK_QUEUE",
    workflows: ["workflows/test-judge.ts"],
  },
];

function readWorkerFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, WORKER_SRC), "utf8");
}

function proxiedActivityNames(workflowSource: string): Set<string> {
  const names = new Set<string>();

  for (const block of workflowSource.matchAll(/const\s+\{([^}]*)\}\s*=\s*proxyActivities/g)) {
    for (const raw of block[1].split(",")) {
      const name = raw.split(":")[0].trim();
      if (name) names.add(name);
    }
  }

  const proxyConsts = [...workflowSource.matchAll(/const\s+(\w+)\s*=\s*proxyActivities/g)].map(
    (m) => m[1],
  );
  for (const proxy of proxyConsts) {
    for (const access of workflowSource.matchAll(new RegExp(`\\b${proxy}\\.(\\w+)\\b`, "g"))) {
      names.add(access[1]);
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

describe("workflow queue literals", () => {
  it("match the @nojv/temporal task queues", () => {
    expect([PLATFORM_QUEUE, JUDGE_STATE_QUEUE, JUDGE_CLEANUP_QUEUE, TEST_JUDGE_QUEUE]).toEqual([
      PLATFORM_TASK_QUEUE,
      JUDGE_STATE_TASK_QUEUE,
      JUDGE_CLEANUP_TASK_QUEUE,
      TEST_JUDGE_TASK_QUEUE,
    ]);
  });
});

describe("workflow coverage completeness", () => {
  it("every workflow that proxies activities is mapped to a queue bundle", () => {
    const dir = fileURLToPath(new URL("workflows/", WORKER_SRC));
    const proxyingWorkflows = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && f !== "index.ts" && f !== "activity-options.ts")
      .filter((f) => readWorkerFile(`workflows/${f}`).includes("proxyActivities"))
      .map((f) => `workflows/${f}`)
      .sort();

    const covered = new Set(QUEUE_BUNDLES.flatMap((b) => b.workflows));
    const uncovered = proxyingWorkflows.filter((w) => !covered.has(w));
    expect(uncovered).toEqual([]);
  });
});

describe.each(QUEUE_BUNDLES)("$queue activity registration", ({ bundle, workflows }) => {
  const exported = bundleExportNames(readWorkerFile(bundle));

  it.each(workflows)("%s only proxies activities exported by the bundle", (workflow) => {
    const used = proxiedActivityNames(readWorkerFile(workflow));
    expect(used.size).toBeGreaterThan(0);
    const missing = [...used].filter((name) => !exported.has(name));
    expect(missing).toEqual([]);
  });
});
