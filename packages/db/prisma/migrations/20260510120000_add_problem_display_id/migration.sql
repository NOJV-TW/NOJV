-- Add displayId as nullable first to avoid blocking concurrent inserts.
ALTER TABLE "Problem" ADD COLUMN "displayId" INTEGER;

-- Backfill: assign sequential numbers to existing rows ordered by createdAt
-- (id breaks ties so the result is deterministic).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "Problem"
)
UPDATE "Problem" p
SET "displayId" = ranked.rn
FROM ranked
WHERE p.id = ranked.id;

-- Create the sequence Prisma's @default(autoincrement()) expects, owned by
-- the column so Postgres tears it down with the table.
CREATE SEQUENCE "Problem_displayId_seq" AS INTEGER OWNED BY "Problem"."displayId";

-- Pin sequence to continue from MAX(displayId) + 1; COALESCE handles empty tables.
SELECT setval(
  '"Problem_displayId_seq"',
  COALESCE((SELECT MAX("displayId") FROM "Problem"), 0) + 1,
  false
);

-- Lock the column down: NOT NULL, default from sequence, UNIQUE constraint.
ALTER TABLE "Problem"
  ALTER COLUMN "displayId" SET NOT NULL,
  ALTER COLUMN "displayId" SET DEFAULT nextval('"Problem_displayId_seq"');
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_displayId_key" UNIQUE ("displayId");
