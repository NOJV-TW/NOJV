# Worker agent guide

Start with the [module guide](README.md). Read [orchestration](../../docs/architecture/ARCHITECTURE.md#temporal-orchestration) for workflow changes and the [judge pipeline](../../docs/architecture/JUDGE_PIPELINE.md) for sandbox execution changes.

## Working rules

- Keep workflow definitions and activities here; dispatch helpers and queue names belong in `@nojv/temporal`. Delegate business rules to `@nojv/application`.
- Treat workflow names, inputs and activity registration as contracts. Check `src/workflows/index.ts`, activity bundles and queue registration together.
- For workflow behavior changes, apply DAT-15 in the [data decisions](../../docs/decisions/data.md). Do not silently change the command sequence of an in-flight production workflow.
- Keep source and testcase bytes out of Temporal payloads (DAT-16).
- Follow [reliability invariants](../../docs/operations/RELIABILITY.md) for retries, idempotency and cleanup. Infrastructure failures must not become student verdicts.
- Keep Docker and Kubernetes adapters consistent with the shared sandbox contract; apply [security requirements](../../docs/operations/SECURITY.md) when modifying isolation or startup probes.

## Verify

From the repository root, run `pnpm -F @nojv/worker typecheck` and `pnpm -F @nojv/worker lint`, plus relevant tests under `tests/unit/worker/`.

Workflow changes need the relevant Temporal integration coverage; executor changes need the applicable sandbox or Kubernetes suite. Prerequisites and commands are in the [testing strategy](../../docs/runbooks/testing.md).
