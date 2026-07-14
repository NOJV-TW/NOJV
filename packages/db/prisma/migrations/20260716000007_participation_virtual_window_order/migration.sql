DO $$
DECLARE
  invalid_ids TEXT;
BEGIN
  SELECT string_agg("id", ', ' ORDER BY "id")
  INTO invalid_ids
  FROM "Participation"
  WHERE
    "type" = 'virtual'
    AND (
      "startedAt" IS NULL
      OR "endsAt" IS NULL
      OR "startedAt" >= "endsAt"
    );

  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = format(
      'Cannot enforce virtual participation windows; invalid Participation ids=[%s]',
      invalid_ids
    );
  END IF;
END
$$;

ALTER TABLE "Participation"
DROP CONSTRAINT "Participation_virtual_window_chk";

ALTER TABLE "Participation"
ADD CONSTRAINT "Participation_virtual_window_chk"
CHECK (
  "type" <> 'virtual'
  OR (
    "startedAt" IS NOT NULL
    AND "endsAt" IS NOT NULL
    AND "startedAt" < "endsAt"
  )
) NOT VALID;

ALTER TABLE "Participation"
VALIDATE CONSTRAINT "Participation_virtual_window_chk";
