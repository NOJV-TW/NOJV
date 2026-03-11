import { prisma, type TransactionClient } from "@nojv/db";
import type {
  CourseAssessmentCreate,
  CourseAssessmentType,
  CourseCreate,
  CourseJoinRequest,
  CourseProblemAttach,
  ManualCourseEnrollment,
  ProblemCreate,
  ProblemTestcaseSetCreate,
  ProblemUpdate,
  SubmissionDraft
} from "@nojv/core";

import { DEFAULT_LOCALE } from "$lib/i18n";
import type { CompletedActorContext } from "./auth";
import { ConflictError, ForbiddenError, NotFoundError } from "./auth";

// --- Shared helpers ---

export interface EnsureUserInput {
  displayName?: string;
  email?: string;
  handle?: string;
  locale?: string;
  platformRole?: "admin" | "student" | "teacher";
}

export interface CreateProblemDefinitionInput {
  authorId?: string;
  checkerScript?: string | undefined;
  difficulty: "easy" | "hard" | "medium";
  inputFormat?: string;
  interactorScript?: string | undefined;
  judgeType?: "checker" | "interactive" | "standard";
  memoryLimitMb?: number;
  outputFormat?: string;
  statement?: string;
  submissionType?: "full_source" | "function";
  summary: string;
  tags?: string[];
  timeLimitMs?: number;
  title: string;
  visibility?: "private" | "public";
}

export function sanitizeIdentitySegment(value: string) {
  const normalized = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "local-user";
}

export function createLocalEmail(userId: string) {
  return `${sanitizeIdentitySegment(userId)}@local.nojv.dev`;
}

export function createLocalDisplayName(userId: string) {
  return `Local ${userId.replaceAll(/[_-]+/g, " ")}`;
}

function createLocalHandle(userId: string) {
  return sanitizeIdentitySegment(userId);
}

export async function ensureUser(
  tx: TransactionClient,
  userId: string,
  input: EnsureUserInput = {}
) {
  const existing = await tx.user.findUnique({ where: { id: userId } });

  if (existing) {
    // Only update fields explicitly provided — never overwrite with fallbacks
    const updates: Record<string, string> = {};
    if (input.displayName) updates.name = input.displayName;
    if (input.email) updates.email = input.email;
    if (input.handle) updates.handle = input.handle;
    if (input.locale) updates.locale = input.locale;
    if (input.platformRole) updates.platformRole = input.platformRole;

    if (Object.keys(updates).length === 0) return existing;

    return tx.user.update({ data: updates, where: { id: existing.id } });
  }

  return tx.user.create({
    data: {
      id: userId,
      name: input.displayName ?? createLocalDisplayName(userId),
      email: input.email ?? createLocalEmail(userId),
      handle: input.handle ?? createLocalHandle(userId),
      locale: input.locale ?? DEFAULT_LOCALE,
      platformRole: input.platformRole ?? "student"
    }
  });
}

export async function createProblemDefinition(
  tx: TransactionClient,
  problemSlug: string,
  input: CreateProblemDefinitionInput
) {
  const problem = await tx.problem.create({
    data: {
      authorId: input.authorId ?? null,
      checkerScript: input.checkerScript ?? null,
      defaultTitle: input.title,
      difficulty: input.difficulty,
      id: `problem_${problemSlug}`,
      interactorScript: input.interactorScript ?? null,
      judgeType: input.judgeType ?? "standard",
      memoryLimitMb: input.memoryLimitMb ?? 256,
      slug: problemSlug,
      submissionType: input.submissionType ?? "full_source",
      summary: input.summary,
      tags: input.tags ?? [],
      timeLimitMs: input.timeLimitMs ?? 1_000,
      visibility: input.visibility ?? "public"
    }
  });

  if (input.statement) {
    await tx.problemStatementI18n.create({
      data: {
        bodyMarkdown: input.statement,
        inputFormat: input.inputFormat ?? "",
        locale: DEFAULT_LOCALE,
        outputFormat: input.outputFormat ?? "",
        problemId: problem.id,
        title: input.title
      }
    });
  }

  return problem;
}

