CREATE INDEX "ProblemStatementI18n_fts_idx"
  ON "ProblemStatementI18n"
  USING GIN (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("bodyMarkdown", '')));
