# Immutable sandbox toolchain

**Goal:** Keep PR, scheduled, and release sandbox builds independent of mutable Alpine package repositories while building the current runner source.

**Architecture:** Publish the existing Alpine/Node/APK environment as a dedicated GHCR image, pinned by digest in the runner Dockerfile. Keep npm compiler dependencies in the lockfile-backed builder. Validate installed platform and APK versions against the current canonical manifest during every runner build, without network access.

**Constraints:** Preserve current language versions, Docker isolation gates, and weekly/manual integration coverage. Support existing amd64 production/CI and arm64 local development. Do not modify unrelated work or deploy production.

## Steps

1. Extract the existing toolchain stage into `infra/docker/sandbox-toolchain.Dockerfile`; bootstrap both architectures from existing verified build layers without upgrading packages.
2. Validate installed versions; publish the toolchain image and verify anonymous pull access before pinning its real digest.
3. Replace the runner's APK installation with the immutable base and offline version verification. Document explicit maintainer publication commands and add a regression check; no new workflow is needed.
4. Run targeted infra tests, doc/supply-chain checks, real runner builds and hardened-container smoke tests; create a reviewable PR and inspect its CI.

## Validation / status

- Root cause verified in Actions run 34052524848: `go=1.26.3-r0` unavailable in mutable Alpine repository; installed release images retain the required environment.
- Existing workspace has unrelated changes; implementation is isolated in `.worktrees/sandbox-toolchain`.
- Published public multi-platform toolchain digest: `sha256:afc15b9725a22fe2c6d42627ead2bf949c0afb7ccea5c469fbf16b67ccb8e776`.
- amd64 bootstrap retains exactly the first six filesystem layers of attested v1.0.2 sandbox manifest `sha256:cbdcb7582ff508da0841ab39ffdfdcf630f62e1c5e707a54f901677da86abb0b`, ending at the APK installation/user-creation layer; runner/npm/wrapper layers and release labels are excluded. Its toolchain manifest is `sha256:b0d07fc2587151ee00895726531ae5c8e9851a76c8dcba8de37564e6df5b1866`.
- arm64 bootstrap uses matching local Docker build layers from the extracted toolchain Dockerfile; manifest `sha256:f6085722ac99405ece24b470cc0b52639db367372262c9d499f2e54d7ef0bf45`.
- No language version changed. Native runner build and hardened smoke passed. Offline validation accepts installed Go and rejects a deliberately mismatched Go version.
- Both amd64 and arm64 runner builds passed using the published multi-platform digest, including offline exact APK verification. Hardened container smoke passed on both architectures. Anonymous manifest access verified.
- 74 targeted infra tests, formatting, documentation drift, and supply-chain policy checks passed; independent review found no actionable issue.
- Real DockerExecutor checks returned AC for Python, JavaScript, TypeScript, C, C++, Rust, and Java. Go's compile check exhausts the existing bounded `/tmp`; the unchanged pre-fix local sandbox reproduces the identical failure. This resource-limit issue is outside the APK build fix.
- GitHub CI evidence pending.

Related: [Deployment guide](../../operations/DEPLOYMENT.md#standard-judge-toolchain), [Security](../../operations/SECURITY.md#sandbox-hardening-seccomp-posture).
