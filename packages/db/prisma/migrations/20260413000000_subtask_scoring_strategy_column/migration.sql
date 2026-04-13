-- Move subtask scoring strategy from `Problem.judgeConfig.scoring.subtaskStrategies`
-- (a JSONB bag keyed by TestcaseSet id) onto a real column on TestcaseSet.
-- Also strip the now-removed `compare` and `scoring` keys from `judgeConfig`.
--
-- Operators inspecting RAISE NOTICE output should:
--   * audit any problem flagged with a non-`exact` compare mode — the new
--     standard judge applies a single canonical normalization, so float /
--     regex / case-insensitive matching now requires a checker.
--   * port any checker / interactor script flagged as bash / node / c —
--     only python and cpp are supported going forward.

CREATE TYPE "SubtaskScoringStrategy" AS ENUM ('ALL_OR_NOTHING', 'PROPORTIONAL', 'MINIMUM');

ALTER TABLE "TestcaseSet"
  ADD COLUMN "scoringStrategy" "SubtaskScoringStrategy" NOT NULL DEFAULT 'ALL_OR_NOTHING';

DO $$
DECLARE
  problem_row RECORD;
  pair RECORD;
  legacy_mode TEXT;
  checker_lang TEXT;
  interactor_lang TEXT;
BEGIN
  FOR problem_row IN
    SELECT id, "judgeConfig"
    FROM "Problem"
    WHERE "judgeConfig" IS NOT NULL
  LOOP
    -- Audit: non-`exact` compare modes no longer have a direct equivalent.
    legacy_mode := problem_row."judgeConfig"->'compare'->>'mode';
    IF legacy_mode IS NOT NULL AND legacy_mode <> 'exact' THEN
      RAISE NOTICE
        'Problem % had compare.mode = %; review and migrate to a checker if needed.',
        problem_row.id, legacy_mode;
    END IF;

    -- Audit: checker / interactor scripts in bash / node / c need manual port.
    checker_lang := problem_row."judgeConfig"->>'checkerLanguage';
    IF checker_lang IS NOT NULL AND checker_lang IN ('bash', 'node', 'c') THEN
      RAISE NOTICE
        'Problem % has checkerLanguage = %; port to python or cpp.',
        problem_row.id, checker_lang;
    END IF;
    interactor_lang := problem_row."judgeConfig"->>'interactorLanguage';
    IF interactor_lang IS NOT NULL AND interactor_lang IN ('bash', 'node', 'c') THEN
      RAISE NOTICE
        'Problem % has interactorLanguage = %; port to python or cpp.',
        problem_row.id, interactor_lang;
    END IF;

    -- Walk subtaskStrategies and copy each (setId, strategy) onto the column.
    IF problem_row."judgeConfig"->'scoring'->'subtaskStrategies' IS NOT NULL THEN
      FOR pair IN
        SELECT key AS set_id, value AS strategy_value
        FROM jsonb_each_text(problem_row."judgeConfig"->'scoring'->'subtaskStrategies')
      LOOP
        IF pair.strategy_value IN ('all_or_nothing', 'proportional', 'minimum') THEN
          UPDATE "TestcaseSet"
          SET "scoringStrategy" = upper(pair.strategy_value)::"SubtaskScoringStrategy"
          WHERE id = pair.set_id;
        ELSE
          RAISE NOTICE
            'Problem % had unknown subtask strategy % for set %; left at default.',
            problem_row.id, pair.strategy_value, pair.set_id;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$$;

UPDATE "Problem"
SET "judgeConfig" = ("judgeConfig" - 'scoring' - 'compare')
WHERE "judgeConfig" IS NOT NULL
  AND ("judgeConfig" ? 'scoring' OR "judgeConfig" ? 'compare');
