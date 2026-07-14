import { describe, expect, it } from "vitest";

import { findBlockingIndexRelations } from "../../../scripts/migration-index-safety.mjs";

describe("migration index safety", () => {
  it.each([
    ['CREATE INDEX "Submission_lookup_idx" ON "Submission" ("id");', "public.Submission"],
    ["CREATE INDEX submission_lookup_idx ON Submission (id);", "public.submission"],
    ['CREATE INDEX submission_lookup_idx ON public."Submission" ("id");', "public.Submission"],
    ["CREATE UNIQUE INDEX submission_lookup_idx ON ONLY Submission (id);", "public.submission"],
  ])("rejects a blocking index on an existing relation: %s", (sql, relation) => {
    expect(findBlockingIndexRelations(sql)).toEqual([relation]);
  });

  it.each([
    'CREATE INDEX CONCURRENTLY "Submission_lookup_idx" ON "Submission" ("id");',
    'CREATE UNIQUE INDEX CONCURRENTLY "ActiveExamSession_one_active_per_user_key" ON "ActiveExamSession" ("userId") WHERE "endedAt" IS NULL;',
    'CREATE TABLE "NewTable" ("id" TEXT); CREATE INDEX "NewTable_id_idx" ON "NewTable" ("id");',
    "CREATE TABLE public.new_table (id TEXT); CREATE INDEX new_table_id_idx ON new_table (id);",
    "-- CREATE INDEX unsafe_idx ON Submission (id);\nSELECT 1;",
    "/* CREATE INDEX unsafe_idx ON Submission (id); */ SELECT 1;",
    "DO $$ BEGIN RAISE NOTICE 'CREATE INDEX unsafe_idx ON Submission (id)'; END $$;",
  ])("accepts a non-blocking migration: %s", (sql) => {
    expect(findBlockingIndexRelations(sql)).toEqual([]);
  });
});
