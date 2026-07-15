import { advancedConfigSchema, type ProblemType } from "@nojv/core";
import { problemRepo, testcaseSetRepo, type TransactionClient } from "@nojv/db";

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

export async function getProblemTotalScores(
  problemIds: string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(problemIds)];
  if (ids.length === 0) return new Map();
  const problems = await problemRepo.findScoringInputsByIds(ids);
  return new Map(
    problems.map((p) => [
      p.id,
      computeProblemTotalScore({
        type: p.type,
        testcaseSets: p.testcaseSets,
        advancedConfig: p.advancedConfig,
      }),
    ]),
  );
}
