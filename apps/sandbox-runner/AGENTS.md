# Sandbox runner agent guide

Read the [module guide](README.md), [judge pipeline](../../docs/architecture/JUDGE_PIPELINE.md) and [security requirements](../../docs/operations/SECURITY.md) before changing execution behavior.

## Working rules

- Depend only on `@nojv/core` among workspace packages. Database, object storage and orchestration belong outside the runner.
- Preserve the run/judge trust boundary: contestant execution must not receive graded answers or validators. Review the [judge decisions](../../docs/decisions/judge.md) for the affected stage.
- Treat payload paths, hashes, sizes and process output as untrusted. Preserve validation and resource bounds when changing materialization or result collection.
- Keep runner request/result changes aligned with the core contract and worker payload builders and readers.
- Use the pinned toolchain source in `packages/core/src/judge-environment.json`; do not maintain separate compiler versions here.

## Verify

From the repository root:

```bash
pnpm -F @nojv/sandbox-runner typecheck
pnpm -F @nojv/sandbox-runner build
```

Run relevant runner unit tests. Execution or isolation changes also require rebuilding the sandbox image and running the affected sandbox integration tests; see [testing strategy](../../docs/runbooks/testing.md). A TypeScript build alone does not verify container isolation.
