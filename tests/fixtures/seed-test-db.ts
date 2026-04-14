// tests/fixtures/seed-test-db.ts
import { testPrisma } from "./factories";

/**
 * All table names to truncate. Order does not matter because
 * TRUNCATE ... CASCADE handles foreign key dependencies.
 */
const TABLES = [
  "Submission",
  "ContestParticipation",
  "ContestProblem",
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
  "Problem",
  "Announcement",
  "Verification",
  "Session",
  "Account",
  "User"
] as const;

export async function truncateAllTables() {
  // Use raw SQL TRUNCATE CASCADE for speed
  const tableNames = TABLES.map((t) => `"${t}"`).join(", ");
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} CASCADE`);
}

export async function disconnectTestDb() {
  await testPrisma.$disconnect();
}
