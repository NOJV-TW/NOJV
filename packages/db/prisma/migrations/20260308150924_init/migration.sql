-- CreateEnum
CREATE TYPE "SupportedLanguage" AS ENUM ('c', 'cpp', 'java', 'javascript', 'python', 'rust', 'typescript');

-- CreateEnum
CREATE TYPE "SubmissionMode" AS ENUM ('practice', 'contest', 'assignment', 'exam');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('queued', 'compiling', 'running', 'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'runtime_error', 'compile_error');

-- CreateEnum
CREATE TYPE "WorkspaceMode" AS ENUM ('practice', 'assignment', 'contest', 'exam');

-- CreateEnum
CREATE TYPE "WorkspaceRunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'blocked', 'timed_out');

-- CreateEnum
CREATE TYPE "ContestVisibility" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "ContestParticipationStatus" AS ENUM ('registered', 'active', 'submitted', 'disqualified');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('admin', 'teacher', 'ta', 'student');

-- CreateEnum
CREATE TYPE "CourseRole" AS ENUM ('teacher', 'ta', 'student');

-- CreateEnum
CREATE TYPE "CourseVisibility" AS ENUM ('invite_only', 'listed', 'archived');

-- CreateEnum
CREATE TYPE "CourseMembershipStatus" AS ENUM ('active', 'invited', 'pending', 'removed');

-- CreateEnum
CREATE TYPE "CourseJoinMethod" AS ENUM ('qr_code', 'join_code', 'manual_invite');

-- CreateEnum
CREATE TYPE "ProblemVisibility" AS ENUM ('public', 'private');

-- CreateEnum
CREATE TYPE "CourseAssessmentType" AS ENUM ('assignment', 'exam');

-- CreateEnum
CREATE TYPE "CourseAssessmentStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "CourseAssessmentScoreboardMode" AS ENUM ('hidden', 'live', 'frozen');

-- CreateEnum
CREATE TYPE "CheatingSignalType" AS ENUM ('focus_loss', 'paste_burst', 'ip_change', 'similarity_match', 'shell_policy_violation', 'concurrent_session');

-- CreateEnum
CREATE TYPE "CheatingCaseStatus" AS ENUM ('open', 'under_review', 'resolved');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh-TW',
    "platformRole" "PlatformRole" NOT NULL DEFAULT 'student',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "defaultTitle" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "visibility" "ProblemVisibility" NOT NULL DEFAULT 'public',
    "authorId" TEXT,
    "timeLimitMs" INTEGER NOT NULL,
    "memoryLimitMb" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemStatementI18n" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemStatementI18n_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestcaseSet" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "isHidden" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestcaseSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "frozenBoard" BOOLEAN NOT NULL DEFAULT true,
    "visibility" "ContestVisibility" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestProblem" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContestProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'zh-TW',
    "visibility" "CourseVisibility" NOT NULL DEFAULT 'invite_only',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseMembership" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CourseRole" NOT NULL,
    "status" "CourseMembershipStatus" NOT NULL DEFAULT 'active',
    "joinedVia" "CourseJoinMethod",
    "addedByUserId" TEXT,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseJoinToken" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "method" "CourseJoinMethod" NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseJoinToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseProblem" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "addedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseAssessment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "type" "CourseAssessmentType" NOT NULL,
    "status" "CourseAssessmentStatus" NOT NULL DEFAULT 'draft',
    "scoreboardMode" "CourseAssessmentScoreboardMode" NOT NULL DEFAULT 'hidden',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseAssessmentProblem" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseAssessmentProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestParticipation" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ContestParticipationStatus" NOT NULL DEFAULT 'registered',
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "score" INTEGER NOT NULL DEFAULT 0,
    "penaltySeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestParticipation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "contestParticipationId" TEXT,
    "courseId" TEXT,
    "courseAssessmentId" TEXT,
    "mode" "SubmissionMode" NOT NULL,
    "language" "SupportedLanguage" NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'queued',
    "score" INTEGER NOT NULL DEFAULT 0,
    "runtimeMs" INTEGER,
    "memoryKb" INTEGER,
    "compilerOutput" TEXT,
    "verdictDetail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "problemId" TEXT,
    "contestParticipationId" TEXT,
    "courseId" TEXT,
    "courseAssessmentId" TEXT,
    "mode" "WorkspaceMode" NOT NULL,
    "imageTag" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceRun" (
    "id" TEXT NOT NULL,
    "workspaceSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contestParticipationId" TEXT,
    "courseId" TEXT,
    "courseAssessmentId" TEXT,
    "command" TEXT NOT NULL,
    "mode" "WorkspaceMode" NOT NULL,
    "status" "WorkspaceRunStatus" NOT NULL DEFAULT 'queued',
    "exitCode" INTEGER,
    "stdout" TEXT,
    "stderr" TEXT,
    "artifactsPath" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheatingCase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contestId" TEXT,
    "courseId" TEXT,
    "courseAssessmentId" TEXT,
    "status" "CheatingCaseStatus" NOT NULL DEFAULT 'open',
    "score" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheatingCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheatingSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contestParticipationId" TEXT,
    "courseId" TEXT,
    "courseAssessmentId" TEXT,
    "submissionId" TEXT,
    "workspaceSessionId" TEXT,
    "workspaceRunId" TEXT,
    "cheatingCaseId" TEXT,
    "type" "CheatingSignalType" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheatingSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_slug_key" ON "Problem"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemStatementI18n_problemId_locale_key" ON "ProblemStatementI18n"("problemId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "Contest_slug_key" ON "Contest"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ContestProblem_contestId_problemId_key" ON "ContestProblem"("contestId", "problemId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestProblem_contestId_ordinal_key" ON "ContestProblem"("contestId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "Course_slug_key" ON "Course"("slug");

-- CreateIndex
CREATE INDEX "CourseMembership_courseId_role_status_idx" ON "CourseMembership"("courseId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CourseMembership_courseId_userId_key" ON "CourseMembership"("courseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseJoinToken_token_key" ON "CourseJoinToken"("token");

-- CreateIndex
CREATE INDEX "CourseJoinToken_courseId_method_idx" ON "CourseJoinToken"("courseId", "method");

-- CreateIndex
CREATE UNIQUE INDEX "CourseProblem_courseId_problemId_key" ON "CourseProblem"("courseId", "problemId");

-- CreateIndex
CREATE INDEX "CourseAssessment_courseId_type_status_idx" ON "CourseAssessment"("courseId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CourseAssessment_courseId_slug_key" ON "CourseAssessment"("courseId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "CourseAssessmentProblem_assessmentId_problemId_key" ON "CourseAssessmentProblem"("assessmentId", "problemId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseAssessmentProblem_assessmentId_ordinal_key" ON "CourseAssessmentProblem"("assessmentId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "ContestParticipation_contestId_userId_key" ON "ContestParticipation"("contestId", "userId");

-- CreateIndex
CREATE INDEX "Submission_problemId_createdAt_idx" ON "Submission"("problemId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_userId_createdAt_idx" ON "Submission"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_courseId_courseAssessmentId_createdAt_idx" ON "Submission"("courseId", "courseAssessmentId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceRun_workspaceSessionId_createdAt_idx" ON "WorkspaceRun"("workspaceSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceRun_courseId_courseAssessmentId_createdAt_idx" ON "WorkspaceRun"("courseId", "courseAssessmentId", "createdAt");

-- CreateIndex
CREATE INDEX "CheatingCase_status_score_idx" ON "CheatingCase"("status", "score");

-- CreateIndex
CREATE INDEX "CheatingSignal_userId_occurredAt_idx" ON "CheatingSignal"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "CheatingSignal_type_confidence_idx" ON "CheatingSignal"("type", "confidence");

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemStatementI18n" ADD CONSTRAINT "ProblemStatementI18n_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestcaseSet" ADD CONSTRAINT "TestcaseSet_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseJoinToken" ADD CONSTRAINT "CourseJoinToken_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseJoinToken" ADD CONSTRAINT "CourseJoinToken_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseProblem" ADD CONSTRAINT "CourseProblem_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseProblem" ADD CONSTRAINT "CourseProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseProblem" ADD CONSTRAINT "CourseProblem_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAssessment" ADD CONSTRAINT "CourseAssessment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAssessment" ADD CONSTRAINT "CourseAssessment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAssessmentProblem" ADD CONSTRAINT "CourseAssessmentProblem_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "CourseAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAssessmentProblem" ADD CONSTRAINT "CourseAssessmentProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipation" ADD CONSTRAINT "ContestParticipation_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipation" ADD CONSTRAINT "ContestParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_contestParticipationId_fkey" FOREIGN KEY ("contestParticipationId") REFERENCES "ContestParticipation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_courseAssessmentId_fkey" FOREIGN KEY ("courseAssessmentId") REFERENCES "CourseAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSession" ADD CONSTRAINT "WorkspaceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSession" ADD CONSTRAINT "WorkspaceSession_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSession" ADD CONSTRAINT "WorkspaceSession_contestParticipationId_fkey" FOREIGN KEY ("contestParticipationId") REFERENCES "ContestParticipation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSession" ADD CONSTRAINT "WorkspaceSession_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSession" ADD CONSTRAINT "WorkspaceSession_courseAssessmentId_fkey" FOREIGN KEY ("courseAssessmentId") REFERENCES "CourseAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceRun" ADD CONSTRAINT "WorkspaceRun_workspaceSessionId_fkey" FOREIGN KEY ("workspaceSessionId") REFERENCES "WorkspaceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceRun" ADD CONSTRAINT "WorkspaceRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceRun" ADD CONSTRAINT "WorkspaceRun_contestParticipationId_fkey" FOREIGN KEY ("contestParticipationId") REFERENCES "ContestParticipation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceRun" ADD CONSTRAINT "WorkspaceRun_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceRun" ADD CONSTRAINT "WorkspaceRun_courseAssessmentId_fkey" FOREIGN KEY ("courseAssessmentId") REFERENCES "CourseAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheatingCase" ADD CONSTRAINT "CheatingCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheatingCase" ADD CONSTRAINT "CheatingCase_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheatingCase" ADD CONSTRAINT "CheatingCase_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheatingCase" ADD CONSTRAINT "CheatingCase_courseAssessmentId_fkey" FOREIGN KEY ("courseAssessmentId") REFERENCES "CourseAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheatingSignal" ADD CONSTRAINT "CheatingSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheatingSignal" ADD CONSTRAINT "CheatingSignal_contestParticipationId_fkey" FOREIGN KEY ("contestParticipationId") REFERENCES "ContestParticipation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheatingSignal" ADD CONSTRAINT "CheatingSignal_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheatingSignal" ADD CONSTRAINT "CheatingSignal_courseAssessmentId_fkey" FOREIGN KEY ("courseAssessmentId") REFERENCES "CourseAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheatingSignal" ADD CONSTRAINT "CheatingSignal_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheatingSignal" ADD CONSTRAINT "CheatingSignal_workspaceSessionId_fkey" FOREIGN KEY ("workspaceSessionId") REFERENCES "WorkspaceSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheatingSignal" ADD CONSTRAINT "CheatingSignal_workspaceRunId_fkey" FOREIGN KEY ("workspaceRunId") REFERENCES "WorkspaceRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheatingSignal" ADD CONSTRAINT "CheatingSignal_cheatingCaseId_fkey" FOREIGN KEY ("cheatingCaseId") REFERENCES "CheatingCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
