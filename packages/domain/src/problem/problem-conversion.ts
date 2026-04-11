import {
  Prisma,
  problemRepo,
  problemWorkspaceFileRepo,
  runTransaction,
  testcaseSetRepo
} from "@nojv/db";

import { ConflictError } from "../shared/errors";

import { assertProblemOwnership, requireProblem, type ProblemActorContext } from "./helpers";

// Data-lossy: workspace files, testcase sets, samples, and judgeConfig are
// discarded. The UI shows an explicit warning before calling this.
export async function convertProblemToAdvancedMode(
  actor: ProblemActorContext,
  problemId: string
): Promise<void> {
  await runTransaction(async (tx) => {
    const problem = await requireProblem(tx, problemId);
    assertProblemOwnership(problem, actor);

    if (problem.type === "special_env") {
      throw new ConflictError("Problem is already a special_env problem.");
    }

    // Drop workspace files and testcase sets. Testcases cascade via the
    // `onDelete: Cascade` relation on Testcase.testcaseSetId.
    await problemWorkspaceFileRepo.withTx(tx).deleteByProblemId(problem.id);
    await testcaseSetRepo.withTx(tx).deleteByProblemId(problem.id);

    // special_env mode ignores judgeConfig in the runner, but the column
    // is `Json?` and other call sites still read it; write a minimal
    // valid value rather than leaving the previous standard-mode config.
    const resetJudgeConfig = {
      type: "standard"
    } satisfies Prisma.InputJsonValue;

    await problemRepo.withTx(tx).update(problem.id, {
      type: "special_env",
      samples: Prisma.JsonNull,
      judgeConfig: resetJudgeConfig,
      advancedImageRef: "",
      advancedImageSource: "registry"
    });
  });
}
