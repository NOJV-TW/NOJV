# demo-advanced-grade

The **grade** image for the seeded advanced-mode demo problem
(`problem_shell-scripting-lab`, "read two ints, print their sum"). It is the
trusted half of the run/grade split: no student code runs here, so the baked
`answers/` can never leak. It reads the run phase's outputs from
`/workspace/run-output/`, compares them to `/answers/`, honors the worker's
`runStatus`, and writes `/workspace/output/result.json` in the
`advancedResultSchema` shape.

Built under the explicit local-only tag `nojv-demo-advanced-grade:local` by:

```sh
pnpm demo-advanced:build
```

For production, publish a literal release tag, inspect that exact tag in the
authenticated registry, and set `SEED_ADVANCED_GRADE_IMAGE` to the resulting
`tag@sha256:<digest>` reference. The production seed has no mutable fallback.

```sh
DEMO_IMAGE_REGISTRY=registry.nojv.tw/demo \
  DEMO_IMAGE_TAG=release-2026-07-15 \
  pnpm demo-advanced:push
```

The publisher prints the two exact `SEED_ADVANCED_*_IMAGE` values after the
registry confirms their manifest digests.

The demo problem's `advancedConfig.grade` in
`packages/db/prisma/seeds/problems.ts` receives this reference explicitly.

The image uses the canonical `nojv_grader.py` from the advanced-mode starter
template; `grader.py` is the per-problem grading logic. See the container contract in
[JUDGE_PIPELINE.md](../../../docs/architecture/JUDGE_PIPELINE.md#container-contract),
or download the full run/grade/service starter templates from the problem
editor. This directory is a worked example of the same grade contract.
