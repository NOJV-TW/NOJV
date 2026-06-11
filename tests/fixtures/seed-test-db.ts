// tests/fixtures/seed-test-db.ts
import { testPrisma } from "./factories";

// Order does not matter — TRUNCATE ... CASCADE handles FK dependencies.
// Completeness is enforced by tests/unit/db/seed-tables-complete.test.ts.
export const TABLES = [
  "Clarification",
  "SubmissionFeedbackAuditLog",
  "SubmissionFeedback",
  "SubmissionRejudgeLog",
  "Submission",
  "ScoreOverrideAuditLog",
  "ScoreOverride",
  "ContestParticipation",
  "ContestProblem",
  "VirtualContest",
  "ExamSessionEvent",
  "ActiveExamSession",
  "ExamParticipation",
  "ExamProblem",
  "AssessmentAuditLog",
  "AssessmentProblem",
  "Assessment",
  "CourseMembership",
  "Course",
  "Contest",
  "Exam",
  "IpViolationLog",
  "PlagiarismPairFlag",
  "PlagiarismTriggerLog",
  "EditorialVote",
  "EditorialReport",
  "Editorial",
  "Testcase",
  "TestcaseSet",
  "ProblemStatementI18n",
  "ProblemWorkspaceFile",
  "ProblemBookmark",
  "Problem",
  "AnnouncementTranslation",
  "Announcement",
  "Notification",
  "PlatformSetting",
  "SchoolVerificationToken",
  "Verification",
  "TwoFactor",
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