export async function requireProblem(tx: TransactionClient, problemSlug: string) {
  const problem = await tx.problem.findUnique({
    where: {
      slug: problemSlug
    }
  });

  if (!problem) {
    throw new NotFoundError(`Problem not found: ${problemSlug}`);
  }

  return problem;
}

export function assertCourseProblemAccess(
  problem: { authorId: string | null; visibility: string },
  actor: CompletedActorContext
) {
  if (
    problem.visibility === "private" &&
    actor.platformRole !== "admin" &&
    problem.authorId !== actor.userId
  ) {
    throw new ForbiddenError(
      "Private problems can only be attached by their author or an admin."
    );
  }
}

export async function requireContest(tx: TransactionClient, contestSlug: string) {
  const contest = await tx.contest.findUnique({
    where: { slug: contestSlug }
  });

  if (!contest) {
    throw new NotFoundError(`Contest not found: ${contestSlug}`);
  }

  return contest;
}

export async function ensureContestParticipation(
  tx: TransactionClient,
  userId: string,
  contestSlug: string
) {
  const contest = await requireContest(tx, contestSlug);

  return tx.contestParticipation.upsert({
    create: {
      contestId: contest.id,
      startedAt: new Date(),
      status: "active",
      userId
    },
    update: {
      status: "active"
    },
    where: {
      contestId_userId: {
        contestId: contest.id,
        userId
      }
    }
  });
}

export async function requireCourse(tx: TransactionClient, courseSlug: string) {
  const course = await tx.course.findUnique({
    where: {
      slug: courseSlug
    }
  });

  if (!course) {
    throw new NotFoundError(`Course not found: ${courseSlug}`);
  }

  return course;
}

export async function requireCourseAssessment(
  tx: TransactionClient,
  courseSlug: string,
  assessmentSlug: string
) {
  const course = await requireCourse(tx, courseSlug);
  const assessment = await tx.courseAssessment.findUnique({
    where: {
      courseId_slug: {
        courseId: course.id,
        slug: assessmentSlug
      }
    }
  });

  if (!assessment) {
    throw new NotFoundError(`Assessment not found: ${courseSlug}/${assessmentSlug}`);
  }

  return {
    assessment,
    course
  };
}

// --- Problem mutations ---

export async function replaceTemplates(
  tx: TransactionClient,
  problemId: string,
  templates: { driverCode: string; insertionMarker: string; language: string; templateCode: string }[]
) {
  await tx.problemTemplate.deleteMany({ where: { problemId } });

  if (templates.length > 0) {
    await tx.problemTemplate.createMany({
      data: templates.map((tpl) => ({
        driverCode: tpl.driverCode,
        insertionMarker: tpl.insertionMarker,
        language: tpl.language as any,
        problemId,
        templateCode: tpl.templateCode
      }))
    });
  }
}

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

    const problem = await createProblemDefinition(tx, slug, {
      authorId: author.id,
      checkerScript: payload.checkerScript,
      difficulty: payload.difficulty,
      inputFormat: payload.inputFormat,
      interactorScript: payload.interactorScript,
      judgeType: payload.judgeType,
      memoryLimitMb: payload.memoryLimitMb,
      outputFormat: payload.outputFormat,
      statement: payload.statement,
      submissionType: payload.submissionType,
      summary: payload.summary,
      tags: payload.tags,
      timeLimitMs: payload.timeLimitMs,
      title: payload.title,
      visibility: payload.visibility
    });

    if (payload.templates.length > 0) {
      await replaceTemplates(tx, problem.id, payload.templates);
    }

    return problem;
  });
}

