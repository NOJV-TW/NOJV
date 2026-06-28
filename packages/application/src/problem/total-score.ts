import { advancedConfigSchema, type ProblemType } from "@nojv/core";
import { testcaseSetRepo, type TransactionClient } from "@nojv/db";

function advancedMaxScore(advancedConfig: unknown): number {
  const parsed = advancedConfigSchema.safeParse(advancedConfig);
  return parsed.success ? parsed.data.maxScore : 100;
}

export function computeProblemTotalScore(problem: {
  type: ProblemType;
  testcaseSets: { weight: number }[];
  advancedConfig?: unknown;
}): number {
  if (problem.type === "special_env") return advancedMaxScore(problem.advancedConfig);
  const sum = problem.testcaseSets.reduce((s, t) => s + t.weight, 0);
  return sum > 0 ? sum : 100;
}

export async function getProblemTotalScore(
  tx: TransactionClient,
  problem: { id: string; type: ProblemType; advancedConfig?: unknown },
): Promise<number> {
  if (problem.type === "special_env") return advancedMaxScore(problem.advancedConfig);
  const sets = await testcaseSetRepo.withTx(tx).findByProblemId(problem.id);
  const sum = sets.reduce((s, t) => s + t.weight, 0);
  return sum > 0 ? sum : 100;
}
