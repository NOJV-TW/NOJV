CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "ProblemStatementI18n_trgm_idx"
  ON "ProblemStatementI18n"
  USING GIN ((coalesce("title", '') || ' ' || coalesce("bodyMarkdown", '')) gin_trgm_ops);
