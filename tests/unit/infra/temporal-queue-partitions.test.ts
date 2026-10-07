import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as taskQueues from "../../../packages/temporal/src/task-queues";

const CONFIG_FILES = [
  "infra/docker/temporal-dynamic-config.yaml",
  "infra/flux/temporal-values.yaml",
  "infra/gcp/gke/temporal/helm-values.ha.yaml",
];

const PARTITION_KEYS = [
  "matching.numTaskqueueWritePartitions",
  "matching.numTaskqueueReadPartitions",
];

const queues = Object.entries(taskQueues)
  .filter(([name]) => name.endsWith("_TASK_QUEUE"))
  .map(([, queue]) => queue);

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function singlePartitionQueues(yamlText: string, key: string): string[] {
  const lines = yamlText.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start === -1) return [];
  const keyIndent = indentOf(lines[start] ?? "");
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && indentOf(line) <= keyIndent) break;
    block.push(line);
  }
  return [
    ...block.join("\n").matchAll(/- value: 1\n\s*constraints: \{ taskQueueName: ([\w-]+) \}/gu),
  ].map((match) => match[1] ?? "");
}

describe("Temporal task-queue partitions", () => {
  it("finds every NOJV task queue", () => {
    expect(queues).toEqual(
      expect.arrayContaining(["judge", "judge-state", "judge-cleanup", "platform"]),
    );
  });

  it.each(CONFIG_FILES.flatMap((file) => PARTITION_KEYS.map((key) => [file, key] as const)))(
    "%s pins %s to one partition for every queue",
    (file, key) => {
      const configured = singlePartitionQueues(readFileSync(file, "utf8"), key);
      expect(configured).toEqual(expect.arrayContaining(queues));
    },
  );
});
