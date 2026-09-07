BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE "Assessment", "Exam" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  assessment RECORD;
  rule JSONB;
  reason TEXT;
  late_count INTEGER;
BEGIN
  FOR assessment IN SELECT "id", "adjustmentRules", "dueAt", "closesAt"
    FROM "Assessment"
    WHERE "adjustmentRules" IS NOT NULL AND "adjustmentRules" <> 'null'::jsonb
    ORDER BY "id"
  LOOP
    reason := NULL;
    late_count := 0;
    IF jsonb_typeof(assessment."adjustmentRules") IS DISTINCT FROM 'array' THEN
      reason := 'adjustmentRules must be an array';
    ELSIF jsonb_array_length(assessment."adjustmentRules") > 10 THEN
      reason := 'more than 10 adjustment rules';
    ELSE
      FOR rule IN SELECT value FROM jsonb_array_elements(assessment."adjustmentRules")
      LOOP
        IF jsonb_typeof(rule) IS DISTINCT FROM 'object' THEN
          reason := 'each adjustment rule must be an object';
        ELSIF rule->>'type' = 'time_bonus' THEN
          IF jsonb_typeof(rule->'baselineMs') IS DISTINCT FROM 'number'
            OR rule->'baselineMs' < '0'::jsonb
            OR rule->'baselineMs' > '1.7976931348623157e308'::jsonb
            OR jsonb_typeof(rule->'maxBonusPercent') IS DISTINCT FROM 'number'
            OR rule->'maxBonusPercent' < '0'::jsonb OR rule->'maxBonusPercent' > '100'::jsonb THEN
            reason := 'unsupported time_bonus shape or range';
          END IF;
        ELSIF rule->>'type' IN ('flat_late_penalty', 'daily_late_penalty') THEN
          IF (rule ? 'startFrom' AND rule->'startFrom' NOT IN ('"due"'::jsonb, '"final_day"'::jsonb))
            OR (rule->>'type' = 'flat_late_penalty' AND (
              jsonb_typeof(rule->'penaltyPct') IS DISTINCT FROM 'number'
              OR rule->'penaltyPct' < '0'::jsonb OR rule->'penaltyPct' > '100'::jsonb))
            OR (rule->>'type' = 'daily_late_penalty' AND (
              jsonb_typeof(rule->'perDayPct') IS DISTINCT FROM 'number'
              OR rule->'perDayPct' < '0'::jsonb OR rule->'perDayPct' > '100'::jsonb)) THEN
            reason := 'unsupported late penalty shape, startFrom, or range';
          ELSIF COALESCE(rule->>'startFrom', 'due') = 'due'
            AND assessment."dueAt" < assessment."closesAt" THEN
            IF (rule->>'type' = 'flat_late_penalty' AND rule - ARRAY['type', 'penaltyPct', 'startFrom'] <> '{}'::jsonb)
              OR (rule->>'type' = 'daily_late_penalty' AND rule - ARRAY['type', 'perDayPct', 'startFrom'] <> '{}'::jsonb) THEN
              reason := 'retained late penalty has fields rejected by the new strict validator';
            ELSE
              late_count := late_count + 1;
            END IF;
          END IF;
        ELSIF rule->>'type' = 'final_day_zero' THEN
          CONTINUE;
        ELSE
          reason := 'unknown adjustment rule type or shape';
        END IF;
        EXIT WHEN reason IS NOT NULL;
      END LOOP;
      IF reason IS NULL AND late_count > 1 THEN
        reason := 'multiple retained late penalties; combined penalty semantics require an explicit decision';
      END IF;
    END IF;
    IF reason IS NOT NULL THEN
      RAISE EXCEPTION 'Late submission policy preflight: Assessment %: %', assessment."id", reason
        USING HINT = 'No policy or schema changes were committed. Review this Assessment and explicitly correct its policy before retrying; do not discard or combine penalties automatically.';
    END IF;
  END LOOP;
END $$;

ALTER TABLE "Exam" ADD COLUMN "dueAt" TIMESTAMP(3),
ADD COLUMN "adjustmentRules" JSONB;

UPDATE "Assessment" AS assessment
SET "adjustmentRules" = (
  SELECT COALESCE(jsonb_agg(
    CASE WHEN rule->>'type' = 'time_bonus' THEN rule ELSE rule - 'startFrom' END
    ORDER BY ordinal
  ), '[]'::jsonb)
  FROM jsonb_array_elements(assessment."adjustmentRules") WITH ORDINALITY AS entry(rule, ordinal)
  WHERE rule->>'type' = 'time_bonus'
    OR (rule->>'type' IN ('flat_late_penalty', 'daily_late_penalty')
      AND COALESCE(rule->>'startFrom', 'due') = 'due'
      AND assessment."dueAt" < assessment."closesAt")
)
WHERE jsonb_typeof("adjustmentRules") = 'array';

ALTER TABLE "Exam" ADD CONSTRAINT "Exam_dueAt_window_check"
CHECK ("dueAt" IS NULL OR ("startsAt" < "dueAt" AND "dueAt" <= "endsAt"));

COMMIT;
