import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { problemDomain } from "@nojv/domain";
import { apiHandler } from "$lib/server/shared/api-handler";

const { getProblemPageData, getProblemRowById, getProblemTestcaseSets } = problemDomain;

export const GET: RequestHandler = apiHandler(async (event) => {
  const { problemId } = event.params;
  if (!problemId) {
    error(400, "Missing problem id");
  }

  const row = await getProblemRowById(problemId);
  if (!row || row.visibility !== "public" || row.status !== "published") {
    error(404, "Problem not found");
  }

  const [problem, fullTestcaseSets] = await Promise.all([
    getProblemPageData(problemId),
    getProblemTestcaseSets(problemId),
  ]);

  const testcaseSets = fullTestcaseSets.map((set) => ({
    id: set.id,
    name: set.name,
    description: set.description,
    weight: set.weight,
    ordinal: set.ordinal,
    caseCount: set.testcases.length,
  }));

  return json({
    problem: {
      id: problem.id,
      displayId: problem.displayId,
      title: problem.title,
      statement: problem.statement,
      inputFormat: problem.inputFormat,
      outputFormat: problem.outputFormat,
      difficulty: problem.difficulty,
      tags: problem.tags,
      type: problem.type,
      judgeType: problem.judgeType,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
      samples: problem.samples,
      starterByLanguage: problem.starterByLanguage,
      acceptanceRate: problem.acceptanceRate,
      totalSubmissions: problem.totalSubmissions,
    },
    testcaseSets,
  });
});