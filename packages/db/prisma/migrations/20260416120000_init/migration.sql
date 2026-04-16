-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('admin', 'teacher', 'student');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled', 'pending_first_login');

-- CreateEnum
CREATE TYPE "ContestVisibility" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "ContestScoringMode" AS ENUM ('problem_count', 'point_sum');

-- CreateEnum
CREATE TYPE "ContestParticipationStatus" AS ENUM ('registered', 'active', 'submitted', 'disqualified');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "ExamScoringMode" AS ENUM ('problem_count', 'point_sum');

-- CreateEnum
CREATE TYPE "ExamParticipationStatus" AS ENUM ('registered', 'active', 'submitted', 'disqualified');

-- CreateEnum
CREATE TYPE "ScoreboardMode" AS ENUM ('hidden', 'live', 'frozen');

-- CreateEnum
CREATE TYPE "IpViolationMode" AS ENUM ('block', 'notify');

-- CreateEnum
CREATE TYPE "IpViolationType" AS ENUM ('whitelist', 'binding');

-- CreateEnum
CREATE TYPE "ExamSessionReleaseReason" AS ENUM ('submitted', 'time_up', 'released_by_instructor');

-- CreateEnum
CREATE TYPE "ExamSessionEventType" AS ENUM ('enter', 'leave', 'visibility_lost', 'release', 'auto_close', 'heartbeat');

-- CreateEnum
CREATE TYPE "CourseRole" AS ENUM ('teacher', 'ta', 'student');

-- CreateEnum
CREATE TYPE "CourseMembershipStatus" AS ENUM ('active', 'removed');

-- CreateEnum
CREATE TYPE "CourseAssessmentStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('all', 'students', 'teachers');

-- CreateEnum
CREATE TYPE "PlagiarismReportStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "ProblemVisibility" AS ENUM ('public', 'private');

-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "ProblemType" AS ENUM ('full_source', 'multi_file', 'special_env');

-- CreateEnum
CREATE TYPE "ProblemImageSource" AS ENUM ('registry', 'tarball');

-- CreateEnum
CREATE TYPE "ProblemDifficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "WorkspaceFileVisibility" AS ENUM ('editable', 'readonly', 'hidden');

-- CreateEnum
CREATE TYPE "SubtaskScoringStrategy" AS ENUM ('ALL_OR_NOTHING', 'PROPORTIONAL', 'MINIMUM');

