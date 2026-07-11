import { testPrisma } from "./factories";

export const TABLES = [
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
