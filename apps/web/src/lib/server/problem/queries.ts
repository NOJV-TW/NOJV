import { prisma } from "@nojv/db";
import { judgeTypeSchema, problemDifficultySchema, submissionTypeSchema } from "@nojv/core";

import { DEFAULT_LOCALE } from "$lib/locale";
import { starterByLanguage, type ProblemDetail, type TemplateInfo } from "$lib/types";
import { pickProblemStatement } from "../shared/pick-problem-statement";

// ─── Internal helpers ────────────────────────────────────────────────

function buildProblemSamples(problem: {
  testcaseSets?: {
    isHidden: boolean;
    testcases: {
      expectedStdout: string | null;
      stdin: string;
    }[];
  }[];
}) {
  const visibleSet =
    problem.testcaseSets?.find((testcaseSet) => !testcaseSet.isHidden) ??
    problem.testcaseSets?.[0];
  const sample = visibleSet?.testcases[0];

  if (!sample) {
    return [];
  }

  return [
    {
      explanation: "Sample case extracted from the authored testcase set.",
      input: sample.stdin,
      output: sample.expectedStdout ?? ""
    }
  ];
}

function buildTemplatesMap(
  templates: {
    driverCode: string;
    insertionMarker: string;
    language: string;
    templateCode: string;
  }[]
): Partial<Record<string, TemplateInfo>> {
  const map: Partial<Record<string, TemplateInfo>> = {};

  for (const tpl of templates) {
    map[tpl.language] = {
      driverCode: tpl.driverCode,
      insertionMarker: tpl.insertionMarker,
      templateCode: tpl.templateCode
    };
  }

  return map;
}

function buildStarterByLanguage(
  submissionType: string,
  templates: {
    language: string;
    templateCode: string;
  }[]
): Record<string, string> {
  if (submissionType === "function" && templates.length > 0) {
    const starter: Record<string, string> = { ...starterByLanguage };

    for (const tpl of templates) {
      starter[tpl.language] = tpl.templateCode;
    }

    return starter;
  }

  return { ...starterByLanguage };
}

function mapPersistedProblemDetail(
  problem: {
    author?: { handle: string | null } | null;
    checkerScript?: string | null;
    defaultTitle: string;
    difficulty: string;
    interactorScript?: string | null;
    judgeType?: string;
    memoryLimitMb?: number;
    slug: string;
    statements?: {
      bodyMarkdown: string;
      inputFormat?: string;
      locale: string;
      outputFormat?: string;
      title: string;
    }[];
    submissionType?: string;
    summary: string;
    tags?: string[];
    templates?: {
      driverCode: string;
      insertionMarker: string;
      language: string;
      templateCode: string;
    }[];
    testcaseSets?: {
      isHidden: boolean;
      testcases: {
        expectedStdout: string | null;
        stdin: string;
      }[];
    }[];
    timeLimitMs?: number;
    visibility: "private" | "public";
  },
  locale: string,
  totalSubmissions: number,
  acceptedCount: number
) {
  const localized = pickProblemStatement(
    problem.statements,
    locale,
    problem.defaultTitle,
    problem.summary
  );

  const submissionType = submissionTypeSchema
    .catch("full_source")
    .parse(problem.submissionType);
  const problemTemplates = problem.templates ?? [];

  return {
    acceptanceRate: totalSubmissions > 0 ? acceptedCount / totalSubmissions : 0,
    authorHandle: problem.author?.handle ?? "course_staff",
    ...(problem.checkerScript ? { checkerScript: problem.checkerScript } : {}),
    difficulty: problemDifficultySchema.catch("medium").parse(problem.difficulty),
    ...(problem.interactorScript ? { interactorScript: problem.interactorScript } : {}),
    inputFormat: localized.inputFormat,
    judgeType: judgeTypeSchema.catch("standard").parse(problem.judgeType),
    memoryLimitMb: problem.memoryLimitMb ?? 256,
    outputFormat: localized.outputFormat,
    samples: buildProblemSamples(problem),
    slug: problem.slug,
    starterByLanguage: buildStarterByLanguage(submissionType, problemTemplates),
    statement: localized.statement,
    submissionType,
    summary: problem.summary.trim().length > 0 ? problem.summary : localized.statement,
    tags: problem.tags ?? [],
    templates: buildTemplatesMap(problemTemplates),
    timeLimitMs: problem.timeLimitMs ?? 1_000,
    title: localized.title,
    totalSubmissions,
    visibility: problem.visibility
  } satisfies ProblemDetail;
}

// ─── Public query functions ──────────────────────────────────────────

export async function listProblemCards() {
  const persistedProblems = await prisma.problem.findMany({
    include: {
      _count: {
        select: { submissions: true }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    where: {
      visibility: "public"
    }
  });

  // Batch-fetch accepted counts per problem
  const problemIds = persistedProblems.map((p) => p.id);
  const acceptedCounts =
    problemIds.length > 0
      ? await prisma.submission.groupBy({
          by: ["problemId"],
          _count: true,
          where: { problemId: { in: problemIds }, status: "accepted" }
        })
      : [];
  const acceptedByProblemId = new Map(acceptedCounts.map((r) => [r.problemId, r._count]));

  return persistedProblems.map((problem) => {
    const total = problem._count.submissions;
    const accepted = acceptedByProblemId.get(problem.id) ?? 0;
    return {
      acceptanceRate: total > 0 ? accepted / total : 0,
      difficulty: problemDifficultySchema.catch("medium").parse(problem.difficulty),
      slug: problem.slug,
      tags: problem.tags,
      title: problem.defaultTitle,
      totalSubmissions: total
    };
  });
}

export async function listEditableProblems(userId: string) {
  const problems = await prisma.problem.findMany({
    orderBy: { createdAt: "desc" },
    where: {
      OR: [
        { authorId: userId },
        {
          assessmentLinks: {
            some: {
              assessment: {
                course: {
                  memberships: {
                    some: {
                      userId,
                      role: { in: ["teacher", "ta"] },
                      status: "active"
                    }
                  }
                }
              }
            }
          }
        }
      ]
    }
  });

  return problems.map((problem) => ({
    difficulty: problemDifficultySchema.catch("medium").parse(problem.difficulty),
    slug: problem.slug,
    tags: problem.tags,
    title: problem.defaultTitle,
    visibility: problem.visibility
  }));
}

export async function getProblemPageData(slug: string, locale: string = DEFAULT_LOCALE) {
  const persistedProblem = await prisma.problem.findUnique({
    include: {
      _count: {
        select: {
          submissions: true
        }
      },
      author: {
        select: {
          handle: true
        }
      },
      statements: true,
      templates: {
        orderBy: {
          language: "asc"
        }
      },
      testcaseSets: {
        include: {
          _count: {
            select: { testcases: true }
          },
          testcases: {
            orderBy: {
              ordinal: "asc"
            },
            take: 10
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      }
    },
    where: {
      slug
    }
  });

  if (!persistedProblem) {
    return null;
  }

  const acceptedCount = await prisma.submission.count({
    where: { problemId: persistedProblem.id, status: "accepted" }
  });

  return mapPersistedProblemDetail(
    persistedProblem,
    locale,
    persistedProblem._count.submissions,
    acceptedCount
  );
}

export async function listSolvedProblemSlugs(userId: string): Promise<string[]> {
  const rows = await prisma.submission.findMany({
    distinct: ["problemId"],
    select: { problem: { select: { slug: true } } },
    where: { userId, status: "accepted", sampleOnly: false }
  });

  return rows.map((r) => r.problem.slug);
}
