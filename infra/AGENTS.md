# Infrastructure agent guide

Start with the [infrastructure index](README.md), [deployment guide](../docs/operations/DEPLOYMENT.md) and relevant [operations decisions](../docs/decisions/platform.md).

## Working rules

- Keep Helm as the deploy path and Docker Compose for local development. Follow the owning chart, Flux or GCP guide for the affected surface.
- Review environment schemas, chart values, rendered manifests and application consumers together. Preserve the env/manifest and package-boundary guards.
- For sandbox or networking changes, read [security requirements](../docs/operations/SECURITY.md); preserve fail-closed production probes and isolation boundaries.
- Keep image and toolchain references aligned with their canonical sources. Do not put credentials in values, examples or command output.
- Local lint and rendering verify configuration only. Report deployment success only from the actual revision and workload checks described in the [runbooks](../docs/runbooks/README.md).

## Verify

From the repository root:

```bash
pnpm lint:helm
pnpm exec vitest run --project unit tests/unit/infra/
```

Run these for chart or shared configuration changes. Dockerfile changes also need the affected image build; runtime changes need the corresponding integration checks from the [testing strategy](../docs/runbooks/testing.md).
