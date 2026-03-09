import { prisma, type TransactionClient } from "@nojv/db";
import {
  type CourseAssessmentType,
  type CourseCreate,
  type CourseJoinRequest,
  type CourseProblemAttach,
  evaluateIntegritySignals,
  type ManualCourseEnrollment,
  type ProblemCreate,
  type ProblemTestcaseSetCreate,
  type CheatingSignal,
  type SubmissionDraft,
  type SubmissionResult,
  type WorkspaceRunRequest,
  type WorkspaceRunResult
} from "@nojv/domain";

import type { PocActorContext } from "./actor-context";
import { resolveCoursePermissionRole } from "./course-authorization";
import {
  buildCheatingCaseSummary,
  mapIntegrityAssessmentToCaseStatus,
  mapSubmissionResultToStatus,
  mapWorkspaceRunResultToStatus
} from "./persistence-mappers";

const defaultPocUserId = "usr_demo_problem_editor";
const signalTypeMap = {
  concurrent_session: "concurrent_session",
  focus_loss: "focus_loss",
  ip_change: "ip_change",
  paste_burst: "paste_burst",
  shell_policy_violation: "shell_policy_violation",
  similarity_match: "similarity_match"
} as const;

function sanitizeIdentitySegment(userId: string) {
  const normalized = userId.toLowerCase().replaceAll(/[^a-z0-9._-]/g, "-");

  return normalized.length > 0 ? normalized : "poc-user";
}

function createDemoEmail(userId: string) {
  return `${sanitizeIdentitySegment(userId)}@poc.nojv.local`;
}

function createDemoDisplayName(userId: string) {
  return `POC ${userId.replaceAll(/[_-]+/g, " ")}`;
}

function createDemoHandle(userId: string) {
  return sanitizeIdentitySegment(userId);
}

interface EnsureUserInput {
  displayName?: string;
  email?: string;
  handle?: string;
  locale?: string;
  platformRole?: "admin" | "student" | "ta" | "teacher";
}

async function ensureUser(tx: TransactionClient, userId: string, input: EnsureUserInput = {}) {
  const email = input.email ?? createDemoEmail(userId);
  const handle = input.handle ?? createDemoHandle(userId);
  const existing = await tx.user.findFirst({
    where: {
      OR: [{ email }, { handle }, { id: userId }]
    }
  });

  const data = {
    name: input.displayName ?? createDemoDisplayName(userId),
    email,
    handle,
    locale: input.locale ?? "zh-TW",
    platformRole: input.platformRole ?? "student"
  } as const;

  if (existing) {
    return tx.user.update({
      data,
      where: {
        id: existing.id
      }
    });
  }

  return tx.user.create({
    data: {
      ...data,
      id: userId
    }
  });
}

interface EnsureProblemInput {
  authorId?: string;
  difficulty?: "easy" | "hard" | "medium";
  memoryLimitMb?: number;
  statement?: string;
  summary?: string;
  timeLimitMs?: number;
  title?: string;
  visibility?: "private" | "public";
}

async function ensureProblem(
  tx: TransactionClient,
  problemSlug: string,
  input: EnsureProblemInput = {}
) {
  const title = input.title;
  const difficulty = input.difficulty;
  const summary = input.summary;

  if (!title || !difficulty || !summary) {
    throw new Error(`Problem slug requires title, difficulty, and summary: ${problemSlug}`);
  }

  return tx.problem
    .upsert({
      create: {
        authorId: input.authorId ?? null,
        defaultTitle: title,
        difficulty,
        id: `problem_${problemSlug}`,
        memoryLimitMb: input.memoryLimitMb ?? 256,
        slug: problemSlug,
        summary,
        timeLimitMs: input.timeLimitMs ?? 1_000,
        visibility: input.visibility ?? "public"
      },
      update: {
        defaultTitle: title,
        difficulty,
        ...(input.authorId ? { authorId: input.authorId } : {}),
        summary,
        visibility: input.visibility ?? "public"
      },
      where: {
        slug: problemSlug
      }
    })
    .then(async (persistedProblem) => {
      if (input.statement) {
        await tx.problemStatementI18n.upsert({
          create: {
            bodyMarkdown: input.statement,
            locale: "zh-TW",
            problemId: persistedProblem.id,
            title
          },
          update: {
            bodyMarkdown: input.statement,
            title
          },
          where: {
            problemId_locale: {
              locale: "zh-TW",
              problemId: persistedProblem.id
            }
          }
        });
      }

      return persistedProblem;
    });
}

