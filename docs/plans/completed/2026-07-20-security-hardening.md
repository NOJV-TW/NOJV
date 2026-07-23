# Security Hardening Implementation Plan

**Goal:** Close the confirmed Kubernetes, registry-credential, admin-elevation, and dependency-audit risks without changing public Markdown image or API-documentation behavior.

**Architecture:** Kubernetes admission enforces the existing restricted sandbox pod contract, and separate service accounts give each worker only its required API permissions. Human registry credentials remain namespace-scoped regardless of platform role. OAuth sessions remain ordinary sessions; every administrator must enable and freshly complete two-factor verification before admin mode is granted.

**Tech Stack:** Helm/Kubernetes RBAC and Pod Security Admission, SvelteKit, Redis-backed TypeScript authorization, Vitest, pnpm audit.

---

### Task 1: Require two-factor verification for every admin elevation

**Files:**

- Modify: `packages/application/src/api-token/step-up.ts`
- Modify: `apps/web/src/hooks.server.ts`
- Modify: `apps/web/src/lib/components/features/auth/UserMenu.svelte`
- Test: `tests/unit/web/step-up.test.ts`
- Test: `tests/unit/web/api-tokens-step-up-gate.test.ts`

1. Add failing coverage for ordinary admins without 2FA and without a fresh verification marker.
2. Require enabled 2FA and both step-up markers for every admin principal.
3. Keep OAuth sessions de-elevated and route the toggle to setup or verification as appropriate.
4. Remove the superadmin-only global 2FA page gate because privilege now begins only at explicit elevation.
5. Run the focused step-up tests.

### Task 2: Scope human registry credentials to their namespace

**Files:**

- Modify: `packages/application/src/registry/credentials.ts`
- Modify: `packages/application/src/registry/scopes.ts`
- Test: `tests/unit/domain/registry-credentials.test.ts`
- Test: `tests/unit/domain/registry-scopes.test.ts`
- Test: `tests/unit/web/registry-token-endpoint.test.ts`

1. Replace admin-principal expectations with the account's existing teacher namespace principal.
2. Remove global catalog and repository access from credential-authenticated principals.
3. Preserve server-internal registry tokens used by the web management path.
4. Run focused registry tests.

### Task 3: Enforce sandbox admission and split worker identities

**Files:**

- Modify: `infra/charts/nojv/templates/namespaces.yaml`
- Modify: `infra/charts/nojv/templates/worker-rbac.yaml`
- Modify: `infra/charts/nojv/templates/worker-judge.deployment.yaml`
- Modify: `infra/charts/nojv/templates/worker-platform.deployment.yaml`
- Test: `tests/unit/infra/env-manifest-parity.test.ts`

1. Add failing manifest assertions for restricted Pod Security labels, split service accounts, and least-privilege bindings.
2. Enforce the restricted Pod Security profile on the sandbox namespace.
3. Give the judge worker sandbox permissions only and the platform worker registry-GC permissions only.
4. Disable platform token mounting when the registry is disabled.
5. Render both production values variants and run the infrastructure tests.

### Task 4: Restore dependency-audit visibility and align security docs

**Files:**

- Modify: `pnpm-workspace.yaml`
- Modify: `docs/operations/SECURITY.md`
- Modify: `docs/operations/THREAT_MODEL.md`
- Modify: `docs/operations/DEPLOYMENT.md`
- Modify: `docs/operations/QUALITY_SCORE.md`

1. Remove the three obsolete Undici GHSA ignores.
2. Document the effective admin, registry, service-account, and Pod Security boundaries.
3. Run `pnpm audit --audit-level high`, supply-chain lint, doc drift, formatting, type checks, focused tests, and full repository verification.
4. Move this plan to `docs/plans/completed/` when verification is green.
