-- expand-contract-ok: the preceding expand migration backfills every row and
-- installs BEFORE INSERT/UPDATE triggers that populate rolling old-app writes.

DO $$
DECLARE
  invalid_exam_ids TEXT;
  invalid_contest_ids TEXT;
  invalid_assessment_ids TEXT;
BEGIN
  SELECT string_agg("id", ', ' ORDER BY "id")
  INTO invalid_exam_ids
  FROM "Exam"
  WHERE
    "scheduleRevision" < 0
    OR "timerFingerprint" IS NULL
    OR "timerFingerprint" NOT LIKE 'exam:v1:%';

  SELECT string_agg("id", ', ' ORDER BY "id")
  INTO invalid_contest_ids
  FROM "Contest"
  WHERE
    "scheduleRevision" < 0
    OR "timerFingerprint" IS NULL
    OR "timerFingerprint" NOT LIKE 'contest:v1:%';

  SELECT string_agg("id", ', ' ORDER BY "id")
  INTO invalid_assessment_ids
  FROM "Assessment"
  WHERE
    "scheduleRevision" < 0
    OR "timerFingerprint" IS NULL
    OR "timerFingerprint" NOT LIKE 'assessment:v1:%';

  IF
    invalid_exam_ids IS NOT NULL
    OR invalid_contest_ids IS NOT NULL
    OR invalid_assessment_ids IS NOT NULL
  THEN
    RAISE EXCEPTION USING MESSAGE = format(
      'Lifecycle schedule identity cutover blocked: Exam=[%s]; Contest=[%s]; Assessment=[%s]',
      COALESCE(invalid_exam_ids, ''),
      COALESCE(invalid_contest_ids, ''),
      COALESCE(invalid_assessment_ids, '')
    );
  END IF;
END
$$;

ALTER TABLE "Exam" ALTER COLUMN "timerFingerprint" SET NOT NULL;
ALTER TABLE "Contest" ALTER COLUMN "timerFingerprint" SET NOT NULL;
ALTER TABLE "Assessment" ALTER COLUMN "timerFingerprint" SET NOT NULL;

ALTER TABLE "Exam"
ADD CONSTRAINT "Exam_schedule_identity_chk"
CHECK ("scheduleRevision" >= 0 AND "timerFingerprint" LIKE 'exam:v1:%') NOT VALID;

ALTER TABLE "Contest"
ADD CONSTRAINT "Contest_schedule_identity_chk"
CHECK ("scheduleRevision" >= 0 AND "timerFingerprint" LIKE 'contest:v1:%') NOT VALID;

ALTER TABLE "Assessment"
ADD CONSTRAINT "Assessment_schedule_identity_chk"
CHECK ("scheduleRevision" >= 0 AND "timerFingerprint" LIKE 'assessment:v1:%') NOT VALID;

ALTER TABLE "Exam" VALIDATE CONSTRAINT "Exam_schedule_identity_chk";
ALTER TABLE "Contest" VALIDATE CONSTRAINT "Contest_schedule_identity_chk";
ALTER TABLE "Assessment" VALIDATE CONSTRAINT "Assessment_schedule_identity_chk";
