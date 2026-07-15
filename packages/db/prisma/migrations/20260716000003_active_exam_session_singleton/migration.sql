DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ActiveExamSession"
    WHERE "endedAt" IS NULL
    GROUP BY "userId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one active exam session per user: duplicate active sessions exist';
  END IF;
END
$$;
