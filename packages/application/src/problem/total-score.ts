import type { ProblemType } from "@nojv/core";
import { problemRepo, testcaseSetRepo, type TransactionClient } from "@nojv/db";
import { parsePersistedAdvancedConfig } from "./judge-config";

export function computeProblemTotalScore(problem: {
  id: string;
  type: ProblemType;
  testcaseSets: { weight: number }[];
  advancedConfig?: unknown;
}): number {
  if (problem.type === "special_env") {
    return parsePersistedAdvancedConfig(problem.advancedConfig, problem.id)?.maxScore ?? 100;
  }
  const sum = problem.testcaseSets.reduce((s, t) => s + t.weight, 0);
  return sum > 0 ? sum : 100;
}

export async function getProblemTotalScore(
  tx: TransactionClient,
  problem: { id: string; type: ProblemType; advancedConfig?: unknown },
): Promise<number> {
  if (problem.type === "special_env") {
    return parsePersistedAdvancedConfig(problem.advancedConfig, problem.id)?.maxScore ?? 100;
  }
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
        id: p.id,
        type: p.type,
        testcaseSets: p.testcaseSets,
        advancedConfig: p.advancedConfig,
      }),
    ]),
  );
}
