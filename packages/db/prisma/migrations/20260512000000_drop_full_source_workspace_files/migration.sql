-- full_source problems no longer persist ProblemWorkspaceFile rows; the
-- system provides built-in starter templates per language. Any legacy rows
-- become unreachable through the UI and are deleted here. S3 contentKey
-- objects backed by these rows become orphans; clean separately via an ops
-- script if needed.
DELETE FROM "ProblemWorkspaceFile"
WHERE "problemId" IN (
  SELECT "id" FROM "Problem" WHERE "type" = 'full_source'
);
