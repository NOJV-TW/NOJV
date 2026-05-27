import type { Prisma, PrismaClient, User } from "../../generated/prisma/client";
import {
  buildVerdictDetail,
  DAY,
  HOUR,
  loadProblemTestcases,
  sampleSource,
  SeededRng,
} from "./demo-helpers";

const HW1_ID = "hw1-process-trace";
const SPRING_CONTEST_ID = "spring-qualifier-2026";
const LIVE_CONTEST_ID = "contest_demo_live";

/**
 * Ensure `author` has a non-sample accepted submission on `problemId` so the
 * editorial AC-gate is satisfied. Creates a practice AC if none exists.
 */
async function ensureAcceptedPractice(
  prisma: PrismaClient,
  author: User,
  problemId: string,
  rng: SeededRng,
  when: Date,
): Promise<void> {
  const existing = await prisma.submission.count({
    where: { userId: author.id, problemId, status: "accepted", sampleOnly: false },
  });
  if (existing > 0) return;

  const testcases = await loadProblemTestcases(prisma, problemId);
  const { detail, score, runtimeMs, memoryKb } = buildVerdictDetail({
    verdict: "accepted",
    language: "cpp",
    testcases,
    rng,
  });

  await prisma.submission.create({
    data: {
      userId: author.id,
      problemId,
      language: "cpp",
      sourceCode: sampleSource("cpp", "accepted"),
      status: "accepted",
      score,
      runtimeMs,
      memoryKb,
      verdictDetail: detail as unknown as Prisma.InputJsonValue,
      sampleOnly: false,
      createdAt: when,
    },
  });
}

/**
 * Seed engagement surfaces: editorials (+ a report), clarifications, bookmarks,
 * notifications, plagiarism flag/log, submission feedback, and a score
 * override. Idempotent: wipes the rows it owns before recreating.
 */
