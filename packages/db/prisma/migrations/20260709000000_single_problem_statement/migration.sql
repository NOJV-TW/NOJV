-- Problem titles are canonical on Problem.title, and each problem keeps a single
-- statement: ProblemStatementI18n(title, locale) collapses to ProblemStatement.
-- expand-contract-ok: statement title/locale have no readers outside the code
-- paths updated in this change; web/worker roll out together and the old-pod
-- window only affects problem statement reads, which is acceptable downtime.
DELETE FROM "ProblemStatementI18n" a
USING "ProblemStatementI18n" b
WHERE a."problemId" = b."problemId"
  AND a."id" <> b."id"
  AND ROW(CASE WHEN a."locale" = 'zh-TW' THEN 0 ELSE 1 END, a."id")
    > ROW(CASE WHEN b."locale" = 'zh-TW' THEN 0 ELSE 1 END, b."id");

DROP INDEX IF EXISTS "ProblemStatementI18n_fts_idx";
DROP INDEX IF EXISTS "ProblemStatementI18n_trgm_idx";

ALTER TABLE "ProblemStatementI18n" DROP COLUMN "title";
ALTER TABLE "ProblemStatementI18n" DROP COLUMN "locale";

ALTER TABLE "ProblemStatementI18n" RENAME TO "ProblemStatement";
ALTER INDEX "ProblemStatementI18n_pkey" RENAME TO "ProblemStatement_pkey";
ALTER TABLE "ProblemStatement" RENAME CONSTRAINT "ProblemStatementI18n_problemId_fkey" TO "ProblemStatement_problemId_fkey";

CREATE UNIQUE INDEX "ProblemStatement_problemId_key" ON "ProblemStatement"("problemId");

CREATE INDEX "ProblemStatement_fts_idx"
  ON "ProblemStatement"
  USING GIN (to_tsvector('english', coalesce("bodyMarkdown", '')));

CREATE INDEX "ProblemStatement_trgm_idx"
  ON "ProblemStatement"
  USING GIN ((coalesce("bodyMarkdown", '')) gin_trgm_ops);

CREATE INDEX "Problem_title_fts_idx"
  ON "Problem"
  USING GIN (to_tsvector('english', "title"));

CREATE INDEX "Problem_title_trgm_idx"
  ON "Problem"
  USING GIN ((coalesce("title", '')) gin_trgm_ops);
