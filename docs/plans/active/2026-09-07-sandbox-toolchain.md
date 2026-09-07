# Immutable sandbox toolchain

**Goal:** Keep PR, scheduled, and release sandbox builds independent of mutable Alpine package repositories while building the current runner source.

**Architecture:** Publish Alpine/Node/APK packages as a dedicated toolchain image in the existing public GHCR package, pinned by digest in the runner Dockerfile. Keep npm compiler dependencies in the lockfile-backed builder. Validate installed platform and APK versions against the current canonical manifest during every runner build, without network access.

**Constraints:** Preserve main's language versions, Docker isolation gates, and weekly/manual integration coverage. Support amd64 production/CI and arm64 local development. Do not modify unrelated work or deploy production.

## Implementation

- Extract APK installation into `infra/docker/sandbox-toolchain.Dockerfile` and publish both architectures under a separate `toolchain-…` tag.
- Replace the runner's APK installation with the immutable base and offline version verification.
- Document explicit maintainer publication commands and retain referenced toolchain versions; no new workflow is needed.
- Keep automatic dependency updates from moving the toolchain digest. Add a regression guard to the existing PR-gate tests.

## Validation

- Root cause verified in Actions run 34052524848: the pinned Go APK revision was unavailable upstream.
- Synced with main `bebf0857`, which already adopted Go `1.26.8-r0`; this change preserves that version and the rest of the manifest.
- Both toolchain architectures built from the extracted Dockerfile; exact platform/APK checks passed with networking disabled.
- 74 targeted infra tests, formatting, documentation drift, and supply-chain policy checks passed; independent review found no actionable issue.
- Runner smoke and GitHub validation results are tracked in PR #414.

Related: [Deployment guide](../../operations/DEPLOYMENT.md#standard-judge-toolchain), [Security](../../operations/SECURITY.md#sandbox-hardening-seccomp-posture).
