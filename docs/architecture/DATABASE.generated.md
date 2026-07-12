# Database Schema Reference (generated)

<!-- GENERATED FILE — do not edit. Run `pnpm db:docs` to regenerate. -->

> Auto-generated from `packages/db/prisma/schema/*.prisma` by
> `scripts/generate-schema-docs.mjs`. The curated prose overview lives
> in [DATABASE.md](./DATABASE.md); this file is the exhaustive
> field-level reference.

_47 models and 38 enums across 9 schema files._

## `auth.prisma`

### Enums

#### `ApiTokenStatus`

`active` · `revoked`

#### `PlatformRole`

`admin` · `teacher` · `student`

#### `UserStatus`

`active` · `pending_first_login`

### Models

#### `Account`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id` |
| `accountId` | `String` | — |
| `providerId` | `String` | — |
| `userId` | `String` | — |
| `accessToken` | `String?` | — |
| `refreshToken` | `String?` | — |
| `idToken` | `String?` | — |
| `accessTokenExpiresAt` | `DateTime?` | — |
| `refreshTokenExpiresAt` | `DateTime?` | — |
| `scope` | `String?` | — |
| `password` | `String?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `user` | `User` | `@relation(fields: [userId], references: [id], onDelete: Cascade)` |

Indexes & constraints: `@@unique([providerId, accountId])`, `@@index([userId])`

#### `ApiToken`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `userId` | `String` | — |
| `user` | `User` | `@relation(fields: [userId], references: [id], onDelete: Cascade)` |
| `name` | `String` | — |
| `prefix` | `String` | `@unique` |
| `tokenHash` | `String` | `@unique` |
| `scopes` | `String[]` | `@default([])` |
| `status` | `ApiTokenStatus` | `@default(active)` |
| `expiresAt` | `DateTime` | — |
| `lastUsedAt` | `DateTime?` | — |
| `lastUsedIp` | `String?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `revokedAt` | `DateTime?` | — |
| `revokedById` | `String?` | — |
| `revokedBy` | `User?` | `@relation("ApiTokenRevoker", fields: [revokedById], references: [id], onDelete: SetNull)` |

Indexes & constraints: `@@index([userId])`, `@@index([status])`, `@@index([expiresAt])`

#### `Passkey`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id` |
| `name` | `String?` | — |
| `publicKey` | `String` | — |
| `userId` | `String` | — |
| `credentialID` | `String` | — |
| `counter` | `Int` | — |
| `deviceType` | `String` | — |
| `backedUp` | `Boolean` | — |
| `transports` | `String?` | — |
| `aaguid` | `String?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `user` | `User` | `@relation(fields: [userId], references: [id], onDelete: Cascade)` |

Indexes & constraints: `@@index([userId])`, `@@index([credentialID])`

#### `RegistryCredential`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `userId` | `String` | `@unique` |
| `user` | `User` | `@relation(fields: [userId], references: [id], onDelete: Cascade)` |
| `username` | `String` | `@unique` |
| `passwordHash` | `String` | — |
| `lastUsedAt` | `DateTime?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |

#### `SchoolVerificationToken`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `token` | `String` | `@id` |
| `userId` | `String` | — |
| `username` | `String` | — |
| `expiresAt` | `DateTime` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `user` | `User` | `@relation(fields: [userId], references: [id], onDelete: Cascade)` |

Indexes & constraints: `@@index([userId])`, `@@index([expiresAt])`

#### `Session`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id` |
| `expiresAt` | `DateTime` | — |
| `token` | `String` | `@unique` |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `ipAddress` | `String?` | — |
| `userAgent` | `String?` | — |
| `userId` | `String` | — |
| `user` | `User` | `@relation(fields: [userId], references: [id], onDelete: Cascade)` |

Indexes & constraints: `@@index([userId])`

#### `TwoFactor`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id` |
| `secret` | `String` | — |
| `backupCodes` | `String` | — |
| `userId` | `String` | — |
| `verified` | `Boolean` | `@default(true)` |
| `failedVerificationCount` | `Int` | `@default(0)` |
| `lockedUntil` | `DateTime?` | — |
| `user` | `User` | `@relation(fields: [userId], references: [id], onDelete: Cascade)` |

Indexes & constraints: `@@index([secret])`, `@@index([userId])`

