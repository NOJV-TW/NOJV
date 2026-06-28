-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('admin', 'teacher', 'student');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled', 'pending_first_login');

-- CreateEnum
CREATE TYPE "ApiTokenStatus" AS ENUM ('active', 'revoked');

-- CreateEnum
CREATE TYPE "ClarificationContextType" AS ENUM ('contest', 'exam', 'assignment');

-- CreateEnum
CREATE TYPE "ClarificationState" AS ENUM ('pending', 'answered', 'dismissed');

-- CreateEnum
CREATE TYPE "ContestVisibility" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "ContestScoringMode" AS ENUM ('problem_count', 'weighted_count', 'point_sum');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "ExamScoringMode" AS ENUM ('problem_count', 'point_sum');

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
CREATE TYPE "ParticipationType" AS ENUM ('contest', 'exam', 'virtual');

-- CreateEnum
CREATE TYPE "ParticipationStatus" AS ENUM ('registered', 'active', 'submitted', 'disqualified');

-- CreateEnum
CREATE TYPE "CourseRole" AS ENUM ('teacher', 'ta', 'student');

-- CreateEnum
CREATE TYPE "CourseMembershipStatus" AS ENUM ('active', 'removed');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "AssessmentAuditAction" AS ENUM ('publish', 'revert_to_draft', 'delete_draft');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('assignment_due_soon', 'exam_starting_soon', 'contest_starting_soon', 'course_enrolled', 'announcement_published', 'role_changed', 'clarification_answered');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('all', 'students', 'teachers');

-- CreateEnum
CREATE TYPE "PlagiarismReportStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "PlagiarismContext" AS ENUM ('assessment', 'exam', 'contest');

-- CreateEnum
CREATE TYPE "ProblemVisibility" AS ENUM ('public', 'private');

-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "ProblemType" AS ENUM ('full_source', 'multi_file', 'special_env');

-- CreateEnum
CREATE TYPE "ProblemDifficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "WorkspaceFileVisibility" AS ENUM ('editable', 'readonly', 'hidden');