-- CreateEnum
CREATE TYPE "SupportedLanguage" AS ENUM ('c', 'cpp', 'go', 'java', 'javascript', 'python', 'rust', 'typescript');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('queued', 'compiling', 'running', 'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'runtime_error', 'compile_error');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "displayUsername" TEXT,
    "name" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "platformRole" "PlatformRole" NOT NULL DEFAULT 'student',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolVerificationToken" (
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolVerificationToken_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "visibility" "ContestVisibility" NOT NULL DEFAULT 'draft',
    "scoringMode" "ContestScoringMode" NOT NULL DEFAULT 'problem_count',
    "scoreboardMode" "ScoreboardMode" NOT NULL DEFAULT 'live',
    "frozenBoard" BOOLEAN NOT NULL DEFAULT true,
    "frozenAt" TIMESTAMP(3),
    "submitCooldownSec" INTEGER NOT NULL DEFAULT 0,
    "allowedLanguages" "SupportedLanguage"[] DEFAULT ARRAY[]::"SupportedLanguage"[],
    "inviteCode" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "plagiarismStatus" "PlagiarismReportStatus",
    "plagiarismResults" JSONB,
    "plagiarismMossReportUrl" TEXT,
    "plagiarismTriggeredAt" TIMESTAMP(3),
    "plagiarismCompletedAt" TIMESTAMP(3),
    "plagiarismTriggeredById" TEXT,

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
CREATE TABLE "ContestParticipation" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ContestParticipationStatus" NOT NULL DEFAULT 'registered',
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "score" INTEGER NOT NULL DEFAULT 0,
    "penaltySeconds" INTEGER NOT NULL DEFAULT 0,
    "subtaskScores" JSONB,
    "boundIp" TEXT,
    "boundIpClearedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestParticipation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "ExamStatus" NOT NULL DEFAULT 'draft',
    "scoringMode" "ExamScoringMode" NOT NULL DEFAULT 'point_sum',
    "scoreboardMode" "ScoreboardMode" NOT NULL DEFAULT 'hidden',
    "frozenBoard" BOOLEAN NOT NULL DEFAULT false,
    "frozenAt" TIMESTAMP(3),
    "submitCooldownSec" INTEGER NOT NULL DEFAULT 0,
    "allowedLanguages" "SupportedLanguage"[] DEFAULT ARRAY[]::"SupportedLanguage"[],
    "pageLockEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ipWhitelistEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ipBindingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ipWhitelist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ipViolationMode" "IpViolationMode" NOT NULL DEFAULT 'block',
    "plagiarismStatus" "PlagiarismReportStatus",
    "plagiarismResults" JSONB,
    "plagiarismMossReportUrl" TEXT,
    "plagiarismTriggeredAt" TIMESTAMP(3),
    "plagiarismCompletedAt" TIMESTAMP(3),
    "plagiarismTriggeredById" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamProblem" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamParticipation" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ExamParticipationStatus" NOT NULL DEFAULT 'registered',
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "disqualifiedAt" TIMESTAMP(3),
    "disqualifiedReason" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "penaltySeconds" INTEGER NOT NULL DEFAULT 0,
    "subtaskScores" JSONB,
    "ipPin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamParticipation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpViolationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "expectedIp" TEXT,
    "actualIp" TEXT NOT NULL,
    "violationType" "IpViolationType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IpViolationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveExamSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "releaseReason" "ExamSessionReleaseReason",
    "ipPin" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveExamSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSessionEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventType" "ExamSessionEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "ExamSessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
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
    "addedByUserId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseAssessment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "CourseAssessmentStatus" NOT NULL DEFAULT 'draft',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3) NOT NULL,
    "maxAttemptsPerDay" INTEGER,
    "allowedLanguages" "SupportedLanguage"[] DEFAULT ARRAY[]::"SupportedLanguage"[],
    "adjustmentRules" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "plagiarismStatus" "PlagiarismReportStatus",
    "plagiarismResults" JSONB,
    "plagiarismMossReportUrl" TEXT,
    "plagiarismTriggeredAt" TIMESTAMP(3),
    "plagiarismCompletedAt" TIMESTAMP(3),
    "plagiarismTriggeredById" TEXT,

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
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'draft',
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'all',
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "courseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementTranslation" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "AnnouncementTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authorId" TEXT,
    "visibility" "ProblemVisibility" NOT NULL DEFAULT 'public',
    "status" "ProblemStatus" NOT NULL DEFAULT 'draft',
    "difficulty" "ProblemDifficulty" NOT NULL DEFAULT 'medium',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "type" "ProblemType" NOT NULL DEFAULT 'full_source',
    "timeLimitMs" INTEGER NOT NULL,
    "memoryLimitMb" INTEGER NOT NULL,
    "judgeConfig" JSONB,
    "samples" JSONB,
    "advancedImageRef" TEXT,
    "advancedImageSource" "ProblemImageSource",
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
    "inputFormat" TEXT NOT NULL DEFAULT '',
    "outputFormat" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemStatementI18n_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestcaseSet" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "scoringStrategy" "SubtaskScoringStrategy" NOT NULL DEFAULT 'ALL_OR_NOTHING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestcaseSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Testcase" (
    "id" TEXT NOT NULL,
    "testcaseSetId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "inputKey" TEXT NOT NULL,
    "outputKey" TEXT,
    "inputFileKeys" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Testcase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemWorkspaceFile" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "language" "SupportedLanguage" NOT NULL,
    "path" TEXT NOT NULL,
    "contentKey" TEXT NOT NULL,
    "visibility" "WorkspaceFileVisibility" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProblemWorkspaceFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "contestParticipationId" TEXT,
    "examId" TEXT,
    "contestId" TEXT,
    "courseId" TEXT,
    "courseAssessmentId" TEXT,
    "sampleOnly" BOOLEAN NOT NULL DEFAULT false,
    "language" "SupportedLanguage" NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'queued',
    "score" INTEGER NOT NULL DEFAULT 0,
    "runtimeMs" INTEGER,
    "memoryKb" INTEGER,
    "verdictDetail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Editorial" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "language" "SupportedLanguage" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Editorial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDailyActivity" (
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "acCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UserDailyActivity_pkey" PRIMARY KEY ("userId","date")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "SchoolVerificationToken_userId_idx" ON "SchoolVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "SchoolVerificationToken_expiresAt_idx" ON "SchoolVerificationToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contest_slug_key" ON "Contest"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Contest_inviteCode_key" ON "Contest"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "ContestProblem_contestId_problemId_key" ON "ContestProblem"("contestId", "problemId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestProblem_contestId_ordinal_key" ON "ContestProblem"("contestId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "ContestParticipation_contestId_userId_key" ON "ContestParticipation"("contestId", "userId");

-- CreateIndex
CREATE INDEX "Exam_courseId_idx" ON "Exam"("courseId");

-- CreateIndex
CREATE INDEX "Exam_courseId_status_idx" ON "Exam"("courseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExamProblem_examId_problemId_key" ON "ExamProblem"("examId", "problemId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamProblem_examId_ordinal_key" ON "ExamProblem"("examId", "ordinal");

-- CreateIndex
CREATE INDEX "ExamParticipation_userId_status_idx" ON "ExamParticipation"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExamParticipation_examId_userId_key" ON "ExamParticipation"("examId", "userId");

-- CreateIndex
CREATE INDEX "IpViolationLog_examId_createdAt_idx" ON "IpViolationLog"("examId", "createdAt");

-- CreateIndex
CREATE INDEX "IpViolationLog_userId_createdAt_idx" ON "IpViolationLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ActiveExamSession_examId_endedAt_idx" ON "ActiveExamSession"("examId", "endedAt");

-- CreateIndex
CREATE INDEX "ActiveExamSession_userId_endedAt_idx" ON "ActiveExamSession"("userId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveExamSession_userId_examId_key" ON "ActiveExamSession"("userId", "examId");

-- CreateIndex
CREATE INDEX "ExamSessionEvent_sessionId_occurredAt_idx" ON "ExamSessionEvent"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "CourseMembership_courseId_role_status_idx" ON "CourseMembership"("courseId", "role", "status");

-- CreateIndex
CREATE INDEX "CourseMembership_userId_status_idx" ON "CourseMembership"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CourseMembership_courseId_userId_key" ON "CourseMembership"("courseId", "userId");

-- CreateIndex
CREATE INDEX "CourseAssessment_courseId_status_idx" ON "CourseAssessment"("courseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CourseAssessment_courseId_slug_key" ON "CourseAssessment"("courseId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "CourseAssessmentProblem_assessmentId_problemId_key" ON "CourseAssessmentProblem"("assessmentId", "problemId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseAssessmentProblem_assessmentId_ordinal_key" ON "CourseAssessmentProblem"("assessmentId", "ordinal");

-- CreateIndex
CREATE INDEX "Announcement_status_pinned_publishedAt_idx" ON "Announcement"("status", "pinned", "publishedAt");

-- CreateIndex
CREATE INDEX "Announcement_courseId_status_pinned_publishedAt_idx" ON "Announcement"("courseId", "status", "pinned", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementTranslation_announcementId_locale_key" ON "AnnouncementTranslation"("announcementId", "locale");

-- CreateIndex
CREATE INDEX "Problem_status_visibility_createdAt_idx" ON "Problem"("status", "visibility", "createdAt");

-- CreateIndex
CREATE INDEX "Problem_authorId_idx" ON "Problem"("authorId");

-- CreateIndex
CREATE INDEX "Problem_difficulty_idx" ON "Problem"("difficulty");

-- CreateIndex
CREATE INDEX "Problem_tags_idx" ON "Problem" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemStatementI18n_problemId_locale_key" ON "ProblemStatementI18n"("problemId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "TestcaseSet_problemId_name_key" ON "TestcaseSet"("problemId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TestcaseSet_problemId_ordinal_key" ON "TestcaseSet"("problemId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "Testcase_testcaseSetId_ordinal_key" ON "Testcase"("testcaseSetId", "ordinal");

-- CreateIndex
CREATE INDEX "ProblemWorkspaceFile_problemId_language_idx" ON "ProblemWorkspaceFile"("problemId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemWorkspaceFile_problemId_language_path_key" ON "ProblemWorkspaceFile"("problemId", "language", "path");

-- CreateIndex
CREATE INDEX "Submission_problemId_createdAt_idx" ON "Submission"("problemId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_userId_createdAt_idx" ON "Submission"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_courseId_courseAssessmentId_createdAt_idx" ON "Submission"("courseId", "courseAssessmentId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_contestParticipationId_problemId_createdAt_idx" ON "Submission"("contestParticipationId", "problemId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_contestId_problemId_createdAt_idx" ON "Submission"("contestId", "problemId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_examId_problemId_createdAt_idx" ON "Submission"("examId", "problemId", "createdAt");

-- CreateIndex
CREATE INDEX "Editorial_problemId_createdAt_idx" ON "Editorial"("problemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Editorial_userId_problemId_language_key" ON "Editorial"("userId", "problemId", "language");

-- CreateIndex
CREATE INDEX "UserDailyActivity_userId_date_idx" ON "UserDailyActivity"("userId", "date" DESC);

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolVerificationToken" ADD CONSTRAINT "SchoolVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_plagiarismTriggeredById_fkey" FOREIGN KEY ("plagiarismTriggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipation" ADD CONSTRAINT "ContestParticipation_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestParticipation" ADD CONSTRAINT "ContestParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_plagiarismTriggeredById_fkey" FOREIGN KEY ("plagiarismTriggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamProblem" ADD CONSTRAINT "ExamProblem_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamProblem" ADD CONSTRAINT "ExamProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamParticipation" ADD CONSTRAINT "ExamParticipation_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamParticipation" ADD CONSTRAINT "ExamParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpViolationLog" ADD CONSTRAINT "IpViolationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpViolationLog" ADD CONSTRAINT "IpViolationLog_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveExamSession" ADD CONSTRAINT "ActiveExamSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveExamSession" ADD CONSTRAINT "ActiveExamSession_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamSessionEvent" ADD CONSTRAINT "ExamSessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ActiveExamSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAssessment" ADD CONSTRAINT "CourseAssessment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAssessment" ADD CONSTRAINT "CourseAssessment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAssessment" ADD CONSTRAINT "CourseAssessment_plagiarismTriggeredById_fkey" FOREIGN KEY ("plagiarismTriggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAssessmentProblem" ADD CONSTRAINT "CourseAssessmentProblem_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "CourseAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseAssessmentProblem" ADD CONSTRAINT "CourseAssessmentProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementTranslation" ADD CONSTRAINT "AnnouncementTranslation_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemStatementI18n" ADD CONSTRAINT "ProblemStatementI18n_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestcaseSet" ADD CONSTRAINT "TestcaseSet_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Testcase" ADD CONSTRAINT "Testcase_testcaseSetId_fkey" FOREIGN KEY ("testcaseSetId") REFERENCES "TestcaseSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemWorkspaceFile" ADD CONSTRAINT "ProblemWorkspaceFile_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_contestParticipationId_fkey" FOREIGN KEY ("contestParticipationId") REFERENCES "ContestParticipation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_courseAssessmentId_fkey" FOREIGN KEY ("courseAssessmentId") REFERENCES "CourseAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Editorial" ADD CONSTRAINT "Editorial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Editorial" ADD CONSTRAINT "Editorial_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDailyActivity" ADD CONSTRAINT "UserDailyActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

