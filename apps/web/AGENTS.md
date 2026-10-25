# Web agent guide

Read the [module guide](README.md) and [frontend surface](../../docs/architecture/FRONTEND.md) before changing routes or request handling. For visual changes, read the [design rules](../../docs/architecture/DESIGN.md); for access changes, read [security requirements](../../docs/operations/SECURITY.md).

## Working rules

- Keep request parsing, auth wiring, redirects and serialization in web. Put business rules and authorization in the owning application domain; compose page reads through its page-view query (ENG-02).
- Follow the [dependency rules](../../docs/architecture/ARCHITECTURE.md#dependency-rules) and the named exceptions in `eslint.config.mjs`. Do not bypass import guards.
- Put server-only adapters in `src/lib/server/`. Keep route-specific components beside their route and shared domain UI in `src/lib/components/features/`.
- Preserve the ordered request lifecycle in `src/hooks.server.ts`, including the first OTel import.
- Ship user-facing text through both `messages/en.json` and `messages/zh-TW.json`. Edit source messages, not generated Paraglide output.
- When changing a `+server.ts` endpoint, update its OpenAPI contract or documented exclusion (ENG-05). For GET endpoints, review the exam-confinement allowlist.

## Verify

Run commands from the repository root:

```bash
pnpm -F @nojv/web check
pnpm -F @nojv/web lint
```

Choose relevant component tests under `tests/component/web/`, HTTP integration tests under `tests/integration/http/`, and E2E journeys using the [testing strategy](../../docs/runbooks/testing.md). For visible UI changes, verify the affected interaction in the running app using the relevant E2E journey.
