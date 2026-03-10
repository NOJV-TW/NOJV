import { prisma } from "@nojv/db";
import type { ProblemCreate, ProblemTestcaseSetCreate } from "@nojv/domain";

import type { CompletedActorContext } from "../actor-context";
import { ConflictError, ForbiddenError } from "../api-errors";
import { createProblemDefinition, ensureUser, requireProblem } from "./shared";

export async function createProblemRecord(
  actor: CompletedActorContext,
  payload: ProblemCreate
) {
  const slug =
    payload.slug ||
    payload.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  return prisma.$transaction(async (tx) => {
    const existing = await tx.problem.findUnique({
      where: {
        slug
      }
    });

    if (existing) {
      throw new ConflictError(`Problem slug already exists: ${slug}`);
    }

    const author = await ensureUser(tx, actor.userId, actor);

    return createProblemDefinition(tx, slug, {
      authorId: author.id,
      checkerScript: payload.checkerScript,
      difficulty: payload.difficulty,
      inputFormat: payload.inputFormat,
      interactorScript: payload.interactorScript,
      judgeType: payload.judgeType,
      outputFormat: payload.outputFormat,
      statement: payload.statement,
      summary: payload.summary,
      tags: payload.tags,
      title: payload.title,
      visibility: payload.visibility
    });
  });
}

export async function createProblemTestcaseSetRecord(
  actor: CompletedActorContext,
  problemSlug: string,
  payload: ProblemTestcaseSetCreate
) {
  return prisma.$transaction(async (tx) => {
    const problem = await requireProblem(tx, problemSlug);

    if (actor.platformRole !== "admin" && problem.authorId !== actor.userId) {
      throw new ForbiddenError(
        "Problem testcases can only be managed by the author or an admin."
      );
    }

    const testcaseSet = await tx.testcaseSet.create({
      data: {
        isHidden: payload.isHidden,
        name: payload.name,
        problemId: problem.id,
        weight: payload.weight
      }
    });

    await Promise.all(
      payload.cases.map((testcase, index) =>
        tx.testcase.create({
          data: {
            expectedStdout: testcase.expectedStdout,
            ordinal: index + 1,
            stdin: testcase.stdin,
            testcaseSetId: testcaseSet.id
          }
        })
      )
    );

    return {
      caseCount: payload.cases.length,
      id: testcaseSet.id,
      isHidden: testcaseSet.isHidden,
      name: testcaseSet.name
    };
  });
}
