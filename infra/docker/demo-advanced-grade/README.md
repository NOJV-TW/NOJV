# demo-advanced-grade

The **grade** image for the seeded advanced-mode demo problem
(`problem_shell-scripting-lab`, "read two ints, print their sum"). It is the
trusted half of the run/grade split: no student code runs here, so the baked
`answers/` can never leak. It reads the run phase's outputs from
`/workspace/run-output/`, compares them to `/answers/`, honors the worker's
`runStatus`, and writes `/workspace/output/result.json` in the
`advancedResultSchema` shape.

Built and tagged `nojv-demo-advanced-grade:local` +
`ghcr.io/nojv-tw/nojv-demo-advanced-grade:main` by:

```sh
pnpm demo-advanced:build
```

CI (`build-images.yml`) pushes the `ghcr.io` ref on every main push; the seeded
problem's `advancedConfig` points at it so Kubernetes deployments can pull it.

The demo problem's `advancedConfig.grade` in
`packages/db/prisma/seeds/problems.ts` points at this tag.

`nojv_grader.py` is the contract helper (don't edit); `grader.py` is the
per-problem grading logic. See the in-app scaffold README
(`apps/web/src/lib/server/advanced-scaffold/files/grade/README.md`) for the full
contract.
