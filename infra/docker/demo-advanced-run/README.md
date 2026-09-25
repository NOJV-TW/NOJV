# demo-advanced-run

Run image for the seeded special_env demo problem `problem_shell-scripting-lab`
("read two ints, print their sum"). It is the untrusted half of the run/grade
split: it runs the student's `main.py` against the baked `testcases/` and writes
per-case stdout to `/workspace/output/`. It holds no answers; those live only in
[`demo-advanced-grade`](../demo-advanced-grade/README.md).

- `runner.py`: per-problem run logic; the image also copies the canonical
  `nojv_runner.py` from `apps/web/src/lib/server/advanced-scaffold/files/run/`.
- Contract: [Judge Pipeline](../../../docs/architecture/JUDGE_PIPELINE.md#container-contract).

## Build and publish

```sh
pnpm demo-advanced:build   # nojv-demo-advanced-{run,grade,service}:local
DEMO_IMAGE_REGISTRY=<registry>/<namespace> DEMO_IMAGE_TAG=<release-label> \
  pnpm demo-advanced:push
```

`scripts/publish-demo-images.sh` builds `linux/amd64` and `linux/arm64`, pushes
the run, grade and service images, reads each manifest digest back, and prints
`SEED_ADVANCED_RUN_IMAGE` and `SEED_ADVANCED_GRADE_IMAGE` as `tag@sha256:`
references. `DEMO_IMAGE_TAG` must be a literal label (not `latest`, `main`,
`master` or `local`). On the self-hosted registry a platform credential can push
only to `t/<username>/`; `demo/` is pull-only. Put the printed values in the
runtime Secret; `packages/db/prisma/prod-seed.ts` requires both and has no
fallback.