export async function seedEngagement(
  prisma: PrismaClient,
  refs: { teacher: User; student: User; demoStudents: User[] },
): Promise<void> {
  const now = Date.now();
  const { teacher, student, demoStudents } = refs;
  const rng = new SeededRng(0x5eed_9000);

  // ── Idempotency: drop rows owned by this module ──
  await prisma.editorialReport.deleteMany({});
  await prisma.editorial.deleteMany({});
  await prisma.clarification.deleteMany({});
  await prisma.problemBookmark.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.plagiarismPairFlag.deleteMany({});
  await prisma.plagiarismTriggerLog.deleteMany({});
  await prisma.submissionFeedbackAuditLog.deleteMany({});
  await prisma.submissionFeedback.deleteMany({});
  await prisma.scoreOverrideAuditLog.deleteMany({});
  await prisma.scoreOverride.deleteMany({});

  // ─────────────────────────────────────────────────────────────
  // Editorials — authored by students with an AC on the problem.
  // ─────────────────────────────────────────────────────────────
  const s1 = demoStudents[0] ?? student;
  const s2 = demoStudents[1] ?? student;

  await ensureAcceptedPractice(
    prisma,
    student,
    "problem_warmup-sum",
    rng,
    new Date(now - 20 * DAY),
  );
  await ensureAcceptedPractice(prisma, s1, "problem_warmup-sum", rng, new Date(now - 18 * DAY));
  await ensureAcceptedPractice(
    prisma,
    s2,
    "problem_add-two-numbers",
    rng,
    new Date(now - 15 * DAY),
  );

  const ed1 = await prisma.editorial.create({
    data: {
      userId: student.id,
      problemId: "problem_warmup-sum",
      language: "cpp",
      content:
        '## Warmup Sum 解題思路\n\n直接讀入兩個整數相加即可。注意用 `long long` 避免 32-bit 溢位：\n\n```cpp\n#include <iostream>\nint main(){ long long a,b; std::cin>>a>>b; std::cout<<a+b<<"\\n"; }\n```',
      createdAt: new Date(now - 17 * DAY),
    },
  });

  await prisma.editorial.create({
    data: {
      userId: s1.id,
      problemId: "problem_warmup-sum",
      language: "python",
      content:
        "## Python 版本\n\n用 `map(int, input().split())` 一行讀入即可，Python 整數沒有溢位問題：\n\n```python\na, b = map(int, input().split())\nprint(a + b)\n```",
      createdAt: new Date(now - 16 * DAY),
    },
  });

  await prisma.editorial.create({
    data: {
      userId: s2.id,
      problemId: "problem_add-two-numbers",
      language: "c",
      content:
        '## 兩數相加（C）\n\n用 `scanf` 讀入、`%lld` 印出總和，注意輸出後換行：\n\n```c\n#include <stdio.h>\nint main(){ long long a,b; scanf("%lld %lld",&a,&b); printf("%lld\\n",a+b); }\n```',
      createdAt: new Date(now - 14 * DAY),
    },
  });

  // One open report on the first editorial for the admin moderation demo.
  await prisma.editorialReport.create({
    data: {
      editorialId: ed1.id,
      reportedByUserId: (demoStudents[2] ?? student).id,
      reason: "這篇題解直接貼出完整 AC 程式碼，疑似違反課程的學術誠信規範。",
      status: "open",
      createdAt: new Date(now - 2 * DAY),
    },
  });

  // ─────────────────────────────────────────────────────────────
  // Clarifications — contest + assignment, mix of pending / answered.
  // ─────────────────────────────────────────────────────────────
  await prisma.clarification.create({
    data: {
      contextType: "contest",
      contextId: SPRING_CONTEST_ID,
      problemId: "problem_graph-docking",
      askedByUserId: (demoStudents[0] ?? student).id,
      questionText: "Graph Docking 的碼頭編號是否保證從 1 開始連續編號？",
      state: "answered",
      answerText: "是的，碼頭編號為 1..N 連續，且 d_i 一定落在此範圍內。",
      answeredByUserId: teacher.id,
      answeredAt: new Date("2026-03-15T14:35:00+08:00"),
      createdAt: new Date("2026-03-15T14:20:00+08:00"),
    },
  });

  await prisma.clarification.create({
    data: {
      contextType: "contest",
      contextId: SPRING_CONTEST_ID,
      askedByUserId: (demoStudents[3] ?? student).id,
      questionText: "比賽結束前最後一小時排行榜會封板嗎？",
      state: "answered",
      answerText: "會，最後一小時排行榜封板，但你仍可繼續提交。",
      answeredByUserId: teacher.id,
      answeredAt: new Date("2026-03-15T15:05:00+08:00"),
      createdAt: new Date("2026-03-15T15:00:00+08:00"),
    },
  });

  await prisma.clarification.create({
    data: {
      contextType: "contest",
      contextId: LIVE_CONTEST_ID,
      askedByUserId: (demoStudents[1] ?? student).id,
      questionText: "Weekly Round 12 的 Add Two Numbers 是否允許負數輸入？",
      state: "pending",
      createdAt: new Date(now - 30 * 60 * 1000),
    },
  });

  await prisma.clarification.create({
    data: {
      contextType: "assignment",
      contextId: HW1_ID,
      problemId: "problem_process-log-parser",
      askedByUserId: (demoStudents[4] ?? student).id,
      questionText: "Process Log Parser 的 wait 事件如果 pid 不存在，要輸出什麼？",
      state: "answered",
      answerText: "測資保證 wait 的 pid 一定先前出現過，不需處理不存在的情況。",
      answeredByUserId: teacher.id,
      answeredAt: new Date("2026-03-18T10:00:00.000Z"),
      createdAt: new Date("2026-03-18T09:30:00.000Z"),
    },
  });

  await prisma.clarification.create({
    data: {
      contextType: "assignment",
      contextId: HW1_ID,
      askedByUserId: (demoStudents[5] ?? student).id,
      questionText: "作業逾期繳交會扣多少分？",
      state: "pending",
      createdAt: new Date("2026-03-22T08:00:00.000Z"),
    },
  });

  // ─────────────────────────────────────────────────────────────
  // Bookmarks — main student bookmarks 4 problems.
  // ─────────────────────────────────────────────────────────────
  const bookmarkProblems = [
    "problem_graph-docking",
    "problem_distributed-labyrinth",
    "problem_memory-leak-forensics",
    "problem_noisy-oracle-hunt",
  ];
  for (const [i, problemId] of bookmarkProblems.entries()) {
    await prisma.problemBookmark.create({
      data: {
        userId: student.id,
        problemId,
        createdAt: new Date(now - (i + 1) * 3 * DAY),
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Notifications — mix of types + read/unread for the main student.
  // params shapes mirror packages/domain/src/notification/index.ts.
  // ─────────────────────────────────────────────────────────────
  await prisma.notification.createMany({
    data: [
      {
        userId: student.id,
        type: "assignment_due_soon",
        params: {
          courseId: "course_os-lab-spring-2026",
          assignmentId: "hw-demo-active",
          title: "Demo: Sliding Window 進階",
          dueAt: new Date(now + 7 * DAY).toISOString(),
        },
        linkUrl: "/assignments/hw-demo-active",
        createdAt: new Date(now - 6 * HOUR),
      },
      {
        userId: student.id,
        type: "clarification_answered",
        params: {
          contextType: "contest",
          contextId: SPRING_CONTEST_ID,
          clarificationId: "demo-clar",
          questionPreview: "Graph Docking 的碼頭編號是否保證從 1 開始連續編號？",
        },
        linkUrl: `/contests/${SPRING_CONTEST_ID}/clarifications`,
        createdAt: new Date(now - 2 * DAY),
        readAt: new Date(now - 2 * DAY + 30 * 60 * 1000),
      },
      {
        userId: student.id,
        type: "announcement_published",
        params: {
          announcementId: "demo-announcement",
          titleEn: "系統上線公告",
          titleZhTw: "系統上線公告",
        },
        linkUrl: null,
        createdAt: new Date(now - 1 * DAY),
      },
      {
        userId: student.id,
        type: "contest_starting_soon",
        params: {
          contestId: "contest_demo_upcoming",
          title: "Demo: Spring Cup 2026",
          startsAt: new Date(now + 5 * DAY).toISOString(),
        },
        linkUrl: "/contests/contest_demo_upcoming",
        createdAt: new Date(now - 3 * HOUR),
      },
      {
        userId: student.id,
        type: "course_enrolled",
        params: {
          courseId: "course_os-lab-spring-2026",
          courseName: "Operating Systems Lab",
        },
        linkUrl: "/courses/course_os-lab-spring-2026",
        createdAt: new Date(now - 30 * DAY),
        readAt: new Date(now - 30 * DAY + HOUR),
      },
    ],
  });

  // ─────────────────────────────────────────────────────────────
  // Plagiarism — one pair flag + a trigger log on hw1.
  // pairKey = "${minUserId}|${maxUserId}|${problemId}" (userIds sorted asc).
  // ─────────────────────────────────────────────────────────────
  const pairA = (demoStudents[6] ?? student).id;
  const pairB = (demoStudents[7] ?? teacher).id;
  const [lo, hi] = pairA < pairB ? [pairA, pairB] : [pairB, pairA];
  const pairKey = `${lo}|${hi}|problem_warmup-sum`;

  await prisma.plagiarismPairFlag.create({
    data: {
      contextType: "assessment",
      contextId: HW1_ID,
      pairKey,
      flaggedBy: teacher.id,
      note: "兩份提交的變數命名與註解高度相似，已標記供人工複查。",
      flaggedAt: new Date(now - 5 * DAY),
    },
  });

  await prisma.plagiarismTriggerLog.create({
    data: {
      contextType: "assessment",
      contextId: HW1_ID,
      triggeredByUserId: teacher.id,
      priorPairCount: 0,
      triggeredAt: new Date(now - 5 * DAY - HOUR),
    },
  });

  // ─────────────────────────────────────────────────────────────
  // Submission feedback — teacher comments on student hw1 problems.
  // ─────────────────────────────────────────────────────────────
  await prisma.submissionFeedback.create({
    data: {
      studentUserId: (demoStudents[0] ?? student).id,
      problemId: "problem_warmup-sum",
      courseAssessmentId: HW1_ID,
      comment: "解法正確，但建議加上輸入邊界檢查，整體完成度很好。",
      authorUserId: teacher.id,
      createdAt: new Date(now - 4 * DAY),
    },
  });

  await prisma.submissionFeedback.create({
    data: {
      studentUserId: (demoStudents[1] ?? student).id,
      problemId: "problem_process-log-parser",
      courseAssessmentId: HW1_ID,
      comment: "fork 鏈處理有小瑕疵，請參考題解的巢狀範例再檢查一次。",
      authorUserId: teacher.id,
      createdAt: new Date(now - 4 * DAY + HOUR),
    },
  });

  // ─────────────────────────────────────────────────────────────
  // Score override — teacher bumps a student's hw1 problem score.
  // ─────────────────────────────────────────────────────────────
  const overrideStudent = demoStudents[2] ?? student;
  await prisma.scoreOverride.create({
    data: {
      userId: overrideStudent.id,
      problemId: "problem_warmup-sum",
      contextType: "assignment",
      contextId: HW1_ID,
      overrideScore: 100,
      reason: "評測機暫時故障導致誤判 TLE，人工確認後給予滿分。",
      createdByUserId: teacher.id,
      createdAt: new Date(now - 3 * DAY),
    },
  });

  console.log(
    "  Engagement: 3 editorials (+1 report), 5 clarifications, 4 bookmarks, 5 notifications, plagiarism flag+log, 2 feedback, 1 score override",
  );
}
