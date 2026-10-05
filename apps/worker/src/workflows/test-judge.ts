import { proxyActivities } from "@temporalio/workflow";
import type {
  TestJudgeProgramBuildInput,
  TestJudgeWorkflowInput,
  TestJudgeWorkflowOutput,
} from "@nojv/core";
import type * as testJudgeActivities from "../activities/test-judge-bundle";
import { TEST_JUDGE_QUEUE } from "./activity-options";

const judge = proxyActivities<typeof testJudgeActivities>({
  taskQueue: TEST_JUDGE_QUEUE,
  scheduleToCloseTimeout: "28s",
  startToCloseTimeout: "28s",
  retry: { maximumAttempts: 1 },
});
const build = proxyActivities<typeof testJudgeActivities>({
  taskQueue: TEST_JUDGE_QUEUE,
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3 },
});

export async function testJudgeWorkflow(
  input: TestJudgeWorkflowInput,
): Promise<TestJudgeWorkflowOutput> {
  return judge.runTestJudge(input);
}

export async function testJudgeProgramBuildWorkflow(
  input: TestJudgeProgramBuildInput,
): Promise<void> {
  await build.buildTestJudgeProgram(input);
}