export async function updateProblemRecord(
  actor: CompletedActorContext,
  problemSlug: string,
  payload: ProblemUpdate
) {
  return prisma.$transaction(async (tx) => {
    const problem = await requireProblem(tx, problemSlug);

    if (actor.platformRole !== "admin" && problem.authorId !== actor.userId) {
      throw new ForbiddenError("Only the author or an admin can update this problem.");
    }

    // Build the problem update data — only include fields that were provided
    const updateData: Record<string, unknown> = {};
    if (payload.title !== undefined) updateData.defaultTitle = payload.title;
    if (payload.difficulty !== undefined) updateData.difficulty = payload.difficulty;
    if (payload.visibility !== undefined) updateData.visibility = payload.visibility;
    if (payload.tags !== undefined) updateData.tags = payload.tags;
    if (payload.judgeType !== undefined) updateData.judgeType = payload.judgeType;
    if (payload.submissionType !== undefined) updateData.submissionType = payload.submissionType;
    if (payload.timeLimitMs !== undefined) updateData.timeLimitMs = payload.timeLimitMs;
    if (payload.memoryLimitMb !== undefined) updateData.memoryLimitMb = payload.memoryLimitMb;
    if (payload.checkerScript !== undefined) updateData.checkerScript = payload.checkerScript;
    if (payload.interactorScript !== undefined)
      updateData.interactorScript = payload.interactorScript;
    if (payload.summary !== undefined) updateData.summary = payload.summary;

    if (Object.keys(updateData).length > 0) {
      await tx.problem.update({
        data: updateData,
        where: { id: problem.id }
      });
    }

    // Update statement if provided
    if (payload.statement !== undefined || payload.inputFormat !== undefined || payload.outputFormat !== undefined) {
      await tx.problemStatementI18n.upsert({
        create: {
          bodyMarkdown: payload.statement ?? "",
          inputFormat: payload.inputFormat ?? "",
          locale: DEFAULT_LOCALE,
          outputFormat: payload.outputFormat ?? "",
          problemId: problem.id,
          title: payload.title ?? problem.defaultTitle
        },
        update: {
          ...(payload.statement !== undefined ? { bodyMarkdown: payload.statement } : {}),
          ...(payload.inputFormat !== undefined ? { inputFormat: payload.inputFormat } : {}),
          ...(payload.outputFormat !== undefined ? { outputFormat: payload.outputFormat } : {}),
          ...(payload.title !== undefined ? { title: payload.title } : {})
        },
        where: {
          problemId_locale: { locale: DEFAULT_LOCALE, problemId: problem.id }
        }
      });
    }

    // Update templates if provided
    if (payload.templates !== undefined) {
      await replaceTemplates(tx, problem.id, payload.templates);
    }

    return { id: problem.id };
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

    await tx.testcase.createMany({
      data: payload.cases.map((testcase, index) => ({
        expectedStdout: testcase.expectedStdout,
        ordinal: index + 1,
        stdin: testcase.stdin,
        testcaseSetId: testcaseSet.id
      }))
    });

    return {
      caseCount: payload.cases.length,
      id: testcaseSet.id,
      isHidden: testcaseSet.isHidden,
      name: testcaseSet.name
    };
  });
}

// --- Course mutations ---

function buildJoinCode(slug: string) {
  return slug.replaceAll(/-/g, "").toUpperCase().slice(0, 10);
}

function buildQrToken(slug: string) {
  return `${slug}-qr`;
}

function defaultScoreboardMode(type: CourseAssessmentType) {
  return type === "exam" ? "live" : "hidden";
}

export async function createCourseRecord(actor: CompletedActorContext, payload: CourseCreate) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.course.findUnique({
      where: {
        slug: payload.slug
      }
    });

    if (existing) {
      throw new ConflictError(`Course slug already exists: ${payload.slug}`);
    }

    const owner = await ensureUser(tx, actor.userId, actor);
    const course = await tx.course.create({
      data: {
        description: payload.description,
        locale: payload.locale,
        ownerId: owner.id,
        slug: payload.slug,
        title: payload.title,
        visibility: "invite_only"
      }
    });

    await tx.courseMembership.create({
      data: {
        addedByUserId: owner.id,
        courseId: course.id,
        joinedAt: new Date(),
        joinedVia: "manual_invite",
        role: "teacher",
        status: "active",
        userId: owner.id
      }
    });

    const joinCode = buildJoinCode(payload.slug);
    const qrToken = buildQrToken(payload.slug);

    const joinTokens = await Promise.all([
      tx.courseJoinToken.create({
        data: {
          courseId: course.id,
          createdByUserId: owner.id,
          label: "Course code",
          method: "join_code",
          token: joinCode
        }
      }),
      tx.courseJoinToken.create({
        data: {
          courseId: course.id,
          createdByUserId: owner.id,
          label: "Course QR",
          method: "qr_code",
          token: qrToken
        }
      })
    ]);

    return {
      course,
      joinTokens
    };
  });
}

