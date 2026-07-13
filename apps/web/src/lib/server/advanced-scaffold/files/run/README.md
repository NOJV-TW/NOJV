# NOJV advanced-judge — RUN image

The **run** image is the untrusted half of the advanced-mode split: it is the
**only** container that executes student code. It runs the student program
against the baked-in **inputs** and writes whatever the program produced into
`/workspace/output/`. It holds **no answers** and makes **no grading decision** —
that is the separate `grade` image's job. Never bake answers here.

## Files

| File             | What it is                                                                     |
| ---------------- | ------------------------------------------------------------------------------ |
| `Dockerfile`     | Builds the run image. Bakes the toolchain + `testcases/` inputs + the harness. |
| `runner.py`      | **The file you edit.** Compiles/runs the student per case, writes `/output`.   |
| `nojv_runner.py` | Helper — reads the contract, runs the student (binary-safe). Don't edit.       |
| `testcases/`     | Baked-in **inputs** (`case-*.in`). Not secret — the student may see them.      |

## Build & push

Build this image yourself and push it to a registry NOJV can pull, then paste
the **digest-pinned** reference into the problem editor's **Run image** field:

```sh
# If your testcases are secret, push to the private platform registry: get REG
# (host + your namespace) from the editor's "Registry push account" card. A
# public registry is fine only if the inputs aren't secret.
REG=<registry-host>/t/<your-username>
docker build -t "$REG/PROBLEM-run:v1" ./run
docker push "$REG/PROBLEM-run:v1"
docker buildx imagetools inspect "$REG/PROBLEM-run:v1"   # copy the sha256 digest
# paste $REG/PROBLEM-run@sha256:<digest> into the editor
```

See the top-level `README.md` for the full build → push → reference workflow.

## The contract

The platform mounts `/workspace` and runs your image:

```
/workspace/submission/   student files (read this)
/workspace/meta.json     { submissionId, language, submissionFiles, resourceLimits }
/workspace/output/        you write per-case outputs here (binary OK)
/testcases/               your baked-in inputs (case-*.in)
```

After the run container exits, the platform safely captures `/workspace/output/`
(symlinks and special files are dropped) and mounts it **read-only** into the
grade phase at `/workspace/run-output/`. Write outputs there as raw bytes so
image/audio data round-trips losslessly.

## Network modes

The run container reaches **at most one** peer, chosen per-problem:

- **`none`** (default) — no network at all. Offline judging.
- **`service`** — a TA-provided service container is reachable at
  `$NOJV_SERVICE_HOST`, a `host:port` value (no scheme), e.g. `service:8888`
  (Docker) or `10.96.0.42:8888` (K8s). Build a URL from it:
  `requests.get(f"http://{nojv.service_host()}/health")`.
  The service is isolated from the internet and cluster services.

## Runtime constraints

The run container runs as a non-root user with `--cap-drop ALL`,
`no-new-privileges`, and a read-only root filesystem. You may write only to
`/workspace` and `/tmp`. Everything needed at runtime must be baked into the
image at build time.
