# Problem total scores

The raw-score work is implemented: Standard problems use the sum of testcase-set weights; Advanced problems use `advancedConfig.maxScore` (default 100). Submission scores and adjustment rules use that original problem scale.

The original proposal to use raw maxima directly as assignment/exam allocations is superseded by [activity problem weights](2026-09-08-assessment-problem-weights.md). Those activities now own their total and allocated points, while retaining raw scores for judging and manual overrides. The new migration preserves existing grades instead of reseeding user data.

Contest scoring remains governed by the existing contest mode: raw point sum, solved count, or the configured full-solve award. The activity weighting change does not alter contest algorithms.

Current contracts: [judge pipeline](../../architecture/JUDGE_PIPELINE.md), [assignments](../../specs/assignments.md), [exams](../../specs/exams.md).
