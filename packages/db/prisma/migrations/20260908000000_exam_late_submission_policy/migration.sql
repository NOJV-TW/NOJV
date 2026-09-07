ALTER TABLE "Exam" ADD COLUMN "dueAt" TIMESTAMP(3),
ADD COLUMN "adjustmentRules" JSONB;

UPDATE "Assessment" AS assessment
SET "adjustmentRules" = (
  SELECT COALESCE(jsonb_agg(rule - 'startFrom' ORDER BY ordinal), '[]'::jsonb)
  FROM jsonb_array_elements(assessment."adjustmentRules") WITH ORDINALITY AS entry(rule, ordinal)
  WHERE rule->>'type' <> 'final_day_zero'
    AND COALESCE(rule->>'startFrom', 'due') <> 'final_day'
    AND (rule->>'type' = 'time_bonus' OR (assessment."dueAt" IS NOT NULL AND assessment."dueAt" < assessment."closesAt"))
)
WHERE jsonb_typeof("adjustmentRules") = 'array';

ALTER TABLE "Exam" ADD CONSTRAINT "Exam_dueAt_window_check"
CHECK ("dueAt" IS NULL OR ("startsAt" < "dueAt" AND "dueAt" <= "endsAt"));