#### `User`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `email` | `String` | `@unique` |
| `username` | `String?` | `@unique` |
| `displayUsername` | `String?` | — |
| `name` | `String` | — |
| `emailVerified` | `Boolean` | `@default(false)` |
| `image` | `String?` | — |
| `platformRole` | `PlatformRole` | `@default(student)` |
| `isSuperAdmin` | `Boolean` | `@default(false)` |
| `disabled` | `Boolean` | `@default(false)` |
| `status` | `UserStatus` | `@default(active)` |
| `mustChangePassword` | `Boolean` | `@default(false)` |
| `twoFactorEnabled` | `Boolean` | `@default(false)` |
| `twoFactorActivated` | `Boolean` | `@default(false)` |
| `profilePublic` | `Boolean` | `@default(false)` |
| `canCreateAdvancedProblems` | `Boolean` | `@default(false)` |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `sessions` | `Session[]` | — |
| `accounts` | `Account[]` | — |
| `schoolVerifications` | `SchoolVerificationToken[]` | — |
| `submissions` | `Submission[]` | — |
| `participations` | `Participation[]` | `@relation("UnifiedParticipationUser")` |
| `authoredProblems` | `Problem[]` | `@relation("ProblemAuthor")` |
| `ownedCourses` | `Course[]` | `@relation("CourseOwner")` |
| `courseMemberships` | `CourseMembership[]` | `@relation("CourseMembershipUser")` |
| `createdMemberships` | `CourseMembership[]` | `@relation("CourseMembershipCreator")` |
| `createdAssessments` | `Assessment[]` | `@relation("AssessmentCreator")` |
| `createdContests` | `Contest[]` | `@relation("ContestCreator")` |
| `createdExams` | `Exam[]` | `@relation("ExamCreator")` |
| `createdAnnouncements` | `Announcement[]` | `@relation("AnnouncementCreator")` |
| `triggeredExamPlagiarisms` | `Exam[]` | `@relation("ExamPlagiarismTriggerer")` |
| `triggeredContestPlagiarisms` | `Contest[]` | `@relation("ContestPlagiarismTriggerer")` |
| `triggeredAssessmentPlagiarisms` | `Assessment[]` | `@relation("AssessmentPlagiarismTriggerer")` |
| `problemPosts` | `ProblemPost[]` | — |
| `postVotes` | `PostVote[]` | — |
| `postComments` | `PostComment[]` | — |
| `ipViolationLogs` | `IpViolationLog[]` | — |
| `activeExamSessions` | `ActiveExamSession[]` | `@relation("ActiveExamSessionUser")` |
| `notifications` | `Notification[]` | — |
| `notificationPreference` | `NotificationPreference?` | — |
| `triggeredRejudgeLogs` | `SubmissionRejudgeLog[]` | — |
| `asOverrideStudent` | `ScoreOverride[]` | `@relation("ScoreOverrideUser")` |
| `createdScoreOverrides` | `ScoreOverride[]` | `@relation("ScoreOverrideCreator")` |
| `editedScoreOverrides` | `ScoreOverride[]` | `@relation("ScoreOverrideEditor")` |
| `scoreOverrideAuditChanges` | `ScoreOverrideAuditLog[]` | `@relation("ScoreOverrideAuditChanger")` |
| `clarificationsAsked` | `Clarification[]` | `@relation("ClarificationAsker")` |
| `plagiarismPairFlags` | `PlagiarismPairFlag[]` | `@relation("PlagiarismPairFlagFlagger")` |
| `clarificationsAnswered` | `Clarification[]` | `@relation("ClarificationAnswerer")` |
| `assessmentAuditLogs` | `AssessmentAuditLog[]` | `@relation("AssessmentAuditActor")` |
| `contentReportsFiled` | `ContentReport[]` | `@relation("ContentReportReporter")` |
| `contentReportsResolved` | `ContentReport[]` | `@relation("ContentReportResolver")` |
| `submissionFeedbackReceived` | `SubmissionFeedback[]` | `@relation("SubmissionFeedbackStudent")` |
| `submissionFeedbackAuthored` | `SubmissionFeedback[]` | `@relation("SubmissionFeedbackAuthor")` |
| `submissionFeedbackAuditChanges` | `SubmissionFeedbackAuditLog[]` | `@relation("SubmissionFeedbackAuditChanger")` |
| `triggeredPlagiarismLogs` | `PlagiarismTriggerLog[]` | `@relation("PlagiarismTriggerLogTriggerer")` |
| `problemBookmarks` | `ProblemBookmark[]` | — |
| `apiTokens` | `ApiToken[]` | — |
| `registryCredential` | `RegistryCredential?` | — |
| `revokedApiTokens` | `ApiToken[]` | `@relation("ApiTokenRevoker")` |
| `twoFactors` | `TwoFactor[]` | — |
| `passkeys` | `Passkey[]` | — |

#### `Verification`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id` |
| `identifier` | `String` | — |
| `value` | `String` | — |
| `expiresAt` | `DateTime` | — |
| `createdAt` | `DateTime?` | `@default(now())` |
| `updatedAt` | `DateTime?` | `@updatedAt` |

Indexes & constraints: `@@index([identifier])`

## `clarification.prisma`

### Enums

#### `ClarificationContextType`

`contest` · `exam` · `assignment`

#### `ClarificationState`

`pending` · `answered` · `dismissed`

### Models

