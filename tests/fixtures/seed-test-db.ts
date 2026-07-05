import { testPrisma } from "./factories";

export const TABLES = [
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
  "Passkey",
  "Session",
  "ApiToken",
  "Account",
  "User",
] as const;

export async function truncateAllTables() {
  const tableNames = TABLES.map((t) => `"${t}"`).join(", ");
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} CASCADE`);
}

export async function disconnectTestDb() {
  await testPrisma.$disconnect();
}