export async function attachProblemToCourseRecord(
  actor: CompletedActorContext,
  payload: CourseProblemAttach
) {
  return prisma.$transaction(async (tx) => {
    const user = await ensureUser(tx, actor.userId, actor);
    const course = await requireCourse(tx, payload.courseSlug);
    const problem = await requireProblem(tx, payload.problemSlug);
    assertCourseProblemAccess(problem, actor);

    return tx.courseProblem.upsert({
      create: {
        addedByUserId: user.id,
        courseId: course.id,
        problemId: problem.id
      },
      update: {
        addedByUserId: user.id
      },
      where: {
        courseId_problemId: {
          courseId: course.id,
          problemId: problem.id
        }
      }
    });
  });
}

export async function joinCourseRecord(
  actor: CompletedActorContext,
  payload: CourseJoinRequest
) {
  return prisma.$transaction(async (tx) => {
    const user = await ensureUser(tx, actor.userId, actor);
    const course = await requireCourse(tx, payload.courseSlug);
    const [existingMembership, joinToken] = await Promise.all([
      tx.courseMembership.findUnique({
        where: {
          courseId_userId: {
            courseId: course.id,
            userId: user.id
          }
        }
      }),
      tx.courseJoinToken.findFirst({
        where: {
          courseId: course.id,
          method: payload.joinMethod,
          token: payload.joinToken
        }
      })
    ]);

    if (!joinToken) {
      throw new ForbiddenError("Course join token is invalid.");
    }

    if (joinToken.expiresAt && joinToken.expiresAt < new Date()) {
      throw new ForbiddenError("Course join token has expired.");
    }

    if (joinToken.maxUses !== null && joinToken.usageCount >= joinToken.maxUses) {
      throw new ForbiddenError("Course join token has reached its maximum usage.");
    }

    if (existingMembership?.status === "active") {
      return existingMembership;
    }

    const membership = await tx.courseMembership.upsert({
      create: {
        courseId: course.id,
        joinedAt: new Date(),
        joinedVia: payload.joinMethod,
        role: "student",
        status: "active",
        userId: user.id
      },
      update: {
        joinedAt: new Date(),
        joinedVia: payload.joinMethod,
        role: "student",
        status: "active"
      },
      where: {
        courseId_userId: {
          courseId: course.id,
          userId: user.id
        }
      }
    });

    await tx.courseJoinToken.update({
      data: {
        usageCount: {
          increment: 1
        }
      },
      where: {
        id: joinToken.id
      }
    });

    return membership;
  });
}

export async function manuallyEnrollCourseMember(
  actor: CompletedActorContext,
  payload: ManualCourseEnrollment
) {
  return prisma.$transaction(async (tx) => {
    const course = await requireCourse(tx, payload.courseSlug);
    const manager = await ensureUser(tx, actor.userId, actor);
    const user = await ensureUser(tx, `usr_${payload.handle}`, {
      displayName: payload.displayName,
      email: payload.email,
      handle: payload.handle,
      locale: "zh-TW",
      platformRole: payload.role === "teacher" ? "teacher" : "student"
    });

    return tx.courseMembership.upsert({
      create: {
        addedByUserId: manager.id,
        courseId: course.id,
        joinedAt: new Date(),
        joinedVia: "manual_invite",
        role: payload.role,
        status: "active",
        userId: user.id
      },
      update: {
        addedByUserId: manager.id,
        joinedAt: new Date(),
        joinedVia: "manual_invite",
        role: payload.role,
        status: "active"
      },
      where: {
        courseId_userId: {
          courseId: course.id,
          userId: user.id
        }
      }
    });
  });
}

