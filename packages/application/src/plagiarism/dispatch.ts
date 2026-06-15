import type { PlagiarismCheckInput } from "@nojv/core";

import { getDomainOrchestration } from "../shared/orchestration";

export async function dispatchPlagiarismCheck(input: PlagiarismCheckInput): Promise<void> {
  await getDomainOrchestration().dispatchPlagiarismCheck(input);
}