async function findOrEnsureProblem(tx: TransactionClient, problemSlug: string) {
  const existing = await tx.problem.findUnique({
    where: {
      slug: problemSlug
    }
  });

  if (existing) {
    return existing;
  }

  return ensureProblem(tx, problemSlug);
}

function assertCourseProblemAccess(
  problem: { authorId: string | null; visibility: string },
  actor: PocActorContext
) {
  if (
    problem.visibility === "private" &&
    actor.platformRole !== "admin" &&
    problem.authorId !== actor.userId
  ) {
    throw new Error("Private problems can only be attached by their author or an admin.");
  }
}

async function ensureContest(tx: TransactionClient, contestSlug: string) {
  const contest = await tx.contest.findUnique({
    where: { slug: contestSlug }
  });

  if (!contest) {
    throw new Error(`Contest not found: ${contestSlug}`);
  }

  return contest;
}

async function ensureContestParticipation(
  tx: TransactionClient,
  userId: string,
  contestSlug: string
) {
  const contest = await ensureContest(tx, contestSlug);

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

async function ensureCourse(tx: TransactionClient, courseSlug: string) {
  const existing = await tx.course.findUnique({
    where: {
      slug: courseSlug
    }
  });

  if (!existing) {
    throw new Error(`Course not found: ${courseSlug}`);
  }

  return existing;
}

async function ensureCourseAssessment(
  tx: TransactionClient,
  courseSlug: string,
  assessmentSlug: string
) {
  const course = await ensureCourse(tx, courseSlug);
  const assessment = await tx.courseAssessment.findUnique({
    where: {
      courseId_slug: {
        courseId: course.id,
        slug: assessmentSlug
      }
    }
  });

  if (!assessment) {
    throw new Error(`Assessment not found: ${courseSlug}/${assessmentSlug}`);
  }

  return {
    assessment,
    course
  };
}

async function resolveCoursePermission(
  tx: TransactionClient,
  courseSlug: string,
  actor: PocActorContext
) {
  const course = await ensureCourse(tx, courseSlug);
  const membership = await tx.courseMembership.findUnique({
    where: {
      courseId_userId: {
        courseId: course.id,
        userId: actor.userId
      }
    }
  });

  return {
    course,
    role: resolveCoursePermissionRole({
      courseRole: membership?.role ?? null,
      platformRole: actor.platformRole
    })
  };
}

function resolveWorkspaceSessionId(request: WorkspaceRunRequest) {
  if (!request.workspaceSessionId) {
    throw new Error("workspaceSessionId is required for persistence.");
  }

  return request.workspaceSessionId;
}

async function upsertWorkspaceSession(
  tx: TransactionClient,
  payload: WorkspaceRunRequest,
  userId: string,
  contestParticipationId?: string,
  courseId?: string,
  courseAssessmentId?: string
) {
  const workspaceSessionId = resolveWorkspaceSessionId(payload);

  return tx.workspaceSession.upsert({
    create: {
      contestParticipationId: contestParticipationId ?? null,
      courseAssessmentId: courseAssessmentId ?? null,
      courseId: courseId ?? null,
      id: workspaceSessionId,
      imageTag: `poc/${payload.mode}:latest`,
      lastHeartbeatAt: new Date(),
      metadata: {
        assessment: payload.assessment ?? null,
        contestSlug: payload.contestSlug ?? null,
        lastCommand: payload.command
      },
      mode: payload.mode,
      startedAt: new Date(),
      status: "active",
      userId
    },
    update: {
      contestParticipationId: contestParticipationId ?? null,
      courseAssessmentId: courseAssessmentId ?? null,
      courseId: courseId ?? null,
      imageTag: `poc/${payload.mode}:latest`,
      lastHeartbeatAt: new Date(),
      metadata: {
        assessment: payload.assessment ?? null,
        contestSlug: payload.contestSlug ?? null,
        lastCommand: payload.command
      },
      mode: payload.mode,
      status: "active"
    },
    where: {
      id: workspaceSessionId
    }
  });
}

async function upsertCheatingCase(tx: TransactionClient, signals: CheatingSignal[]) {
  const firstSignal = signals[0];

  if (!firstSignal) {
    throw new Error("At least one cheating signal is required.");
  }

  const assessment = evaluateIntegritySignals(signals);
  const contest = firstSignal.contestSlug
    ? await ensureContest(tx, firstSignal.contestSlug)
    : null;
  const courseContext = firstSignal.assessment
    ? await ensureCourseAssessment(
        tx,
        firstSignal.assessment.courseSlug,
        firstSignal.assessment.assessmentSlug
      )
    : null;
  const existingCase = await tx.cheatingCase.findFirst({
    orderBy: {
      openedAt: "desc"
    },
    where: {
      courseAssessmentId: courseContext?.assessment.id ?? null,
      courseId: courseContext?.course.id ?? null,
      contestId: contest?.id ?? null,
      status: {
        in: ["open", "under_review"]
      },
      userId: firstSignal.userId
    }
  });

  const data = {
    courseAssessmentId: courseContext?.assessment.id ?? null,
    courseId: courseContext?.course.id ?? null,
    contestId: contest?.id ?? null,
    score: assessment.score,
    status: mapIntegrityAssessmentToCaseStatus(assessment),
    summary: buildCheatingCaseSummary(assessment, signals.length),
    userId: firstSignal.userId
  } as const;

  if (existingCase) {
    return tx.cheatingCase.update({
      data,
      where: {
        id: existingCase.id
      }
    });
  }

  return tx.cheatingCase.create({
    data
  });
}

export async function persistSubmissionRecord(
  payload: SubmissionDraft,
  result: SubmissionResult,
  actor?: PocActorContext
) {
  return prisma.$transaction(async (tx) => {
    const activeActor = actor ?? {
      displayName: createDemoDisplayName(defaultPocUserId),
      email: createDemoEmail(defaultPocUserId),
      handle: createDemoHandle(defaultPocUserId),
      platformRole: "student" as const,
      userId: defaultPocUserId
    };
    const user = await ensureUser(tx, activeActor.userId, activeActor);
    const problem = await findOrEnsureProblem(tx, payload.problemSlug);
    const contestParticipation = payload.contestSlug
      ? await ensureContestParticipation(tx, user.id, payload.contestSlug)
      : null;
    const courseContext = payload.assessment
      ? await ensureCourseAssessment(
          tx,
          payload.assessment.courseSlug,
          payload.assessment.assessmentSlug
        )
      : null;

    return tx.submission.create({
      data: {
        compilerOutput: result.verdict === "compile_error" ? result.feedback : null,
        contestParticipationId: contestParticipation?.id ?? null,
        courseAssessmentId: courseContext?.assessment.id ?? null,
        courseId: courseContext?.course.id ?? null,
        language: payload.language,
        mode: payload.mode,
        problemId: problem.id,
        runtimeMs: result.runtimeMs,
        score: result.score,
        sourceCode: payload.sourceCode,
        status: mapSubmissionResultToStatus(result),
        userId: user.id,
        verdictDetail: result
      }
    });
  });
}

export async function createQueuedSubmissionRecord(
  payload: SubmissionDraft,
  actor?: PocActorContext
) {
  return prisma.$transaction(async (tx) => {
    const activeActor = actor ?? {
      displayName: createDemoDisplayName(defaultPocUserId),
      email: createDemoEmail(defaultPocUserId),
      handle: createDemoHandle(defaultPocUserId),
      platformRole: "student" as const,
      userId: defaultPocUserId
    };
    const user = await ensureUser(tx, activeActor.userId, activeActor);
    const problem = await findOrEnsureProblem(tx, payload.problemSlug);
    const contestParticipation = payload.contestSlug
      ? await ensureContestParticipation(tx, user.id, payload.contestSlug)
      : null;
    const courseContext = payload.assessment
      ? await ensureCourseAssessment(
          tx,
          payload.assessment.courseSlug,
          payload.assessment.assessmentSlug
        )
      : null;

    return tx.submission.create({
      data: {
        contestParticipationId: contestParticipation?.id ?? null,
        courseAssessmentId: courseContext?.assessment.id ?? null,
        courseId: courseContext?.course.id ?? null,
        language: payload.language,
        mode: payload.mode,
        problemId: problem.id,
        sourceCode: payload.sourceCode,
        status: "queued",
        userId: user.id
      }
    });
  });
}

export async function persistWorkspaceRunRecord(
  payload: WorkspaceRunRequest,
  result: WorkspaceRunResult,
  actor?: PocActorContext
) {
  return prisma.$transaction(async (tx) => {
    const activeActor = actor ?? {
      displayName: createDemoDisplayName(defaultPocUserId),
      email: createDemoEmail(defaultPocUserId),
      handle: createDemoHandle(defaultPocUserId),
      platformRole: "student" as const,
      userId: defaultPocUserId
    };
    const user = await ensureUser(tx, activeActor.userId, activeActor);
    const contestParticipation = payload.contestSlug
      ? await ensureContestParticipation(tx, user.id, payload.contestSlug)
      : null;
    const courseContext = payload.assessment
      ? await ensureCourseAssessment(
          tx,
          payload.assessment.courseSlug,
          payload.assessment.assessmentSlug
        )
      : null;
    const workspaceSession = await upsertWorkspaceSession(
      tx,
      payload,
      user.id,
      contestParticipation?.id,
      courseContext?.course.id,
      courseContext?.assessment.id
    );
    const finishedAt = new Date();
    const startedAt = new Date(finishedAt.getTime() - result.durationMs);
    const workspaceRun = await tx.workspaceRun.create({
      data: {
        command: payload.command,
        contestParticipationId: contestParticipation?.id ?? null,
        courseAssessmentId: courseContext?.assessment.id ?? null,
        courseId: courseContext?.course.id ?? null,
        exitCode: result.exitCode,
        finishedAt,
        mode: payload.mode,
        startedAt,
        status: mapWorkspaceRunResultToStatus(result),
        stderr: result.stderr,
        stdout: result.stdout,
        userId: user.id,
        workspaceSessionId: workspaceSession.id
      }
    });

    if (result.status === "blocked") {
      const signal: CheatingSignal = {
        capturedAt: finishedAt.toISOString(),
        confidence: 0.96,
        contestSlug: payload.contestSlug,
        payload: {
          assessmentSlug: payload.assessment?.assessmentSlug ?? null,
          command: payload.command,
          stderr: result.stderr
        },
        sessionId: workspaceSession.id,
        source:
          payload.mode === "contest" || payload.mode === "exam"
            ? "contest_workspace"
            : "workspace_terminal",
        type: "shell_policy_violation",
        userId: user.id
      };
      const cheatingCase = await upsertCheatingCase(tx, [signal]);

      await tx.cheatingSignal.create({
        data: {
          cheatingCaseId: cheatingCase.id,
          confidence: signal.confidence,
          contestParticipationId: contestParticipation?.id ?? null,
          courseAssessmentId: courseContext?.assessment.id ?? null,
          courseId: courseContext?.course.id ?? null,
          occurredAt: new Date(signal.capturedAt),
          payload: {
            ...signal.payload,
            source: signal.source
          },
          type: signalTypeMap[signal.type],
          userId: signal.userId,
          workspaceRunId: workspaceRun.id,
          workspaceSessionId: workspaceSession.id
        }
      });
    }

    return workspaceRun;
  });
}

export async function createQueuedWorkspaceRunRecord(
  payload: WorkspaceRunRequest,
  actor?: PocActorContext
) {
  return prisma.$transaction(async (tx) => {
    const activeActor = actor ?? {
      displayName: createDemoDisplayName(defaultPocUserId),
      email: createDemoEmail(defaultPocUserId),
      handle: createDemoHandle(defaultPocUserId),
      platformRole: "student" as const,
      userId: defaultPocUserId
    };
    const user = await ensureUser(tx, activeActor.userId, activeActor);
    const contestParticipation = payload.contestSlug
      ? await ensureContestParticipation(tx, user.id, payload.contestSlug)
      : null;
    const courseContext = payload.assessment
      ? await ensureCourseAssessment(
          tx,
          payload.assessment.courseSlug,
          payload.assessment.assessmentSlug
        )
      : null;
    const workspaceSession = await upsertWorkspaceSession(
      tx,
      payload,
      user.id,
      contestParticipation?.id,
      courseContext?.course.id,
      courseContext?.assessment.id
    );

    return tx.workspaceRun.create({
      data: {
        command: payload.command,
        contestParticipationId: contestParticipation?.id ?? null,
        courseAssessmentId: courseContext?.assessment.id ?? null,
        courseId: courseContext?.course.id ?? null,
        mode: payload.mode,
        status: "queued",
        userId: user.id,
        workspaceSessionId: workspaceSession.id
      }
    });
  });
}

export async function persistCheatingSignals(signals: CheatingSignal[]) {
  if (signals.length === 0) {
    return [];
  }

  return prisma.$transaction(async (tx) => {
    const groupedSignals = new Map<string, CheatingSignal[]>();

    for (const signal of signals) {
      const key = `${signal.userId}::${signal.contestSlug ?? "practice"}::${signal.assessment?.courseSlug ?? "course"}::${signal.assessment?.assessmentSlug ?? "none"}`;
      const current = groupedSignals.get(key) ?? [];
      groupedSignals.set(key, [...current, signal]);
    }

    const persisted = [];

    for (const group of groupedSignals.values()) {
      const firstSignal = group[0];

      if (!firstSignal) {
        continue;
      }

      const user = await ensureUser(tx, firstSignal.userId);
      const contestParticipation = firstSignal.contestSlug
        ? await ensureContestParticipation(tx, user.id, firstSignal.contestSlug)
        : null;
      const cheatingCase = await upsertCheatingCase(tx, group);
      for (const signal of group) {
        const workspaceSession = signal.sessionId
          ? await tx.workspaceSession.findUnique({
              where: {
                id: signal.sessionId
              }
            })
          : null;
        const workspaceRun = workspaceSession
          ? await tx.workspaceRun.findFirst({
              orderBy: {
                createdAt: "desc"
              },
              where: {
                workspaceSessionId: workspaceSession.id
              }
            })
          : null;
        const assessmentContext = signal.assessment
          ? await ensureCourseAssessment(
              tx,
              signal.assessment.courseSlug,
              signal.assessment.assessmentSlug
            )
          : null;
        const record = await tx.cheatingSignal.create({
          data: {
            cheatingCaseId: cheatingCase.id,
            confidence: signal.confidence,
            contestParticipationId: contestParticipation?.id ?? null,
            courseAssessmentId: assessmentContext?.assessment.id ?? null,
            courseId: assessmentContext?.course.id ?? null,
            occurredAt: new Date(signal.capturedAt),
            payload: {
              assessment: signal.assessment ?? null,
              ...signal.payload,
              source: signal.source
            },
            type: signalTypeMap[signal.type],
            userId: signal.userId,
            workspaceRunId: workspaceRun?.id ?? null,
            workspaceSessionId: workspaceSession?.id ?? null
          }
        });

        persisted.push(record);
      }
    }

    return persisted;
  });
}

function buildJoinCode(slug: string) {
  return slug.replaceAll(/-/g, "").toUpperCase().slice(0, 10);
}

function buildQrToken(slug: string) {
  return `${slug}-qr`;
}

function defaultScoreboardMode(type: CourseAssessmentType) {
  return type === "exam" ? "live" : "hidden";
}

export async function getCoursePermissionRole(courseSlug: string, actor: PocActorContext) {
  return prisma.$transaction(async (tx) => {
    const { role } = await resolveCoursePermission(tx, courseSlug, actor);

    return role;
  });
}

export async function createCourseRecord(actor: PocActorContext, payload: CourseCreate) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.course.findUnique({
      where: {
        slug: payload.slug
      }
    });

    if (existing) {
      throw new Error(`Course slug already exists: ${payload.slug}`);
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

export async function createProblemRecord(actor: PocActorContext, payload: ProblemCreate) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.problem.findUnique({
      where: {
        slug: payload.slug
      }
    });

    if (existing) {
      throw new Error(`Problem slug already exists: ${payload.slug}`);
    }

    const author = await ensureUser(tx, actor.userId, actor);

    return ensureProblem(tx, payload.slug, {
      authorId: author.id,
      difficulty: payload.difficulty,
      statement: payload.statement,
      summary: payload.summary,
      title: payload.title,
      visibility: payload.visibility
    });
  });
}