-- CreateEnum
CREATE TYPE "SupportedLanguage" AS ENUM ('c', 'cpp', 'go', 'java', 'javascript', 'python', 'rust', 'typescript');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('pending_upload', 'queued', 'compiling', 'running', 'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'runtime_error', 'compile_error', 'system_error');

-- CreateEnum
CREATE TYPE "OverrideContextType" AS ENUM ('assignment', 'exam', 'contest');

-- CreateEnum
CREATE TYPE "ScoreOverrideAction" AS ENUM ('create', 'update', 'delete');

-- CreateEnum
CREATE TYPE "SubmissionFeedbackAction" AS ENUM ('create', 'update', 'delete');

-- CreateEnum
CREATE TYPE "EditorialReportStatus" AS ENUM ('open', 'resolved', 'dismissed');

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
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwoFactor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TwoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "publicKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialID" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    "aaguid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ApiTokenStatus" NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clarification" (
    "id" TEXT NOT NULL,
    "contextType" "ClarificationContextType" NOT NULL,
    "contextId" TEXT NOT NULL,
    "problemId" TEXT,
    "askedByUserId" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "answerText" TEXT,
    "state" "ClarificationState" NOT NULL DEFAULT 'pending',
    "answeredByUserId" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Clarification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL,
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
    "penaltyMinutesPerWrong" INTEGER NOT NULL DEFAULT 20,
    "allowedLanguages" "SupportedLanguage"[] DEFAULT ARRAY[]::"SupportedLanguage"[],
    "inviteCode" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "plagiarismStatus" "PlagiarismReportStatus",
    "plagiarismResults" JSONB,
    "plagiarismReportUrl" TEXT,
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
    "submitCooldownSec" INTEGER NOT NULL DEFAULT 0,
    "allowedLanguages" "SupportedLanguage"[] DEFAULT ARRAY[]::"SupportedLanguage"[],
    "pageLockEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ipWhitelistEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ipBindingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ipWhitelist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ipViolationMode" "IpViolationMode" NOT NULL DEFAULT 'block',
    "plagiarismStatus" "PlagiarismReportStatus",
    "plagiarismResults" JSONB,
    "plagiarismReportUrl" TEXT,
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
CREATE TABLE "Participation" (
    "id" TEXT NOT NULL,
    "type" "ParticipationType" NOT NULL,
    "userId" TEXT NOT NULL,
    "contestId" TEXT,
    "examId" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "penaltySeconds" INTEGER NOT NULL DEFAULT 0,
    "subtaskScores" JSONB,
    "status" "ParticipationStatus" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "ipPin" TEXT,
    "ipGateExemptUntil" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Participation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "academicYear" INTEGER,
    "semester" INTEGER,
    "archived" BOOLEAN NOT NULL DEFAULT false,
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
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'draft',
    "opensAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3) NOT NULL,
    "maxAttemptsPerDay" INTEGER,
    "attemptResetMinuteOfDay" INTEGER,
    "allowedLanguages" "SupportedLanguage"[] DEFAULT ARRAY[]::"SupportedLanguage"[],
    "adjustmentRules" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "plagiarismStatus" "PlagiarismReportStatus",
    "plagiarismResults" JSONB,
    "plagiarismReportUrl" TEXT,
    "plagiarismTriggeredAt" TIMESTAMP(3),
    "plagiarismCompletedAt" TIMESTAMP(3),
    "plagiarismTriggeredById" TEXT,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentProblem" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentAuditLog" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "AssessmentAuditAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "params" JSONB NOT NULL,
    "linkUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PlagiarismPairFlag" (
    "id" TEXT NOT NULL,
    "contextType" "PlagiarismContext" NOT NULL,
    "contextId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "flaggedBy" TEXT NOT NULL,
    "flaggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "PlagiarismPairFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlagiarismTriggerLog" (
    "id" TEXT NOT NULL,
    "contextType" "PlagiarismContext" NOT NULL,
    "contextId" TEXT NOT NULL,
    "triggeredByUserId" TEXT,
    "priorPairCount" INTEGER NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlagiarismTriggerLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "displayId" SERIAL NOT NULL,
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
    "advancedConfig" JSONB,
    "advancedRequiredPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemBookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemBookmark_pkey" PRIMARY KEY ("id")
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
    "examId" TEXT,
    "contestId" TEXT,
    "participationId" TEXT,
    "courseId" TEXT,
    "assessmentId" TEXT,
    "sampleOnly" BOOLEAN NOT NULL DEFAULT false,
    "language" "SupportedLanguage" NOT NULL,
    "sourceStoragePrefix" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'queued',
    "score" INTEGER NOT NULL DEFAULT 0,
    "runtimeMs" INTEGER,
    "memoryKb" INTEGER,
    "verdictSummary" JSONB,
    "verdictDetailStorageKey" TEXT,
    "advancedConfigSnapshot" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionRejudgeLog" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "rejudgedByUserId" TEXT,
    "rejudgeRunId" TEXT,
    "oldVerdict" TEXT NOT NULL,
    "oldScore" INTEGER NOT NULL,
    "oldResultJson" JSONB,
    "newVerdict" TEXT,
    "newScore" INTEGER,
    "newResultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionRejudgeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "contextType" "OverrideContextType" NOT NULL,
    "contextId" TEXT NOT NULL,
    "overrideScore" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoreOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreOverrideAuditLog" (
    "id" TEXT NOT NULL,
    "overrideId" TEXT,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "contextType" "OverrideContextType" NOT NULL,
    "contextId" TEXT NOT NULL,
    "action" "ScoreOverrideAction" NOT NULL,
    "oldScore" INTEGER,
    "newScore" INTEGER,
    "oldReason" TEXT,
    "newReason" TEXT,
    "changedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreOverrideAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionFeedback" (
    "id" TEXT NOT NULL,
    "studentUserId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "assessmentId" TEXT,
    "examId" TEXT,
    "comment" TEXT NOT NULL,
    "authorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubmissionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionFeedbackAuditLog" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT,
    "studentUserId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "assessmentId" TEXT,
    "examId" TEXT,
    "action" "SubmissionFeedbackAction" NOT NULL,
    "oldComment" TEXT,
    "newComment" TEXT,
    "changedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionFeedbackAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Editorial" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "language" "SupportedLanguage" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Editorial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialVote" (
    "id" TEXT NOT NULL,
    "editorialId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorialVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialReport" (
    "id" TEXT NOT NULL,
    "editorialId" TEXT NOT NULL,
    "reportedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "EditorialReportStatus" NOT NULL DEFAULT 'open',
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditorialReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "TwoFactor_secret_idx" ON "TwoFactor"("secret");

-- CreateIndex
CREATE INDEX "TwoFactor_userId_idx" ON "TwoFactor"("userId");

-- CreateIndex
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");

-- CreateIndex
CREATE INDEX "Passkey_credentialID_idx" ON "Passkey"("credentialID");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE INDEX "SchoolVerificationToken_userId_idx" ON "SchoolVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "SchoolVerificationToken_expiresAt_idx" ON "SchoolVerificationToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_prefix_key" ON "ApiToken"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- CreateIndex
CREATE INDEX "ApiToken_status_idx" ON "ApiToken"("status");

-- CreateIndex
CREATE INDEX "ApiToken_expiresAt_idx" ON "ApiToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Clarification_contextType_contextId_createdAt_idx" ON "Clarification"("contextType", "contextId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Clarification_contextType_contextId_state_idx" ON "Clarification"("contextType", "contextId", "state");

-- CreateIndex
CREATE INDEX "Clarification_askedByUserId_createdAt_idx" ON "Clarification"("askedByUserId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Contest_inviteCode_key" ON "Contest"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "ContestProblem_contestId_problemId_key" ON "ContestProblem"("contestId", "problemId");

-- CreateIndex
CREATE UNIQUE INDEX "ContestProblem_contestId_ordinal_key" ON "ContestProblem"("contestId", "ordinal");

-- CreateIndex
CREATE INDEX "Exam_courseId_status_idx" ON "Exam"("courseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExamProblem_examId_problemId_key" ON "ExamProblem"("examId", "problemId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamProblem_examId_ordinal_key" ON "ExamProblem"("examId", "ordinal");

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
CREATE INDEX "Participation_userId_idx" ON "Participation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Participation_type_contestId_userId_key" ON "Participation"("type", "contestId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Participation_type_examId_userId_key" ON "Participation"("type", "examId", "userId");

-- CreateIndex
CREATE INDEX "CourseMembership_courseId_role_status_idx" ON "CourseMembership"("courseId", "role", "status");

-- CreateIndex
CREATE INDEX "CourseMembership_userId_status_idx" ON "CourseMembership"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CourseMembership_courseId_userId_key" ON "CourseMembership"("courseId", "userId");

-- CreateIndex
CREATE INDEX "Assessment_courseId_status_idx" ON "Assessment"("courseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentProblem_assessmentId_problemId_key" ON "AssessmentProblem"("assessmentId", "problemId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentProblem_assessmentId_ordinal_key" ON "AssessmentProblem"("assessmentId", "ordinal");

-- CreateIndex
CREATE INDEX "AssessmentAuditLog_assessmentId_createdAt_idx" ON "AssessmentAuditLog"("assessmentId", "createdAt");

-- CreateIndex
CREATE INDEX "AssessmentAuditLog_courseId_createdAt_idx" ON "AssessmentAuditLog"("courseId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Announcement_status_pinned_publishedAt_idx" ON "Announcement"("status", "pinned", "publishedAt");

-- CreateIndex
CREATE INDEX "Announcement_courseId_status_pinned_publishedAt_idx" ON "Announcement"("courseId", "status", "pinned", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementTranslation_announcementId_locale_key" ON "AnnouncementTranslation"("announcementId", "locale");

-- CreateIndex
CREATE INDEX "PlagiarismPairFlag_contextType_contextId_idx" ON "PlagiarismPairFlag"("contextType", "contextId");

-- CreateIndex
CREATE UNIQUE INDEX "PlagiarismPairFlag_contextType_contextId_pairKey_key" ON "PlagiarismPairFlag"("contextType", "contextId", "pairKey");

-- CreateIndex
CREATE INDEX "PlagiarismTriggerLog_contextType_contextId_triggeredAt_idx" ON "PlagiarismTriggerLog"("contextType", "contextId", "triggeredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Problem_displayId_key" ON "Problem"("displayId");

-- CreateIndex
CREATE INDEX "Problem_status_visibility_createdAt_idx" ON "Problem"("status", "visibility", "createdAt");

-- CreateIndex
CREATE INDEX "Problem_authorId_idx" ON "Problem"("authorId");

-- CreateIndex
CREATE INDEX "Problem_difficulty_idx" ON "Problem"("difficulty");

-- CreateIndex
CREATE INDEX "Problem_tags_idx" ON "Problem" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "ProblemBookmark_userId_createdAt_idx" ON "ProblemBookmark"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProblemBookmark_userId_problemId_key" ON "ProblemBookmark"("userId", "problemId");

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
CREATE INDEX "Submission_courseId_assessmentId_createdAt_idx" ON "Submission"("courseId", "assessmentId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_contestId_problemId_createdAt_idx" ON "Submission"("contestId", "problemId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_examId_problemId_createdAt_idx" ON "Submission"("examId", "problemId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_participationId_problemId_createdAt_idx" ON "Submission"("participationId", "problemId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_assessmentId_problemId_createdAt_idx" ON "Submission"("assessmentId", "problemId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_status_updatedAt_idx" ON "Submission"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Submission_problemId_sampleOnly_userId_status_idx" ON "Submission"("problemId", "sampleOnly", "userId", "status");

-- CreateIndex
CREATE INDEX "Submission_createdAt_idx" ON "Submission"("createdAt");

-- CreateIndex
CREATE INDEX "SubmissionRejudgeLog_submissionId_createdAt_idx" ON "SubmissionRejudgeLog"("submissionId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SubmissionRejudgeLog_rejudgedByUserId_createdAt_idx" ON "SubmissionRejudgeLog"("rejudgedByUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SubmissionRejudgeLog_createdAt_idx" ON "SubmissionRejudgeLog"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionRejudgeLog_submissionId_rejudgeRunId_key" ON "SubmissionRejudgeLog"("submissionId", "rejudgeRunId");

-- CreateIndex
CREATE INDEX "ScoreOverride_contextType_contextId_idx" ON "ScoreOverride"("contextType", "contextId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreOverride_userId_problemId_contextType_contextId_key" ON "ScoreOverride"("userId", "problemId", "contextType", "contextId");

-- CreateIndex
CREATE INDEX "ScoreOverrideAuditLog_contextType_contextId_createdAt_idx" ON "ScoreOverrideAuditLog"("contextType", "contextId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ScoreOverrideAuditLog_userId_problemId_createdAt_idx" ON "ScoreOverrideAuditLog"("userId", "problemId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionFeedback_assessmentId_problemId_studentUserId_key" ON "SubmissionFeedback"("assessmentId", "problemId", "studentUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionFeedback_examId_problemId_studentUserId_key" ON "SubmissionFeedback"("examId", "problemId", "studentUserId");

-- CreateIndex
CREATE INDEX "SubmissionFeedbackAuditLog_assessmentId_problemId_createdAt_idx" ON "SubmissionFeedbackAuditLog"("assessmentId", "problemId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SubmissionFeedbackAuditLog_examId_problemId_createdAt_idx" ON "SubmissionFeedbackAuditLog"("examId", "problemId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SubmissionFeedbackAuditLog_studentUserId_problemId_createdA_idx" ON "SubmissionFeedbackAuditLog"("studentUserId", "problemId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Editorial_problemId_createdAt_idx" ON "Editorial"("problemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Editorial_userId_problemId_language_key" ON "Editorial"("userId", "problemId", "language");

-- CreateIndex
CREATE INDEX "EditorialVote_editorialId_idx" ON "EditorialVote"("editorialId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialVote_editorialId_userId_key" ON "EditorialVote"("editorialId", "userId");

-- CreateIndex
CREATE INDEX "EditorialReport_status_createdAt_idx" ON "EditorialReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialReport_editorialId_reportedByUserId_key" ON "EditorialReport"("editorialId", "reportedByUserId");

-- AddForeignKey
ALTER TABLE "TwoFactor" ADD CONSTRAINT "TwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolVerificationToken" ADD CONSTRAINT "SchoolVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clarification" ADD CONSTRAINT "Clarification_askedByUserId_fkey" FOREIGN KEY ("askedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clarification" ADD CONSTRAINT "Clarification_answeredByUserId_fkey" FOREIGN KEY ("answeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clarification" ADD CONSTRAINT "Clarification_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_plagiarismTriggeredById_fkey" FOREIGN KEY ("plagiarismTriggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestProblem" ADD CONSTRAINT "ContestProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_plagiarismTriggeredById_fkey" FOREIGN KEY ("plagiarismTriggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentProblem" ADD CONSTRAINT "AssessmentProblem_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentProblem" ADD CONSTRAINT "AssessmentProblem_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAuditLog" ADD CONSTRAINT "AssessmentAuditLog_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAuditLog" ADD CONSTRAINT "AssessmentAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementTranslation" ADD CONSTRAINT "AnnouncementTranslation_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlagiarismPairFlag" ADD CONSTRAINT "PlagiarismPairFlag_flaggedBy_fkey" FOREIGN KEY ("flaggedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlagiarismTriggerLog" ADD CONSTRAINT "PlagiarismTriggerLog_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemBookmark" ADD CONSTRAINT "ProblemBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemBookmark" ADD CONSTRAINT "ProblemBookmark_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionRejudgeLog" ADD CONSTRAINT "SubmissionRejudgeLog_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionRejudgeLog" ADD CONSTRAINT "SubmissionRejudgeLog_rejudgedByUserId_fkey" FOREIGN KEY ("rejudgedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreOverride" ADD CONSTRAINT "ScoreOverride_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreOverrideAuditLog" ADD CONSTRAINT "ScoreOverrideAuditLog_overrideId_fkey" FOREIGN KEY ("overrideId") REFERENCES "ScoreOverride"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreOverrideAuditLog" ADD CONSTRAINT "ScoreOverrideAuditLog_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFeedback" ADD CONSTRAINT "SubmissionFeedback_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFeedback" ADD CONSTRAINT "SubmissionFeedback_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFeedback" ADD CONSTRAINT "SubmissionFeedback_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFeedback" ADD CONSTRAINT "SubmissionFeedback_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFeedback" ADD CONSTRAINT "SubmissionFeedback_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFeedbackAuditLog" ADD CONSTRAINT "SubmissionFeedbackAuditLog_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "SubmissionFeedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionFeedbackAuditLog" ADD CONSTRAINT "SubmissionFeedbackAuditLog_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Editorial" ADD CONSTRAINT "Editorial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Editorial" ADD CONSTRAINT "Editorial_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialVote" ADD CONSTRAINT "EditorialVote_editorialId_fkey" FOREIGN KEY ("editorialId") REFERENCES "Editorial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialVote" ADD CONSTRAINT "EditorialVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialReport" ADD CONSTRAINT "EditorialReport_editorialId_fkey" FOREIGN KEY ("editorialId") REFERENCES "Editorial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialReport" ADD CONSTRAINT "EditorialReport_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialReport" ADD CONSTRAINT "EditorialReport_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Raw-SQL search artifacts (not modeled by Prisma): full-text + trigram GIN indexes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "ProblemStatementI18n_fts_idx"
  ON "ProblemStatementI18n"
  USING GIN (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("bodyMarkdown", '')));

CREATE INDEX "ProblemStatementI18n_trgm_idx"
  ON "ProblemStatementI18n"
  USING GIN ((coalesce("title", '') || ' ' || coalesce("bodyMarkdown", '')) gin_trgm_ops);

-- Raw-SQL CHECK constraints (not modeled by Prisma): single-context + participation invariants.
ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_single_context_chk"
  CHECK (
    (
      ("assessmentId" IS NOT NULL)::int +
      ("examId" IS NOT NULL)::int +
      ("contestId" IS NOT NULL)::int
    ) <= 1
  );

ALTER TABLE "SubmissionFeedback"
  ADD CONSTRAINT "SubmissionFeedback_single_context_chk"
  CHECK (
    (("assessmentId" IS NOT NULL)::int +
     ("examId" IS NOT NULL)::int) = 1
  );

ALTER TABLE "SubmissionFeedbackAuditLog"
  ADD CONSTRAINT "SubmissionFeedbackAuditLog_single_context_chk"
  CHECK (
    (("assessmentId" IS NOT NULL)::int +
     ("examId" IS NOT NULL)::int) = 1
  );

ALTER TABLE "Participation" ADD CONSTRAINT "Participation_single_context_chk" CHECK (
    ("type" = 'exam' AND "examId" IS NOT NULL AND "contestId" IS NULL)
    OR ("type" IN ('contest', 'virtual') AND "contestId" IS NOT NULL AND "examId" IS NULL)
);

ALTER TABLE "Participation" ADD CONSTRAINT "Participation_virtual_window_chk" CHECK (
    "type" <> 'virtual' OR ("startedAt" IS NOT NULL AND "endsAt" IS NOT NULL)
);

ALTER TABLE "Participation" ADD CONSTRAINT "Participation_ip_exam_only_chk" CHECK (
    ("ipPin" IS NULL AND "ipGateExemptUntil" IS NULL) OR "type" = 'exam'
);
