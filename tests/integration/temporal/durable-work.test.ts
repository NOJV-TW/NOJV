import { fileURLToPath } from "node:url";
import { ApplicationFailure, Context } from "@temporalio/activity";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DURABLE_WORK_ITEMS_PER_EXECUTION } from "../../../apps/worker/src/durable-work-config";

const workflowsPath = fileURLToPath(
  new URL("../../../apps/worker/src/workflows/durable-work.ts", import.meta.url),
);
let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

const empty = {
  claimed: 0,
  succeeded: 0,
  retried: 0,
  dead: 0,
  processedKind: null,
};

describe("durable work cron parent", () => {
  it("keeps recurring after the draining child continues as new, fails, and later completes", async () => {
    const queue = `durable-cron-${crypto.randomUUID()}`;
    let failedRunId: string | undefined;
    const offsets: number[] = [];
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: queue,
      workflowsPath,
      activities: {
        runDurableWorkBatch: async ({ fairnessOffset = 0 }: { fairnessOffset?: number }) => {
          offsets.push(fairnessOffset);
          if (failedRunId) return empty;
          if (fairnessOffset >= DURABLE_WORK_ITEMS_PER_EXECUTION) {
            failedRunId = Context.current().info.workflowExecution.runId;
            throw ApplicationFailure.nonRetryable("Injected durable batch failure");
          }
          return { ...empty, claimed: 1, succeeded: 1, processedKind: "submission" };
        },
      },
    });

    await worker.runUntil(async () => {
      const processor = await env.client.workflow.start("durableWorkProcessorWorkflow", {
        workflowId: queue,
        taskQueue: queue,
        cronSchedule: "* * * * *",
      });
      try {
        await env.sleep("1m");
        const first = env.client.workflow.getHandle(queue, processor.firstExecutionRunId);
        await expect
          .poll(async () => (await first.describe()).status.name, { timeout: 15_000 })
          .toBe("FAILED");
        const firstHistory = await first.fetchHistory();
        const child = firstHistory.events?.find(
          (event) => event.childWorkflowExecutionStartedEventAttributes,
        )?.childWorkflowExecutionStartedEventAttributes?.workflowExecution;
        expect(child?.workflowId).toBeTruthy();
        expect(child?.runId).toBeTruthy();
        const childHistory = await env.client.workflow
          .getHandle(child!.workflowId!, child!.runId!)
          .fetchHistory();
        const continuation = childHistory.events?.find(
          (event) => event.workflowExecutionContinuedAsNewEventAttributes,
        )?.workflowExecutionContinuedAsNewEventAttributes;
        expect(continuation?.newExecutionRunId).toBe(failedRunId);
        expect(offsets).toContain(DURABLE_WORK_ITEMS_PER_EXECUTION);
        const failed = firstHistory.events?.find(
          (event) => event.workflowExecutionFailedEventAttributes,
        )?.workflowExecutionFailedEventAttributes;
        expect(failed?.newExecutionRunId).toBeTruthy();

        const second = env.client.workflow.getHandle(queue, failed!.newExecutionRunId!);
        await env.sleep("1m");
        await expect
          .poll(async () => (await second.describe()).status.name, { timeout: 15_000 })
          .toBe("COMPLETED");
        const secondHistory = await second.fetchHistory();
        expect(
          secondHistory.events?.[0]?.workflowExecutionStartedEventAttributes?.cronSchedule,
        ).toBe("* * * * *");
        expect(
          secondHistory.events?.[0]?.workflowExecutionStartedEventAttributes
            ?.continuedExecutionRunId,
        ).toBe(processor.firstExecutionRunId);
        expect(
          secondHistory.events?.some(
            (event) => event.childWorkflowExecutionCompletedEventAttributes,
          ),
        ).toBe(true);
        const completed = secondHistory.events?.find(
          (event) => event.workflowExecutionCompletedEventAttributes,
        )?.workflowExecutionCompletedEventAttributes;
        expect(completed?.newExecutionRunId).toBeTruthy();
        const thirdHistory = await env.client.workflow
          .getHandle(queue, completed!.newExecutionRunId!)
          .fetchHistory();
        expect(
          thirdHistory.events?.[0]?.workflowExecutionStartedEventAttributes?.cronSchedule,
        ).toBe("* * * * *");
      } finally {
        await env.client.workflow.getHandle(queue).terminate("Bounded cron test finished");
      }
    });
  }, 180_000);
});