#### `Clarification`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `contextType` | `ClarificationContextType` | — |
| `contextId` | `String` | — |
| `problemId` | `String?` | — |
| `askedByUserId` | `String` | — |
| `questionText` | `String` | `@db.Text` |
| `answerText` | `String?` | `@db.Text` |
| `state` | `ClarificationState` | `@default(pending)` |
| `isPublic` | `Boolean` | `@default(false)` |
| `answeredByUserId` | `String?` | — |
| `answeredAt` | `DateTime?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `deletedAt` | `DateTime?` | — |
| `askedBy` | `User` | `@relation("ClarificationAsker", fields: [askedByUserId], references: [id], onDelete: Cascade)` |
| `answeredBy` | `User?` | `@relation("ClarificationAnswerer", fields: [answeredByUserId], references: [id], onDelete: SetNull)` |
| `problem` | `Problem?` | `@relation("ProblemClarifications", fields: [problemId], references: [id], onDelete: SetNull)` |

Indexes & constraints: `@@index([contextType, contextId, createdAt(sort: Desc)])`, `@@index([contextType, contextId, state])`, `@@index([askedByUserId, createdAt(sort: Desc)])`

## `contest.prisma`

### Enums

#### `ContestScoringMode`

`problem_count` · `weighted_count` · `point_sum`

#### `ContestVisibility`

`draft` · `published`

#### `ExamScoringMode`

`problem_count` · `point_sum`

#### `ExamSessionEventType`

`enter` · `leave` · `visibility_lost` · `release` · `auto_close` · `heartbeat`

#### `ExamSessionReleaseReason`

`submitted` · `time_up` · `released_by_instructor`

#### `ExamStatus`

`draft` · `published`

#### `IpViolationMode`

`block` · `notify`

#### `IpViolationType`

`whitelist` · `binding`

#### `ParticipationStatus`

`registered` · `active` · `submitted` · `disqualified`

#### `ParticipationType`

`contest` · `exam` · `virtual`

#### `ScoreboardMode`

`hidden` · `live` · `frozen`

### Models

#### `ActiveExamSession`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `userId` | `String` | — |
| `examId` | `String` | — |
| `startedAt` | `DateTime` | `@default(now())` |
| `endedAt` | `DateTime?` | — |
| `releaseReason` | `ExamSessionReleaseReason?` | — |
| `lastHeartbeatAt` | `DateTime` | `@default(now())` |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `user` | `User` | `@relation("ActiveExamSessionUser", fields: [userId], references: [id], onDelete: Cascade)` |
| `exam` | `Exam` | `@relation(fields: [examId], references: [id], onDelete: Cascade)` |
| `events` | `ExamSessionEvent[]` | — |

Indexes & constraints: `@@unique([userId, examId])`, `@@index([examId, endedAt])`, `@@index([userId, endedAt])`

#### `Contest`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `title` | `String` | — |
| `summary` | `String` | `@db.Text` |
| `startsAt` | `DateTime` | — |
| `endsAt` | `DateTime` | — |
| `visibility` | `ContestVisibility` | `@default(draft)` |
| `scoringMode` | `ContestScoringMode` | `@default(problem_count)` |
| `scoreboardMode` | `ScoreboardMode` | `@default(live)` |
| `frozenBoard` | `Boolean` | `@default(true)` |
| `frozenAt` | `DateTime?` | — |
| `submitCooldownSec` | `Int` | `@default(0)` |
| `penaltyMinutesPerWrong` | `Int` | `@default(20)` |
| `allowedLanguages` | `SupportedLanguage[]` | `@default([])` |
| `inviteCode` | `String?` | `@unique` |
| `createdByUserId` | `String?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `plagiarismStatus` | `PlagiarismReportStatus?` | — |
| `plagiarismResults` | `Json?` | — |
| `plagiarismReportUrl` | `String?` | — |
| `plagiarismTriggeredAt` | `DateTime?` | — |
| `plagiarismCompletedAt` | `DateTime?` | — |
| `plagiarismTriggeredById` | `String?` | — |
| `createdBy` | `User?` | `@relation("ContestCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)` |
| `plagiarismTriggeredBy` | `User?` | `@relation("ContestPlagiarismTriggerer", fields: [plagiarismTriggeredById], references: [id], onDelete: SetNull)` |
| `problems` | `ContestProblem[]` | — |
| `submissions` | `Submission[]` | — |
| `participations` | `Participation[]` | `@relation("ContestUnifiedParticipation")` |

#### `ContestProblem`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `contestId` | `String` | — |
| `problemId` | `String` | — |
| `ordinal` | `Int` | — |
| `points` | `Int` | `@default(100)` |
| `createdAt` | `DateTime` | `@default(now())` |
| `contest` | `Contest` | `@relation(fields: [contestId], references: [id], onDelete: Cascade)` |
| `problem` | `Problem` | `@relation(fields: [problemId], references: [id], onDelete: Restrict)` |

Indexes & constraints: `@@unique([contestId, problemId])`, `@@unique([contestId, ordinal])`

