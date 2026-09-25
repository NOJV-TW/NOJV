# demo-advanced-grade

Grade image for the seeded special_env demo problem `problem_shell-scripting-lab`.
It is the trusted half of the run/grade split: no student code runs here, so the
baked `answers/` cannot leak. It reads the run phase's outputs from
`/workspace/run-output/`, compares them to `/answers/`, honors the worker's
`runStatus`, and writes `/workspace/output/result.json` in the
`advancedResultSchema` shape.

- `grader.py`: per-problem grading logic; the image also copies the canonical
  `nojv_grader.py` from `apps/web/src/lib/server/advanced-scaffold/files/grade/`.
- Contract: [Judge Pipeline](../../../docs/architecture/JUDGE_PIPELINE.md#container-contract).
- Build and publish together with the run image: see
  [`demo-advanced-run`](../demo-advanced-run/README.md#build-and-publish). The
  published reference goes into `SEED_ADVANCED_GRADE_IMAGE`.
