ALTER TABLE "Exam"
ADD COLUMN "examPasswordEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "examPasswordLockedAt" TIMESTAMP(3);

UPDATE "Exam"
SET "examPasswordEnabled" = true;

UPDATE "Exam" e
SET "examPasswordLockedAt" = COALESCE(credential."firstCredentialAt", CURRENT_TIMESTAMP)
FROM (
  SELECT "examId", MIN(COALESCE("emailSentAt", "createdAt")) AS "firstCredentialAt"
  FROM "ExamCredential"
  GROUP BY "examId"
) credential
WHERE credential."examId" = e.id;

ALTER TABLE "Exam"
ADD CONSTRAINT "Exam_examPassword_lock_requires_enabled_check"
CHECK ("examPasswordLockedAt" IS NULL OR "examPasswordEnabled" = true);
