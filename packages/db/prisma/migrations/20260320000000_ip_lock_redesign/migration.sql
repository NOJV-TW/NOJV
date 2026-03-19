-- Replace ipLockEnabled with ipWhitelistEnabled, ipBindingEnabled, ipWhitelist, ipViolationMode

-- Contest
ALTER TABLE "Contest" ADD COLUMN "ipWhitelistEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Contest" ADD COLUMN "ipBindingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Contest" ADD COLUMN "ipWhitelist" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Contest" ADD COLUMN "ipViolationMode" TEXT NOT NULL DEFAULT 'block';

-- Migrate existing ipLockEnabled data to ipWhitelistEnabled
UPDATE "Contest" SET "ipWhitelistEnabled" = "ipLockEnabled" WHERE "ipLockEnabled" = true;

ALTER TABLE "Contest" DROP COLUMN "ipLockEnabled";

-- CourseAssessment
ALTER TABLE "CourseAssessment" ADD COLUMN "ipWhitelistEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CourseAssessment" ADD COLUMN "ipBindingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CourseAssessment" ADD COLUMN "ipWhitelist" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CourseAssessment" ADD COLUMN "ipViolationMode" TEXT NOT NULL DEFAULT 'block';

UPDATE "CourseAssessment" SET "ipWhitelistEnabled" = "ipLockEnabled" WHERE "ipLockEnabled" = true;

ALTER TABLE "CourseAssessment" DROP COLUMN "ipLockEnabled";

-- ContestParticipation: add IP binding fields
ALTER TABLE "ContestParticipation" ADD COLUMN "boundIp" TEXT;
ALTER TABLE "ContestParticipation" ADD COLUMN "boundAt" TIMESTAMP(3);

-- AssessmentParticipation: new model
CREATE TABLE "AssessmentParticipation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "boundIp" TEXT,
    "boundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentParticipation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssessmentParticipation_userId_assessmentId_key" ON "AssessmentParticipation"("userId", "assessmentId");

ALTER TABLE "AssessmentParticipation" ADD CONSTRAINT "AssessmentParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssessmentParticipation" ADD CONSTRAINT "AssessmentParticipation_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "CourseAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- IpViolationLog: new model
CREATE TABLE "IpViolationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contestId" TEXT,
    "assessmentId" TEXT,
    "expectedIp" TEXT,
    "actualIp" TEXT NOT NULL,
    "violationType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IpViolationLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "IpViolationLog" ADD CONSTRAINT "IpViolationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IpViolationLog" ADD CONSTRAINT "IpViolationLog_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IpViolationLog" ADD CONSTRAINT "IpViolationLog_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "CourseAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
