// tests/fixtures/seed-test-db.ts
import { testPrisma } from "./factories";

// Order does not matter — TRUNCATE ... CASCADE handles FK dependencies.
const TABLES = [
  "Clarification",
  "SubmissionRejudgeLog",
  "Submission",
  "ContestParticipation",
  "ContestProblem",
  "ExamSessionEvent",
  "ActiveExamSession",
  "ExamParticipation",
  "ExamProblem",
  "CourseAssessmentProblem",
  "CourseAssessment",
  "CourseMembership",
  "Course",
  "Contest",
  "Exam",
  "IpViolationLog",
  "Testcase",
  "TestcaseSet",
  "ProblemStatementI18n",
  "ProblemWorkspaceFile",
  "ProblemBookmark",
  "Problem",
  "Announcement",
  "PlatformSetting",
  "Verification",
  "Session",
  "Account",
  "User",
] as const;

export async function truncateAllTables() {
  // Use raw SQL TRUNCATE CASCADE for speed
  const tableNames = TABLES.map((t) => `"${t}"`).join(", ");
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} CASCADE`);
  // Reset sequences so test IDs start from 1 in each test
  await testPrisma.$executeRawUnsafe(`ALTER SEQUENCE "Problem_displayId_seq" RESTART WITH 1`);
}

export async function disconnectTestDb() {
  await testPrisma.$disconnect();
}
