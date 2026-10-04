import type { TransactionClient } from "@nojv/db";
import type { ProblemType } from "@nojv/core";

import { ConflictError } from "../shared/errors";

export async function problemAwardsPoints(
  tx: TransactionClient,
  problemId: string,
): Promise<boolean> {
  const { _sum } = await tx.testcaseSet.aggregate({
    where: { problemId },
    _sum: { weight: true },
  });
  return (_sum.weight ?? 0) > 0;
}

export async function assertInUseProblemAwardsPoints(
  tx: TransactionClient,
  problem: { id: string; status: string; type: ProblemType },
): Promise<void> {
  if (problem.type === "special_env") return;
  if (problem.status !== "published") {
    const linked = await tx.problem.findFirst({
      where: {
        id: problem.id,
        OR: [
          { contestLinks: { some: {} } },
          { examLinks: { some: {} } },
          { assessmentLinks: { some: {} } },
        ],
      },
      select: { id: true },
    });
    if (!linked) return;
  }
  if (!(await problemAwardsPoints(tx, problem.id))) {
    throw new ConflictError(
      "Published or assigned problems need at least one subtask worth points.",
    );
  }
}
