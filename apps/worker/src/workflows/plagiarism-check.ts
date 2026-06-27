import { proxyActivities } from "@temporalio/workflow";
import type { PlagiarismCheckInput } from "@nojv/core";
import type * as plagiarismActivities from "../activities/plagiarism";
import { PLAGIARISM_ACTIVITY } from "./activity-options";

const plagiarism = proxyActivities<typeof plagiarismActivities>(PLAGIARISM_ACTIVITY);

export async function plagiarismCheckWorkflow(input: PlagiarismCheckInput): Promise<void> {
  await plagiarism.runPlagiarismCheck(input.targetId, input.targetType);
}
