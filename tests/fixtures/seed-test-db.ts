import { testPrisma } from "./factories";
import {
  assertLiveTestDatabase,
  resolveConfiguredDestructiveTestDatabase,
} from "../setup/destructive-test-database";

export const TABLES = [
  "DurableWork",
  "AdminAuditLog",
  "Clarification",
  "SubmissionFeedbackAuditLog",
  "SubmissionFeedback",
  "SubmissionRejudgeLog",
  "Submission",
  "Participation",
  "ScoreOverrideAuditLog",
  "ScoreOverride",
  "ContestProblem",
  "ExamSessionEvent",
  "ActiveExamSession",
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
  "ContentReport",
  "PostVote",
  "PostComment",
  "ProblemPost",
  "Testcase",
  "TestcaseSet",
  "ProblemStatement",
  "ProblemWorkspaceFile",
  "ProblemBookmark",
  "Problem",
  "AnnouncementTranslation",
  "Announcement",
  "Notification",
  "NotificationPreference",
  "PlatformSetting",
  "SchoolVerificationToken",
  "Verification",
  "TwoFactor",
  "Passkey",
  "Session",
  "ApiToken",
  "RegistryCredential",
  "Account",
  "User",
] as const;

type TestTable = (typeof TABLES)[number];

export async function truncateTestTables(tables: readonly TestTable[]) {
  if (tables.length === 0) throw new Error("At least one test table is required for TRUNCATE.");
  const { expectedDatabase } = resolveConfiguredDestructiveTestDatabase();
  const tableNames = tables.map((table) => `"${table}"`).join(", ");
  await testPrisma.$transaction(async (tx) => {
    await assertLiveTestDatabase(tx, expectedDatabase);
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} CASCADE`);
  });
}

export async function truncateAllTables() {
  await truncateTestTables(TABLES);
}

export async function disconnectTestDb() {
  await testPrisma.$disconnect();
}