#### `Exam`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `courseId` | `String` | — |
| `title` | `String` | — |
| `summary` | `String` | `@db.Text` |
| `startsAt` | `DateTime` | — |
| `endsAt` | `DateTime` | — |
| `status` | `ExamStatus` | `@default(draft)` |
| `scoringMode` | `ExamScoringMode` | `@default(point_sum)` |
| `scoreboardMode` | `ScoreboardMode` | `@default(hidden)` |
| `submitCooldownSec` | `Int` | `@default(0)` |
| `allowedLanguages` | `SupportedLanguage[]` | `@default([])` |
| `pageLockEnabled` | `Boolean` | `@default(false)` |
| `ipWhitelistEnabled` | `Boolean` | `@default(false)` |
| `ipBindingEnabled` | `Boolean` | `@default(false)` |
| `ipWhitelist` | `String[]` | `@default([])` |
| `ipViolationMode` | `IpViolationMode` | `@default(block)` |
| `plagiarismStatus` | `PlagiarismReportStatus?` | — |
| `plagiarismResults` | `Json?` | — |
| `plagiarismReportUrl` | `String?` | — |
| `plagiarismTriggeredAt` | `DateTime?` | — |
| `plagiarismCompletedAt` | `DateTime?` | — |
| `plagiarismTriggeredById` | `String?` | — |
| `createdByUserId` | `String?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `course` | `Course` | `@relation(fields: [courseId], references: [id], onDelete: Cascade)` |
| `createdBy` | `User?` | `@relation("ExamCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)` |
| `plagiarismTriggeredBy` | `User?` | `@relation("ExamPlagiarismTriggerer", fields: [plagiarismTriggeredById], references: [id], onDelete: SetNull)` |
| `problems` | `ExamProblem[]` | — |
| `submissions` | `Submission[]` | — |
| `ipViolationLogs` | `IpViolationLog[]` | — |
| `activeSessions` | `ActiveExamSession[]` | — |
| `submissionFeedback` | `SubmissionFeedback[]` | — |
| `participations` | `Participation[]` | `@relation("ExamUnifiedParticipation")` |

Indexes & constraints: `@@index([courseId, status])`

#### `ExamProblem`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `examId` | `String` | — |
| `problemId` | `String` | — |
| `ordinal` | `Int` | — |
| `points` | `Int` | `@default(100)` |
| `createdAt` | `DateTime` | `@default(now())` |
| `exam` | `Exam` | `@relation(fields: [examId], references: [id], onDelete: Cascade)` |
| `problem` | `Problem` | `@relation(fields: [problemId], references: [id], onDelete: Restrict)` |

Indexes & constraints: `@@unique([examId, problemId])`, `@@unique([examId, ordinal])`

#### `ExamSessionEvent`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `sessionId` | `String` | — |
| `eventType` | `ExamSessionEventType` | — |
| `occurredAt` | `DateTime` | `@default(now())` |
| `metadata` | `Json?` | — |
| `session` | `ActiveExamSession` | `@relation(fields: [sessionId], references: [id], onDelete: Cascade)` |

Indexes & constraints: `@@index([sessionId, occurredAt])`

#### `IpViolationLog`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `userId` | `String` | — |
| `examId` | `String` | — |
| `expectedIp` | `String?` | — |
| `actualIp` | `String` | — |
| `violationType` | `IpViolationType` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `user` | `User` | `@relation(fields: [userId], references: [id], onDelete: Cascade)` |
| `exam` | `Exam` | `@relation(fields: [examId], references: [id], onDelete: Cascade)` |

Indexes & constraints: `@@index([examId, createdAt])`, `@@index([userId, createdAt])`

#### `Participation`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `type` | `ParticipationType` | — |
| `userId` | `String` | — |
| `contestId` | `String?` | — |
| `examId` | `String?` | — |
| `score` | `Int` | `@default(0)` |
| `penaltySeconds` | `Int` | `@default(0)` |
| `subtaskScores` | `Json?` | — |
| `status` | `ParticipationStatus` | — |
| `version` | `Int` | `@default(0)` |
| `startedAt` | `DateTime?` | — |
| `submittedAt` | `DateTime?` | — |
| `ipPin` | `String?` | — |
| `ipGateExemptUntil` | `DateTime?` | — |
| `endsAt` | `DateTime?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `user` | `User` | `@relation("UnifiedParticipationUser", fields: [userId], references: [id], onDelete: Cascade)` |
| `contest` | `Contest?` | `@relation("ContestUnifiedParticipation", fields: [contestId], references: [id], onDelete: Cascade)` |
| `exam` | `Exam?` | `@relation("ExamUnifiedParticipation", fields: [examId], references: [id], onDelete: Cascade)` |
| `submissions` | `Submission[]` | — |

Indexes & constraints: `@@unique([type, contestId, userId])`, `@@unique([type, examId, userId])`, `@@index([userId])`

## `course.prisma`

### Enums

#### `AssessmentAuditAction`

`publish` · `revert_to_draft` · `delete_draft`

#### `AssessmentStatus`

`draft` · `published`

#### `CourseMembershipStatus`

`active` · `removed`

#### `CourseRole`

`teacher` · `ta` · `student`

### Models

#### `Assessment`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `courseId` | `String` | — |
| `title` | `String` | — |
| `summary` | `String` | `@db.Text` |
| `status` | `AssessmentStatus` | `@default(draft)` |
| `opensAt` | `DateTime` | — |
| `dueAt` | `DateTime?` | — |
| `closesAt` | `DateTime` | — |
| `maxAttemptsPerDay` | `Int?` | — |
| `attemptResetMinuteOfDay` | `Int?` | — |
| `allowedLanguages` | `SupportedLanguage[]` | `@default([])` |
| `adjustmentRules` | `Json?` | — |
| `createdByUserId` | `String` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `plagiarismStatus` | `PlagiarismReportStatus?` | — |
| `plagiarismResults` | `Json?` | — |
| `plagiarismReportUrl` | `String?` | — |
| `plagiarismTriggeredAt` | `DateTime?` | — |
| `plagiarismCompletedAt` | `DateTime?` | — |
| `plagiarismTriggeredById` | `String?` | — |
| `course` | `Course` | `@relation(fields: [courseId], references: [id], onDelete: Cascade)` |
| `createdBy` | `User` | `@relation("AssessmentCreator", fields: [createdByUserId], references: [id], onDelete: Restrict)` |
| `plagiarismTriggeredBy` | `User?` | `@relation("AssessmentPlagiarismTriggerer", fields: [plagiarismTriggeredById], references: [id], onDelete: SetNull)` |
| `problems` | `AssessmentProblem[]` | — |
| `submissions` | `Submission[]` | — |
| `submissionFeedback` | `SubmissionFeedback[]` | — |

Indexes & constraints: `@@index([courseId, status])`

#### `AssessmentAuditLog`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `assessmentId` | `String` | — |
| `courseId` | `String` | — |
| `actorUserId` | `String?` | — |
| `action` | `AssessmentAuditAction` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `course` | `Course` | `@relation(fields: [courseId], references: [id], onDelete: Cascade)` |
| `actor` | `User?` | `@relation("AssessmentAuditActor", fields: [actorUserId], references: [id], onDelete: SetNull)` |

Indexes & constraints: `@@index([assessmentId, createdAt])`, `@@index([courseId, createdAt])`

#### `AssessmentProblem`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `assessmentId` | `String` | — |
| `problemId` | `String` | — |
| `ordinal` | `Int` | — |
| `points` | `Int` | `@default(100)` |
| `createdAt` | `DateTime` | `@default(now())` |
| `assessment` | `Assessment` | `@relation(fields: [assessmentId], references: [id], onDelete: Cascade)` |
| `problem` | `Problem` | `@relation(fields: [problemId], references: [id], onDelete: Restrict)` |

Indexes & constraints: `@@unique([assessmentId, problemId])`, `@@unique([assessmentId, ordinal])`

#### `Course`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `title` | `String` | — |
| `description` | `String` | `@db.Text` |
| `ownerId` | `String` | — |
| `academicYear` | `Int?` | — |
| `semester` | `Int?` | — |
| `archived` | `Boolean` | `@default(false)` |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `owner` | `User` | `@relation("CourseOwner", fields: [ownerId], references: [id], onDelete: Restrict)` |
| `memberships` | `CourseMembership[]` | — |
| `assessments` | `Assessment[]` | — |
| `exams` | `Exam[]` | — |
| `submissions` | `Submission[]` | — |
| `announcements` | `Announcement[]` | — |
| `assessmentAuditLogs` | `AssessmentAuditLog[]` | — |

#### `CourseMembership`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `courseId` | `String` | — |
| `userId` | `String` | — |
| `role` | `CourseRole` | — |
| `status` | `CourseMembershipStatus` | `@default(active)` |
| `addedByUserId` | `String?` | — |
| `joinedAt` | `DateTime` | `@default(now())` |
| `removedAt` | `DateTime?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `course` | `Course` | `@relation(fields: [courseId], references: [id], onDelete: Cascade)` |
| `user` | `User` | `@relation("CourseMembershipUser", fields: [userId], references: [id], onDelete: Cascade)` |
| `addedBy` | `User?` | `@relation("CourseMembershipCreator", fields: [addedByUserId], references: [id], onDelete: SetNull)` |

Indexes & constraints: `@@unique([courseId, userId])`, `@@index([courseId, role, status])`, `@@index([userId, status])`

## `notification.prisma`

### Enums

#### `NotificationType`

`assignment_started` · `assignment_due_soon` · `exam_starting_soon` · `contest_starting_soon` · `course_enrolled` · `announcement_published` · `role_changed` · `clarification_answered` · `editorial_removed` · `post_removed` · `comment_removed`

### Models

#### `Notification`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `userId` | `String` | — |
| `type` | `NotificationType` | — |
| `params` | `Json` | — |
| `linkUrl` | `String?` | — |
| `readAt` | `DateTime?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `dedupeKey` | `String?` | — |
| `user` | `User` | `@relation(fields: [userId], references: [id], onDelete: Cascade)` |

Indexes & constraints: `@@unique([dedupeKey])`, `@@index([userId, createdAt(sort: Desc)])`, `@@index([userId, readAt, createdAt(sort: Desc)])`

#### `NotificationPreference`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `userId` | `String` | `@id` |
| `emailAssignmentStarted` | `Boolean` | `@default(true)` |
| `emailAssignmentDueSoon` | `Boolean` | `@default(true)` |
| `assignmentDueSoonLeadDays` | `Int` | `@default(3)` |
| `emailExamStarting` | `Boolean` | `@default(true)` |
| `examStartingLeadDays` | `Int` | `@default(1)` |
| `emailContestStarting` | `Boolean` | `@default(true)` |
| `contestStartingLeadDays` | `Int` | `@default(1)` |
| `emailSystemAnnouncement` | `Boolean` | `@default(true)` |
| `emailCourseAnnouncement` | `Boolean` | `@default(true)` |
| `emailCourseEnrolled` | `Boolean` | `@default(true)` |
| `emailRoleChanged` | `Boolean` | `@default(true)` |
| `emailEditorialRemoved` | `Boolean` | `@default(true)` |
| `user` | `User` | `@relation(fields: [userId], references: [id], onDelete: Cascade)` |

## `ops.prisma`

### Enums

#### `AdminAuditAction`

`user_role_change` · `user_disable` · `user_enable` · `user_delete` · `user_advanced_toggle` · `editorial_report_resolve` · `editorial_report_dismiss` · `content_report_resolve` · `content_report_dismiss` · `announcement_create` · `announcement_delete` · `registry_tag_delete` · `registry_gc`

#### `AnnouncementAudience`

`all` · `students` · `teachers`

#### `AnnouncementStatus`

`draft` · `published` · `archived`

#### `PlagiarismReportStatus`

`pending` · `running` · `completed` · `failed`

### Models

#### `AdminAuditLog`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `actorId` | `String?` | — |
| `actorName` | `String` | — |
| `action` | `AdminAuditAction` | — |
| `targetType` | `String?` | — |
| `targetId` | `String?` | — |
| `summary` | `String` | — |
| `createdAt` | `DateTime` | `@default(now())` |

Indexes & constraints: `@@index([createdAt])`

#### `Announcement`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `pinned` | `Boolean` | `@default(false)` |
| `status` | `AnnouncementStatus` | `@default(draft)` |
| `audience` | `AnnouncementAudience` | `@default(all)` |
| `publishedAt` | `DateTime?` | — |
| `expiresAt` | `DateTime?` | — |
| `createdByUserId` | `String?` | — |
| `courseId` | `String?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `createdBy` | `User?` | `@relation("AnnouncementCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)` |
| `course` | `Course?` | `@relation(fields: [courseId], references: [id], onDelete: Cascade)` |
| `translations` | `AnnouncementTranslation[]` | — |

Indexes & constraints: `@@index([status, pinned, publishedAt])`, `@@index([courseId, status, pinned, publishedAt])`

#### `AnnouncementTranslation`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `announcementId` | `String` | — |
| `locale` | `String` | — |
| `title` | `String` | — |
| `content` | `String` | `@db.Text` |
| `announcement` | `Announcement` | `@relation(fields: [announcementId], references: [id], onDelete: Cascade)` |

Indexes & constraints: `@@unique([announcementId, locale])`

#### `PlatformSetting`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `key` | `String` | `@id` |
| `value` | `String` | — |
| `updatedAt` | `DateTime` | `@updatedAt` |

## `plagiarism.prisma`

### Enums

#### `PlagiarismContext`

`assessment` · `exam` · `contest`

### Models

#### `PlagiarismPairFlag`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `contextType` | `PlagiarismContext` | — |
| `contextId` | `String` | — |
| `pairKey` | `String` | — |
| `flaggedBy` | `String` | — |
| `flaggedAt` | `DateTime` | `@default(now())` |
| `note` | `String?` | — |
| `flagger` | `User` | `@relation("PlagiarismPairFlagFlagger", fields: [flaggedBy], references: [id], onDelete: Cascade)` |

Indexes & constraints: `@@unique([contextType, contextId, pairKey])`, `@@index([contextType, contextId])`

#### `PlagiarismTriggerLog`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `contextType` | `PlagiarismContext` | — |
| `contextId` | `String` | — |
| `triggeredByUserId` | `String?` | — |
| `priorPairCount` | `Int` | — |
| `triggeredAt` | `DateTime` | `@default(now())` |
| `triggeredBy` | `User?` | `@relation("PlagiarismTriggerLogTriggerer", fields: [triggeredByUserId], references: [id], onDelete: SetNull)` |

Indexes & constraints: `@@index([contextType, contextId, triggeredAt(sort: Desc)])`

## `problem.prisma`

### Enums

#### `ProblemDifficulty`

`easy` · `medium` · `hard`

#### `ProblemStatus`

`draft` · `published`

#### `ProblemType`

`full_source` · `multi_file` · `special_env`

#### `ProblemVisibility`

`public` · `private`

#### `WorkspaceFileVisibility`

`editable` · `readonly` · `hidden`

### Models

#### `Problem`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `displayId` | `Int?` | `@unique` |
| `title` | `String` | — |
| `authorId` | `String?` | — |
| `visibility` | `ProblemVisibility` | `@default(public)` |
| `status` | `ProblemStatus` | `@default(draft)` |
| `difficulty` | `ProblemDifficulty` | `@default(medium)` |
| `tags` | `String[]` | `@default([])` |
| `type` | `ProblemType` | `@default(full_source)` |
| `timeLimitMs` | `Int` | — |
| `memoryLimitMb` | `Int` | — |
| `judgeConfig` | `Json?` | — |
| `samples` | `Json?` | — |
| `advancedConfig` | `Json?` | — |
| `advancedRequiredPaths` | `String[]` | `@default([])` |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `author` | `User?` | `@relation("ProblemAuthor", fields: [authorId], references: [id], onDelete: SetNull)` |
| `statement` | `ProblemStatement?` | — |
| `testcaseSets` | `TestcaseSet[]` | — |
| `workspaceFiles` | `ProblemWorkspaceFile[]` | — |
| `submissions` | `Submission[]` | — |
| `contestLinks` | `ContestProblem[]` | — |
| `examLinks` | `ExamProblem[]` | — |
| `assessmentLinks` | `AssessmentProblem[]` | — |
| `posts` | `ProblemPost[]` | — |
| `scoreOverrides` | `ScoreOverride[]` | `@relation("ScoreOverrideProblem")` |
| `clarifications` | `Clarification[]` | `@relation("ProblemClarifications")` |
| `submissionFeedback` | `SubmissionFeedback[]` | `@relation("SubmissionFeedbackProblem")` |
| `bookmarks` | `ProblemBookmark[]` | — |

Indexes & constraints: `@@index([status, visibility, createdAt])`, `@@index([authorId])`, `@@index([difficulty])`, `@@index([tags], type: Gin)`

#### `ProblemBookmark`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `userId` | `String` | — |
| `problemId` | `String` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `user` | `User` | `@relation(fields: [userId], references: [id], onDelete: Cascade)` |
| `problem` | `Problem` | `@relation(fields: [problemId], references: [id], onDelete: Cascade)` |

Indexes & constraints: `@@unique([userId, problemId])`, `@@index([userId, createdAt])`

#### `ProblemStatement`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `problemId` | `String` | `@unique` |
| `bodyMarkdown` | `String` | `@db.Text` |
| `inputFormat` | `String` | `@default("") @db.Text` |
| `outputFormat` | `String` | `@default("") @db.Text` |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `problem` | `Problem` | `@relation(fields: [problemId], references: [id], onDelete: Cascade)` |

#### `ProblemWorkspaceFile`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `problemId` | `String` | — |
| `language` | `SupportedLanguage` | — |
| `path` | `String` | — |
| `contentKey` | `String` | — |
| `visibility` | `WorkspaceFileVisibility` | — |
| `description` | `String` | `@default("") @db.Text` |
| `orderIndex` | `Int` | `@default(0)` |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `problem` | `Problem` | `@relation(fields: [problemId], references: [id], onDelete: Cascade)` |

Indexes & constraints: `@@unique([problemId, language, path])`, `@@index([problemId, language])`

#### `Testcase`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `testcaseSetId` | `String` | — |
| `ordinal` | `Int` | — |
| `inputKey` | `String` | — |
| `outputKey` | `String?` | — |
| `inputFileKeys` | `Json?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `testcaseSet` | `TestcaseSet` | `@relation(fields: [testcaseSetId], references: [id], onDelete: Cascade)` |

Indexes & constraints: `@@unique([testcaseSetId, ordinal])`

#### `TestcaseSet`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `problemId` | `String` | — |
| `name` | `String` | — |
| `description` | `String` | `@default("") @db.Text` |
| `weight` | `Int` | `@default(1)` |
| `ordinal` | `Int` | `@default(0)` |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `problem` | `Problem` | `@relation(fields: [problemId], references: [id], onDelete: Cascade)` |
| `testcases` | `Testcase[]` | — |

Indexes & constraints: `@@unique([problemId, name])`, `@@unique([problemId, ordinal])`

## `submission.prisma`

### Enums

#### `ContentReportStatus`

`open` · `resolved` · `dismissed`

#### `OverrideContextType`

`assignment` · `exam` · `contest`

#### `ProblemPostType`

`editorial` · `discussion`

#### `ScoreOverrideAction`

`create` · `update` · `delete`

#### `SubmissionFeedbackAction`

`create` · `update` · `delete`

#### `SubmissionStatus`

`pending_upload` · `queued` · `compiling` · `running` · `accepted` · `wrong_answer` · `time_limit_exceeded` · `memory_limit_exceeded` · `runtime_error` · `compile_error` · `system_error`

#### `SupportedLanguage`

`c` · `cpp` · `go` · `java` · `javascript` · `python` · `rust` · `typescript`

### Models

#### `ContentReport`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `postId` | `String?` | — |
| `commentId` | `String?` | — |
| `reportedByUserId` | `String` | — |
| `reason` | `String` | `@db.Text` |
| `status` | `ContentReportStatus` | `@default(open)` |
| `resolvedByUserId` | `String?` | — |
| `resolvedAt` | `DateTime?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `post` | `ProblemPost?` | `@relation(fields: [postId], references: [id], onDelete: Cascade)` |
| `comment` | `PostComment?` | `@relation(fields: [commentId], references: [id], onDelete: Cascade)` |
| `reportedBy` | `User` | `@relation("ContentReportReporter", fields: [reportedByUserId], references: [id], onDelete: Cascade)` |
| `resolvedBy` | `User?` | `@relation("ContentReportResolver", fields: [resolvedByUserId], references: [id], onDelete: SetNull)` |

Indexes & constraints: `@@unique([postId, reportedByUserId])`, `@@unique([commentId, reportedByUserId])`, `@@index([status, createdAt])`

#### `PostComment`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `postId` | `String` | — |
| `authorId` | `String` | — |
| `parentId` | `String?` | — |
| `content` | `String` | `@db.Text` |
| `createdAt` | `DateTime` | `@default(now())` |
| `deletedAt` | `DateTime?` | — |
| `post` | `ProblemPost` | `@relation(fields: [postId], references: [id], onDelete: Cascade)` |
| `author` | `User` | `@relation(fields: [authorId], references: [id], onDelete: Cascade)` |
| `parent` | `PostComment?` | `@relation("CommentReplies", fields: [parentId], references: [id], onDelete: Cascade)` |
| `replies` | `PostComment[]` | `@relation("CommentReplies")` |
| `reports` | `ContentReport[]` | — |

Indexes & constraints: `@@index([postId, createdAt])`

#### `PostVote`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `postId` | `String` | — |
| `userId` | `String` | — |
| `value` | `Int` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `post` | `ProblemPost` | `@relation(fields: [postId], references: [id], onDelete: Cascade)` |
| `user` | `User` | `@relation(fields: [userId], references: [id], onDelete: Cascade)` |

Indexes & constraints: `@@unique([postId, userId])`, `@@index([postId])`

#### `ProblemPost`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `type` | `ProblemPostType` | — |
| `authorId` | `String` | — |
| `problemId` | `String` | — |
| `title` | `String` | — |
| `content` | `String` | `@db.Text` |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `deletedAt` | `DateTime?` | — |
| `author` | `User` | `@relation(fields: [authorId], references: [id], onDelete: Cascade)` |
| `problem` | `Problem` | `@relation(fields: [problemId], references: [id], onDelete: Cascade)` |
| `comments` | `PostComment[]` | — |
| `reports` | `ContentReport[]` | — |
| `votes` | `PostVote[]` | — |

Indexes & constraints: `@@index([problemId, type, createdAt])`

#### `ScoreOverride`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `userId` | `String` | — |
| `problemId` | `String` | — |
| `contextType` | `OverrideContextType` | — |
| `contextId` | `String` | — |
| `overrideScore` | `Int` | — |
| `reason` | `String` | `@db.Text` |
| `createdByUserId` | `String?` | — |
| `updatedByUserId` | `String?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `user` | `User` | `@relation("ScoreOverrideUser", fields: [userId], references: [id], onDelete: Cascade)` |
| `problem` | `Problem` | `@relation("ScoreOverrideProblem", fields: [problemId], references: [id], onDelete: Cascade)` |
| `createdBy` | `User?` | `@relation("ScoreOverrideCreator", fields: [createdByUserId], references: [id], onDelete: SetNull)` |
| `updatedBy` | `User?` | `@relation("ScoreOverrideEditor", fields: [updatedByUserId], references: [id], onDelete: SetNull)` |
| `auditLogs` | `ScoreOverrideAuditLog[]` | — |

Indexes & constraints: `@@unique([userId, problemId, contextType, contextId])`, `@@index([contextType, contextId])`

#### `ScoreOverrideAuditLog`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `overrideId` | `String?` | — |
| `userId` | `String` | — |
| `problemId` | `String` | — |
| `contextType` | `OverrideContextType` | — |
| `contextId` | `String` | — |
| `action` | `ScoreOverrideAction` | — |
| `oldScore` | `Int?` | — |
| `newScore` | `Int?` | — |
| `oldReason` | `String?` | — |
| `newReason` | `String?` | — |
| `changedByUserId` | `String?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `override` | `ScoreOverride?` | `@relation(fields: [overrideId], references: [id], onDelete: SetNull)` |
| `changedBy` | `User?` | `@relation("ScoreOverrideAuditChanger", fields: [changedByUserId], references: [id], onDelete: SetNull)` |

Indexes & constraints: `@@index([contextType, contextId, createdAt(sort: Desc)])`, `@@index([userId, problemId, createdAt(sort: Desc)])`

#### `Submission`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `userId` | `String` | — |
| `problemId` | `String` | — |
| `examId` | `String?` | — |
| `contestId` | `String?` | — |
| `participationId` | `String?` | — |
| `courseId` | `String?` | — |
| `assessmentId` | `String?` | — |
| `sampleOnly` | `Boolean` | `@default(false)` |
| `language` | `SupportedLanguage` | — |
| `sourceStoragePrefix` | `String` | — |
| `status` | `SubmissionStatus` | `@default(queued)` |
| `score` | `Int` | `@default(0)` |
| `runtimeMs` | `Int?` | — |
| `memoryKb` | `Int?` | — |
| `verdictSummary` | `Json?` | — |
| `verdictDetailStorageKey` | `String?` | — |
| `advancedConfigSnapshot` | `Json?` | — |
| `ipAddress` | `String?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `user` | `User` | `@relation(fields: [userId], references: [id], onDelete: Cascade)` |
| `problem` | `Problem` | `@relation(fields: [problemId], references: [id], onDelete: Cascade)` |
| `exam` | `Exam?` | `@relation(fields: [examId], references: [id], onDelete: Restrict)` |
| `contest` | `Contest?` | `@relation(fields: [contestId], references: [id], onDelete: Restrict)` |
| `participation` | `Participation?` | `@relation(fields: [participationId], references: [id], onDelete: Cascade)` |
| `course` | `Course?` | `@relation(fields: [courseId], references: [id], onDelete: Restrict)` |
| `assessment` | `Assessment?` | `@relation(fields: [assessmentId], references: [id], onDelete: Restrict)` |
| `rejudgeLogs` | `SubmissionRejudgeLog[]` | — |

Indexes & constraints: `@@index([problemId, createdAt])`, `@@index([userId, createdAt])`, `@@index([courseId, assessmentId, createdAt])`, `@@index([contestId, problemId, createdAt])`, `@@index([examId, problemId, createdAt])`, `@@index([participationId, problemId, createdAt])`, `@@index([assessmentId, problemId, createdAt])`, `@@index([status, updatedAt])`, `@@index([problemId, sampleOnly, userId, status])`, `@@index([createdAt])`

#### `SubmissionFeedback`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `studentUserId` | `String` | — |
| `problemId` | `String` | — |
| `assessmentId` | `String?` | — |
| `examId` | `String?` | — |
| `comment` | `String` | `@db.Text` |
| `authorUserId` | `String?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `updatedAt` | `DateTime` | `@updatedAt` |
| `student` | `User` | `@relation("SubmissionFeedbackStudent", fields: [studentUserId], references: [id], onDelete: Cascade)` |
| `problem` | `Problem` | `@relation("SubmissionFeedbackProblem", fields: [problemId], references: [id], onDelete: Cascade)` |
| `assessment` | `Assessment?` | `@relation(fields: [assessmentId], references: [id], onDelete: Cascade)` |
| `exam` | `Exam?` | `@relation(fields: [examId], references: [id], onDelete: Cascade)` |
| `author` | `User?` | `@relation("SubmissionFeedbackAuthor", fields: [authorUserId], references: [id], onDelete: SetNull)` |
| `auditLogs` | `SubmissionFeedbackAuditLog[]` | — |

Indexes & constraints: `@@unique([assessmentId, problemId, studentUserId])`, `@@unique([examId, problemId, studentUserId])`

#### `SubmissionFeedbackAuditLog`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `feedbackId` | `String?` | — |
| `studentUserId` | `String` | — |
| `problemId` | `String` | — |
| `assessmentId` | `String?` | — |
| `examId` | `String?` | — |
| `action` | `SubmissionFeedbackAction` | — |
| `oldComment` | `String?` | `@db.Text` |
| `newComment` | `String?` | `@db.Text` |
| `changedByUserId` | `String?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `feedback` | `SubmissionFeedback?` | `@relation(fields: [feedbackId], references: [id], onDelete: SetNull)` |
| `changedBy` | `User?` | `@relation("SubmissionFeedbackAuditChanger", fields: [changedByUserId], references: [id], onDelete: SetNull)` |

Indexes & constraints: `@@index([assessmentId, problemId, createdAt(sort: Desc)])`, `@@index([examId, problemId, createdAt(sort: Desc)])`, `@@index([studentUserId, problemId, createdAt(sort: Desc)])`

#### `SubmissionRejudgeLog`

| Field | Type | Attributes |
| ----- | ---- | ---------- |
| `id` | `String` | `@id @default(cuid())` |
| `submissionId` | `String` | — |
| `rejudgedByUserId` | `String?` | — |
| `rejudgeRunId` | `String?` | — |
| `oldVerdict` | `String` | — |
| `oldScore` | `Int` | — |
| `oldResultJson` | `Json?` | — |
| `newVerdict` | `String?` | — |
| `newScore` | `Int?` | — |
| `newResultJson` | `Json?` | — |
| `createdAt` | `DateTime` | `@default(now())` |
| `submission` | `Submission` | `@relation(fields: [submissionId], references: [id], onDelete: Cascade)` |
| `rejudgedBy` | `User?` | `@relation(fields: [rejudgedByUserId], references: [id], onDelete: SetNull)` |

Indexes & constraints: `@@unique([submissionId, rejudgeRunId])`, `@@index([submissionId, createdAt(sort: Desc)])`, `@@index([rejudgedByUserId, createdAt(sort: Desc)])`, `@@index([createdAt(sort: Desc)])`

