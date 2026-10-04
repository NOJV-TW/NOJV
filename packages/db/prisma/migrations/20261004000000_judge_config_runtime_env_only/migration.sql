UPDATE "Problem"
SET "judgeConfig" = jsonb_set(
  "judgeConfig",
  '{runtime}',
  jsonb_build_object('env', COALESCE("judgeConfig" -> 'runtime' -> 'env', '{}'::jsonb))
)
WHERE jsonb_typeof("judgeConfig" -> 'runtime') = 'object';
