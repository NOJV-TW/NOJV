import { proxyActivities, defineQuery, setHandler } from "@temporalio/workflow";
import type { PlagiarismCheckInput, PlagiarismCheckStatus } from "../types";
import type * as plagiarismActivities from "../activities/plagiarism";
import { PLAGIARISM_ACTIVITY } from "./activity-options";

const plagiarism = proxyActivities<typeof plagiarismActivities>(PLAGIARISM_ACTIVITY);

export const getPlagiarismStatusQuery =
  defineQuery<PlagiarismCheckStatus>("getPlagiarismStatus");

export async function plagiarismCheckWorkflow(input: PlagiarismCheckInput): Promise<void> {
  let status: PlagiarismCheckStatus = "pending";
  setHandler(getPlagiarismStatusQuery, () => status);

  status = "running";

  try {
    await plagiarism.runPlagiarismCheck(input.targetId, input.targetType);
    status = "completed";
  } catch (err) {
    status = "failed";
    throw err;
  }
}
