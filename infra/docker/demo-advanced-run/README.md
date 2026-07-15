# demo-advanced-run

The **run** image for the seeded advanced-mode demo problem
(`problem_shell-scripting-lab`, "read two ints, print their sum"). It is the
untrusted half of the run/grade split: the only container that executes student
code. It runs the student's `main.py` against the baked `testcases/` inputs and
writes per-case stdout into `/workspace/output/`. It holds **no answers** — those
live only in the sibling `demo-advanced-grade` image.

Built under the explicit local-only tag `nojv-demo-advanced-run:local` by:

```sh
pnpm demo-advanced:build
```

For production, publish a literal release tag, inspect that exact tag in the
authenticated registry, and set `SEED_ADVANCED_RUN_IMAGE` to the resulting
`tag@sha256:<digest>` reference. The production seed has no mutable fallback.

```sh
DEMO_IMAGE_REGISTRY=registry.nojv.tw/demo \
  DEMO_IMAGE_TAG=release-2026-07-15 \
  pnpm demo-advanced:push
```

The publisher prints the two exact `SEED_ADVANCED_*_IMAGE` values after the
registry confirms their manifest digests.

The demo problem's `advancedConfig.run` in `packages/db/prisma/seeds/problems.ts`
receives this reference explicitly, paired with the grade image so the seeded
problem judges correctly under the real run/grade executor.

The image uses the canonical `nojv_runner.py` from the advanced-mode starter
template; `runner.py` is the per-problem run logic. See the container contract in
[JUDGE_PIPELINE.md](../../../docs/architecture/JUDGE_PIPELINE.md#container-contract),
or download the full run/grade/service starter templates from the problem
editor. This directory is a worked example of the same run contract.
