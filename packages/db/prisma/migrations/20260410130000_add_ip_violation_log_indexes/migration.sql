-- Admin IP-violation audit views filter on (contestId, createdAt) or
-- (assessmentId, createdAt) and sort by createdAt desc — without these
-- compound indexes Postgres has to seq-scan + sort the whole table every
-- time an admin opens the page. See `packages/db/src/repositories/
-- ip-violation.ts:13-24` (`listByTarget`).

CREATE INDEX "IpViolationLog_contestId_createdAt_idx"
  ON "IpViolationLog" ("contestId", "createdAt");

CREATE INDEX "IpViolationLog_assessmentId_createdAt_idx"
  ON "IpViolationLog" ("assessmentId", "createdAt");
