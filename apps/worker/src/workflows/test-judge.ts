import { proxyActivities, workflowInfo, type ActivityOptions } from "@temporalio/workflow";
import type {
  TestJudgeProgramBuildInput,
  TestJudgeWorkflowInput,
  TestJudgeWorkflowOutput,
} from "@nojv/core";
import type * as testJudgeActivities from "../activities/test-judge-bundle";
import { TEST_JUDGE_QUEUE } from "./activity-options";

const JUDGE_ACTIVITY: ActivityOptions = {
  taskQueue: TEST_JUDGE_QUEUE,
  scheduleToCloseTimeout: "28s",
  startToCloseTimeout: "28s",
  retry: { maximumAttempts: 1 },
};
const BUILD_ACTIVITY: ActivityOptions = {
  taskQueue: TEST_JUDGE_QUEUE,
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3 },
};

function activities(options: ActivityOptions) {
  const { priority } = workflowInfo();
  return proxyActivities<typeof testJudgeActivities>({
    ...options,
    ...(priority ? { priority } : {}),
  });
}

export async function testJudgeWorkflow(
  input: TestJudgeWorkflowInput,
): Promise<TestJudgeWorkflowOutput> {
  return activities(JUDGE_ACTIVITY).runTestJudge(input);
}

export async function testJudgeProgramBuildWorkflow(
  input: TestJudgeProgramBuildInput,
): Promise<void> {
  await activities(BUILD_ACTIVITY).buildTestJudgeProgram(input);
}
