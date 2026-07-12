# demo-advanced-run

The **run** image for the seeded advanced-mode demo problem
(`problem_shell-scripting-lab`, "read two ints, print their sum"). It is the
untrusted half of the run/grade split: the only container that executes student
code. It runs the student's `main.py` against the baked `testcases/` inputs and
writes per-case stdout into `/workspace/output/`. It holds **no answers** — those
live only in the sibling `demo-advanced-grade` image.

Built and tagged `nojv-demo-advanced-run:local` +
`registry.nojv.tw/demo/nojv-demo-advanced-run:main` by:

```sh
pnpm demo-advanced:build
```

CI (`build-images.yml`) pushes the platform-registry ref on every main push (the `demo/` namespace is anonymous-pull); the seeded
problem's `advancedConfig` points at it so Kubernetes deployments can pull it.

The demo problem's `advancedConfig.run` in `packages/db/prisma/seeds/problems.ts`
points at this tag. This pairs a real run/grade demo (replacing the legacy
single-image `nojv-demo-judge-shell:local` shim) so the seeded problem judges
correctly under the real run/grade executor.

`nojv_runner.py` is the contract helper (don't edit); `runner.py` is the
per-problem run logic. See the container contract in
[JUDGE_PIPELINE.md](../../../docs/architecture/JUDGE_PIPELINE.md#container-contract),
or download the full run/grade/service starter templates from the problem
editor. This directory is a worked example of the same run contract.
