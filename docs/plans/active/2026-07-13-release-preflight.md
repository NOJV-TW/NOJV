# 2026-07-13 Release Preflight

## Goal

Verify the production deployment and every release-critical flow before launch, then repair the
functional, security, and Advanced authoring issues found by live and local testing.

## Scope

1. Audit `nojv.tw`, cluster health, authentication boundaries, submission state, sandbox network
   isolation, and production data durability.
2. Exercise standard and Advanced authoring, publishing, student submission, MFA/passkey step-up,
   API-token, admin, and responsive browser flows.
3. Remove the Advanced outbound allowlist design and enforce fail-closed isolation for Docker and
   Kubernetes service mode.
4. Make Advanced authoring match the actual image-digest workflow, reduce misleading UI, and make
   the mobile editor usable.
5. Bind Advanced publish verification to the complete judge configuration, required source paths,
   and resource limits; make published judge settings immutable.
6. Bind step-up state to the authenticated session and securely hand it to a rotated session after
   TOTP or passkey changes.
7. Make seed publishing and blob writes collision-safe and transaction-safe.
8. Run repository verification, dependency audit, full integration tests, full browser E2E, seed
   validation, Helm lint/render, container runtime probes, CI, deployment, and post-deploy checks.

## Production durability

A restore-verified off-host snapshot was created before release work. Automated off-site backups
remain blocked until an external S3/R2 bucket and credentials are supplied; the chart already
supports that destination and must not be configured with an unverified fallback.

## Exit criteria

- All local release gates and GitHub checks pass on the final commit.
- The merged images reconcile through Flux without direct cluster patching.
- `nojv.tw`, internal health endpoints, authentication guards, and a real Advanced submission pass
  against the deployed image digests.
- Any remaining operational gap is explicit, owned, and does not have a fabricated fallback.
