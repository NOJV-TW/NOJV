DO $$
DECLARE
  invalid_exam_ids TEXT;
  invalid_contest_ids TEXT;
  invalid_assessment_ids TEXT;
BEGIN
  SELECT string_agg("id", ', ' ORDER BY "id")
  INTO invalid_exam_ids
  FROM "Exam"
  WHERE "startsAt" >= "endsAt";

  SELECT string_agg("id", ', ' ORDER BY "id")
  INTO invalid_contest_ids
  FROM "Contest"
  WHERE "startsAt" >= "endsAt";

  SELECT string_agg("id", ', ' ORDER BY "id")
  INTO invalid_assessment_ids
  FROM "Assessment"
  WHERE
    "opensAt" >= "closesAt"
    OR (
      "dueAt" IS NOT NULL
      AND ("opensAt" >= "dueAt" OR "dueAt" > "closesAt")
    );

  IF
    invalid_exam_ids IS NOT NULL
    OR invalid_contest_ids IS NOT NULL
    OR invalid_assessment_ids IS NOT NULL
  THEN
    RAISE EXCEPTION USING MESSAGE = format(
      'Cannot enforce effective time windows: Exam=[%s]; Contest=[%s]; Assessment=[%s]',
      COALESCE(invalid_exam_ids, ''),
      COALESCE(invalid_contest_ids, ''),
      COALESCE(invalid_assessment_ids, '')
    );
  END IF;
END
$$;

ALTER TABLE "Exam"
ADD CONSTRAINT "Exam_effective_time_window_chk"
CHECK ("startsAt" < "endsAt") NOT VALID;

ALTER TABLE "Contest"
ADD CONSTRAINT "Contest_effective_time_window_chk"
CHECK ("startsAt" < "endsAt") NOT VALID;

ALTER TABLE "Assessment"
ADD CONSTRAINT "Assessment_effective_time_window_chk"
CHECK (
  "opensAt" < "closesAt"
  AND (
    "dueAt" IS NULL
    OR ("opensAt" < "dueAt" AND "dueAt" <= "closesAt")
  )
) NOT VALID;

ALTER TABLE "Exam"
VALIDATE CONSTRAINT "Exam_effective_time_window_chk";

ALTER TABLE "Contest"
VALIDATE CONSTRAINT "Contest_effective_time_window_chk";

ALTER TABLE "Assessment"
VALIDATE CONSTRAINT "Assessment_effective_time_window_chk";