export async function createProblemTestcaseSetRecord(
  actor: PocActorContext,
  problemSlug: string,
  payload: ProblemTestcaseSetCreate
) {
  return prisma.$transaction(async (tx) => {
    const problem = await tx.problem.findUnique({
      where: {
        slug: problemSlug
      }
    });

    if (!problem) {
      throw new Error(`Problem not found: ${problemSlug}`);
    }

    if (actor.platformRole !== "admin" && problem.authorId !== actor.userId) {
      throw new Error("Problem testcases can only be managed by the author or an admin.");
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

export async function attachProblemToCourseRecord(
  actor: PocActorContext,
  payload: CourseProblemAttach
) {
  return prisma.$transaction(async (tx) => {
    const user = await ensureUser(tx, actor.userId, actor);
    const course = await ensureCourse(tx, payload.courseSlug);
    const problem = await findOrEnsureProblem(tx, payload.problemSlug);
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

export async function joinCourseRecord(actor: PocActorContext, payload: CourseJoinRequest) {
  return prisma.$transaction(async (tx) => {
    const user = await ensureUser(tx, actor.userId, actor);
    const course = await ensureCourse(tx, payload.courseSlug);
    const existingMembership = await tx.courseMembership.findUnique({
      where: {
        courseId_userId: {
          courseId: course.id,
          userId: user.id
        }
      }
    });
    const joinToken = await tx.courseJoinToken.findFirst({
      where: {
        courseId: course.id,
        method: payload.joinMethod,
        token: payload.joinToken
      }
    });

    if (!joinToken) {
      throw new Error("Course join token is invalid.");
    }

    if (joinToken.expiresAt && joinToken.expiresAt < new Date()) {
      throw new Error("Course join token has expired.");
    }

    if (joinToken.maxUses !== null && joinToken.usageCount >= joinToken.maxUses) {
      throw new Error("Course join token has reached its maximum usage.");
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
  actor: PocActorContext,
  payload: ManualCourseEnrollment
) {
  return prisma.$transaction(async (tx) => {
    const course = await ensureCourse(tx, payload.courseSlug);
    const manager = await ensureUser(tx, actor.userId, actor);
    const user = await ensureUser(tx, `usr_${sanitizeIdentitySegment(payload.handle)}`, {
      displayName: payload.displayName,
      email: payload.email,
      handle: payload.handle,
      locale: "zh-TW",
      platformRole: payload.role
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
  actor: PocActorContext,
  payload: {
    closesAt: string;
    courseSlug: string;
    dueAt: string;
    opensAt: string;
    problemSlugs: string[];
    scoreboardMode?: "frozen" | "hidden" | "live" | undefined;
    slug: string;
    summary: string;
    title: string;
    type: CourseAssessmentType;
  }
) {
  return prisma.$transaction(async (tx) => {
    const course = await ensureCourse(tx, payload.courseSlug);
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
      throw new Error(`Assessment slug already exists in course: ${payload.slug}`);
    }

    const assessment = await tx.courseAssessment.create({
      data: {
        closesAt: new Date(payload.closesAt),
        courseId: course.id,
        createdByUserId: creator.id,
        dueAt: new Date(payload.dueAt),
        opensAt: new Date(payload.opensAt),
        scoreboardMode: payload.scoreboardMode ?? defaultScoreboardMode(payload.type),
        slug: payload.slug,
        status: "published",
        summary: payload.summary,
        title: payload.title,
        type: payload.type
      }
    });

    for (const [index, problemSlug] of payload.problemSlugs.entries()) {
      const problem = await findOrEnsureProblem(tx, problemSlug);
      assertCourseProblemAccess(problem, actor);

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
    }

    return assessment;
  });
}

export async function getPocRuntimeStats() {
  const [submissions, workspaceRuns, cheatingSignals, cheatingCases] = await Promise.all([
    prisma.submission.count(),
    prisma.workspaceRun.count(),
    prisma.cheatingSignal.count(),
    prisma.cheatingCase.count()
  ]);

  return {
    cheatingCases,
    cheatingSignals,
    submissions,
    workspaceRuns
  };
}
