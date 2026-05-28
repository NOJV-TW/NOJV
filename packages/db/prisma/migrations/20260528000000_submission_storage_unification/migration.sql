ALTER TABLE "Submission" DROP COLUMN "sourceCode";
ALTER TABLE "Submission" DROP COLUMN "verdictDetail";
-- Backfill any extant rows with '' (a sentinel that no real storage prefix would have),
-- then drop the default so new inserts must supply a real key. Pre-production: no real
-- rows existed at migration time, so the sentinel never escapes.
ALTER TABLE "Submission" ADD COLUMN "sourceStoragePrefix" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Submission" ADD COLUMN "verdictSummary" JSONB;
ALTER TABLE "Submission" ADD COLUMN "verdictDetailStorageKey" TEXT;
ALTER TABLE "Submission" ALTER COLUMN "sourceStoragePrefix" DROP DEFAULT;
