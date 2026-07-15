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