export async function createCourseAssessmentRecord(
  actor: CompletedActorContext,
  payload: CourseAssessmentCreate
) {
  return prisma.$transaction(async (tx) => {
    const course = await requireCourse(tx, payload.courseSlug);
    const creator = await ensureUser(tx, actor.userId, actor);
    const existing = await tx.courseAssessment.findUnique({
      where: {
        courseId_slug: {
          courseId: course.id,
          slug: payload.slug
        }
      }
    });

    if (existing) {
      throw new ConflictError(`Assessment slug already exists in course: ${payload.slug}`);
    }

    const assessment = await tx.courseAssessment.create({
      data: {
        closesAt: new Date(payload.closesAt),
        courseId: course.id,
        createdByUserId: creator.id,
        dueAt: new Date(payload.dueAt),
        ipLockEnabled: payload.ipLockEnabled,
        opensAt: new Date(payload.opensAt),
        pageLockEnabled: payload.pageLockEnabled,
        scoreboardMode: payload.scoreboardMode ?? defaultScoreboardMode(payload.type),
        slug: payload.slug,
        status: "published",
        summary: payload.summary,
        title: payload.title,
        type: payload.type
      }
    });

    const problems = await tx.problem.findMany({
      where: { slug: { in: payload.problemSlugs } }
    });
    const problemBySlug = new Map(problems.map((p) => [p.slug, p]));

    for (const slug of payload.problemSlugs) {
      const problem = problemBySlug.get(slug);
      if (!problem) {
        throw new NotFoundError(`Problem not found: ${slug}`);
      }
      assertCourseProblemAccess(problem, actor);
    }

    await Promise.all(
      payload.problemSlugs.map(async (slug, index) => {
        // Safe: validated in the loop above that all slugs exist in the map
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const problem = problemBySlug.get(slug)!;
        await tx.courseProblem.upsert({
          create: {
            addedByUserId: creator.id,
            courseId: course.id,
            problemId: problem.id
          },
          update: {
            addedByUserId: creator.id
          },
          where: {
            courseId_problemId: {
              courseId: course.id,
              problemId: problem.id
            }
          }
        });
        await tx.courseAssessmentProblem.create({
          data: {
            assessmentId: assessment.id,
            ordinal: index + 1,
            points: 100,
            problemId: problem.id
          }
        });
      })
    );

    return assessment;
  });
}

// --- Submission mutations ---

export async function createQueuedSubmissionRecord(
  payload: SubmissionDraft,
  actor: CompletedActorContext
) {
  return prisma.$transaction(async (tx) => {
    const user = await ensureUser(tx, actor.userId, actor);
    const problem = await requireProblem(tx, payload.problemSlug);
    const contestParticipation = payload.contestSlug
      ? await ensureContestParticipation(tx, user.id, payload.contestSlug)
      : null;
    const courseContext = payload.assessment
      ? await requireCourseAssessment(
          tx,
          payload.assessment.courseSlug,
          payload.assessment.assessmentSlug
        )
      : null;

    // Enforce attempt limit for assignment/exam submissions (not sampleOnly runs)
    if (courseContext?.assessment && !payload.sampleOnly) {
      const { maxAttempts } = courseContext.assessment;

      if (maxAttempts != null) {
        const attemptCount = await tx.submission.count({
          where: {
            courseAssessmentId: courseContext.assessment.id,
            problemId: problem.id,
            sampleOnly: false,
            userId: user.id
          }
        });

        if (attemptCount >= maxAttempts) {
          throw new Error(
            `Attempt limit reached (${String(maxAttempts)}/${String(maxAttempts)}).`
          );
        }
      }
    }

    return tx.submission.create({
      data: {
        contestParticipationId: contestParticipation?.id ?? null,
        courseAssessmentId: courseContext?.assessment.id ?? null,
        courseId: courseContext?.course.id ?? null,
        language: payload.language,
        mode: payload.mode,
        problemId: problem.id,
        sampleOnly: payload.sampleOnly ?? false,
        sourceCode: payload.sourceCode,
        status: "queued",
        userId: user.id
      }
    });
  });
}
