DO $$
DECLARE
  ambiguous_ids TEXT;
  invalid_virtual_ids TEXT;
BEGIN
  SELECT string_agg("id", ', ' ORDER BY "id")
  INTO ambiguous_ids
  FROM "Submission"
  WHERE
    (("assessmentId" IS NOT NULL)::int +
     ("examId" IS NOT NULL)::int +
     ("contestId" IS NOT NULL)::int +
     ("participationId" IS NOT NULL)::int) > 1;

  SELECT string_agg(submission."id", ', ' ORDER BY submission."id")
  INTO invalid_virtual_ids
  FROM "Submission" AS submission
  JOIN "Participation" AS participation
    ON participation."id" = submission."participationId"
  WHERE
    participation."type" <> 'virtual'
    OR participation."userId" <> submission."userId";

  IF ambiguous_ids IS NOT NULL OR invalid_virtual_ids IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = format(
      'Submission context cutover blocked: ambiguous Submission ids=[%s]; invalid virtual ownership/type Submission ids=[%s]',
      COALESCE(ambiguous_ids, ''),
      COALESCE(invalid_virtual_ids, '')
    );
  END IF;
END
$$;

UPDATE "Submission" AS submission
SET "courseId" = assessment."courseId"
FROM "Assessment" AS assessment
WHERE submission."assessmentId" = assessment."id"
  AND submission."courseId" IS DISTINCT FROM assessment."courseId";

UPDATE "Submission"
SET "courseId" = NULL
WHERE "assessmentId" IS NULL
  AND "courseId" IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY "Assessment_id_courseId_key"
ON "Assessment"("id", "courseId");

ALTER TABLE "Assessment"
ADD CONSTRAINT "Assessment_id_courseId_key"
UNIQUE USING INDEX "Assessment_id_courseId_key";

CREATE UNIQUE INDEX CONCURRENTLY "Participation_id_userId_key"
ON "Participation"("id", "userId");

ALTER TABLE "Participation"
ADD CONSTRAINT "Participation_id_userId_key"
UNIQUE USING INDEX "Participation_id_userId_key";

ALTER TABLE "Submission"
DROP CONSTRAINT "Submission_single_context_chk";

ALTER TABLE "Submission"
ADD CONSTRAINT "Submission_canonical_context_chk"
CHECK (
  (
    "assessmentId" IS NULL
    AND "courseId" IS NULL
    AND "examId" IS NULL
    AND "contestId" IS NULL
    AND "participationId" IS NULL
  )
  OR (
    "assessmentId" IS NOT NULL
    AND "courseId" IS NOT NULL
    AND "examId" IS NULL
    AND "contestId" IS NULL
    AND "participationId" IS NULL
  )
  OR (
    "assessmentId" IS NULL
    AND "courseId" IS NULL
    AND "examId" IS NOT NULL
    AND "contestId" IS NULL
    AND "participationId" IS NULL
  )
  OR (
    "assessmentId" IS NULL
    AND "courseId" IS NULL
    AND "examId" IS NULL
    AND "contestId" IS NOT NULL
    AND "participationId" IS NULL
  )
  OR (
    "assessmentId" IS NULL
    AND "courseId" IS NULL
    AND "examId" IS NULL
    AND "contestId" IS NULL
    AND "participationId" IS NOT NULL
  )
) NOT VALID;

ALTER TABLE "Submission"
ADD CONSTRAINT "Submission_assessment_course_fkey"
FOREIGN KEY ("assessmentId", "courseId")
REFERENCES "Assessment"("id", "courseId")
ON DELETE RESTRICT ON UPDATE CASCADE
NOT VALID;

ALTER TABLE "Submission"
ADD CONSTRAINT "Submission_participation_owner_fkey"
FOREIGN KEY ("participationId", "userId")
REFERENCES "Participation"("id", "userId")
ON DELETE CASCADE ON UPDATE CASCADE
NOT VALID;

CREATE OR REPLACE FUNCTION enforce_submission_virtual_participation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  participation_type "ParticipationType";
  participation_user_id TEXT;
BEGIN
  IF NEW."participationId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "type", "userId"
  INTO participation_type, participation_user_id
  FROM "Participation"
  WHERE "id" = NEW."participationId"
  FOR SHARE;

  IF participation_type IS DISTINCT FROM 'virtual'
     OR participation_user_id IS DISTINCT FROM NEW."userId" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'Submission_virtual_participation_chk',
      MESSAGE = format(
        'Submission %s requires a virtual participation owned by user %s',
        NEW."id",
        NEW."userId"
      );
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION enforce_participation_submission_context()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  invalid_submission_id TEXT;
BEGIN
  IF NEW."type" = 'virtual' AND NEW."userId" = OLD."userId" THEN
    RETURN NEW;
  END IF;

  SELECT "id"
  INTO invalid_submission_id
  FROM "Submission"
  WHERE "participationId" = OLD."id"
    AND (NEW."type" <> 'virtual' OR "userId" <> NEW."userId")
  ORDER BY "id"
  LIMIT 1;

  IF invalid_submission_id IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'Submission_virtual_participation_chk',
      MESSAGE = format(
        'Participation %s is referenced by canonical virtual Submission %s',
        OLD."id",
        invalid_submission_id
      );
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS submission_virtual_participation ON "Submission";
CREATE TRIGGER submission_virtual_participation
BEFORE INSERT OR UPDATE OF "participationId", "userId"
ON "Submission"
FOR EACH ROW
EXECUTE FUNCTION enforce_submission_virtual_participation();

DROP TRIGGER IF EXISTS participation_submission_context ON "Participation";
CREATE TRIGGER participation_submission_context
BEFORE UPDATE OF "type", "userId"
ON "Participation"
FOR EACH ROW
EXECUTE FUNCTION enforce_participation_submission_context();

ALTER TABLE "Submission"
VALIDATE CONSTRAINT "Submission_canonical_context_chk";

ALTER TABLE "Submission"
VALIDATE CONSTRAINT "Submission_assessment_course_fkey";

ALTER TABLE "Submission"
VALIDATE CONSTRAINT "Submission_participation_owner_fkey";
