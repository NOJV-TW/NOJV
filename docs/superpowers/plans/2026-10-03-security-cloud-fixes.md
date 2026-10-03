# Security Cloud remediation plan

> Execute in the isolated `codex/security-cloud-fixes` worktree. Read findings against the pulled main revision before changing their owning layer.

**Goal:** Repair confirmed Security Cloud findings without weakening judge or exam boundaries.

**Status:** Nine technical findings are implemented and reviewed. Local CI passes (3,779 unit and 106 component tests), and 127 focused integration tests pass. Hidden-file confidentiality and the two image-storage findings remain pending product policy.

**Architecture:** Reuse the existing proctoring gate, problem permissions, strict Redis limiters, storage lifecycle and sandbox resource watchers. Keep runtime visibility and image-retention policy pending the user's decisions.

**Stack:** TypeScript, SvelteKit, Prisma/PostgreSQL, S3, Vitest.

1. Exam admission: remove the five-minute session-entry grace; deny every proctoring failure at submission and draft boundaries; prevent problem reads before start. Extend exam integration checks and the pure hook-denial check.
2. Request boundary: add a bounded multipart reader beside `readJsonBody`; bound auth bodies before cloning; throttle bearer requests before database lookup. Verify declared and streamed overflow and fail-closed limiting.
3. Disabled accounts: reject disabled sessions before Better Auth dispatch and revoke sessions when disabling the user. Verify disabled account endpoints and re-enable behavior.
4. Private discussions: enforce existing problem-view authorization in the common post-access path used by reads and mutations. Verify unrelated users cannot list, create, comment, vote or report.
5. Grader output: reuse Docker workspace watching for grade; cap result files and Kubernetes result logs before materializing them. Verify oversized results fail and normal results survive.
6. ZIP import: inspect the installed unzipper cancellation behavior, reproduce overflow, and stop inflation at the budget. Keep a runnable regression check.
7. Rejudge dispatch: revalidate current scope authority under transaction locks before creating executions. Verify revocation during preparation creates no durable work.
8. After the user's policy choices, resolve hidden-file semantics and image storage/retention using the existing mechanisms.
9. Update owning living docs and decision entries. Run focused unit/integration checks, repository checks, typechecks, and the local CI gate. Remove this plan when the change ships.

For each item, first add a regression check, observe the failure, make the smallest fix, then rerun that check. No production deployment or finding closure is part of local verification.
