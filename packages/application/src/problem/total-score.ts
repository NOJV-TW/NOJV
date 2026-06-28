import type { ProblemType } from "@nojv/core";
import { testcaseSetRepo, type TransactionClient } from "@nojv/db";

export function computeProblemTotalScore(problem: {
  type: ProblemType;
  testcaseSets: { weight: number }[];
}): number {
  if (problem.type === "special_env") return 100;
  const sum = problem.testcaseSets.reduce((s, t) => s + t.weight, 0);
  return sum > 0 ? sum : 100;
}

export async function getProblemTotalScore(
  tx: TransactionClient,
  problem: { id: string; type: ProblemType },
): Promise<number> {
  if (problem.type === "special_env") return 100;
  const sets = await testcaseSetRepo.withTx(tx).findByProblemId(problem.id);
  const sum = sets.reduce((s, t) => s + t.weight, 0);
  return sum > 0 ? sum : 100;
}
