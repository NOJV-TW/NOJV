# Plan Index

Use [Planning System](../product/PLANS.md) for plan lifecycle and authoring rules. This index records what a plan means now without rewriting its original rationale. Status is checked against `main` at `fb9f34e5` on 2026-09-24; a merged PR proves integration, not production deployment. When evidence is incomplete, the entry says so rather than treating age or a checked box as proof.

## Active and unresolved plans

“Active” includes paused decisions, incomplete acceptance, external rollout gates, and plans whose remaining work needs an evidence-based status refresh. It does not mean every listed feature is absent from the code.

| Plan                                                                                                         | Current status and evidence                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [2026-06-29-problem-total-score](active/2026-06-29-problem-total-score.md)                                   | Implementation is present in main; PR #422 merged 2026-09-07. Remaining plan acceptance needs recheck.                                                             |
| [2026-07-07-admin-account-ux-overhaul](active/2026-07-07-admin-account-ux-overhaul.md)                       | Paused; the plan explicitly waits for product/design alignment on remaining account and admin work.                                                                |
| [2026-07-07-cloudflare-native-edge](active/2026-07-07-cloudflare-native-edge.md)                             | Implementation PR #204 is merged. Verify current deployment state separately before closing operational acceptance.                                                |
| [2026-07-07-system-health-check-remediation](active/2026-07-07-system-health-check-remediation.md)           | Implementation PR #208 is merged; backup activation and datasource follow-up remain explicitly assigned outside the PR.                                            |
| [2026-07-10-problem-posts-discussions](active/2026-07-10-problem-posts-discussions.md)                       | Superseded design variant: this version proposes separate pages; the same-name completed plan records the later workspace-panel decision. Preserve both.           |
| [2026-07-12-self-hosted-registry](active/2026-07-12-self-hosted-registry.md)                                 | Partial: plan says PR-A implemented and PR-B/PR-C pending; PR #257 alone does not close those phases.                                                              |
| [2026-07-12-special-env-image-ref](active/2026-07-12-special-env-image-ref.md)                               | Implementation PR #257 is merged; recheck remaining verification items before moving to completed.                                                                 |
| [2026-07-13-release-preflight](active/2026-07-13-release-preflight.md)                                       | Implemented in PR #267; production durability acceptance remains blocked on an external S3/R2 bucket and credentials per the plan.                                 |
| [2026-07-15-10mb-testcase-payload](active/2026-07-15-10mb-testcase-payload.md)                               | Implementation PR #284 is in main. Production recovery is explicitly unverified; current test policy excludes production records, so keep that separate gate open. |
| [2026-07-15-admin-mode-se-recovery](active/2026-07-15-admin-mode-se-recovery.md)                             | Recovery landed in main at `96acfd31`; later E2E coverage exists. CI/deployment and production-health acceptance still need current evidence.                      |
| [2026-07-24-parallel-release-images](active/2026-07-24-parallel-release-images.md)                           | Implementation PR #305 is merged; verify the current workflow and its release acceptance before closing.                                                           |
| [2026-08-06-immediate-judge-dispatch](active/2026-08-06-immediate-judge-dispatch.md)                         | Implementation PR #327 is merged; remaining crash-recovery and verification items need current mainline evidence.                                                  |
| [2026-08-06-secure-low-latency-judge-autoscaling](active/2026-08-06-secure-low-latency-judge-autoscaling.md) | Capacity changes merged in PR #351; production rollout/observation remains a separate gate in the plan.                                                            |
| [2026-08-07-safe-judge-latency-phase-1](active/2026-08-07-safe-judge-latency-phase-1.md)                     | Implementation is in main; plan acceptance includes integration/security/benchmark and observation evidence that must be checked separately.                       |
| [2026-08-08-reference-solution-validation](active/2026-08-08-reference-solution-validation.md)               | Implementation PR #349 is merged; recheck acceptance against current code before closing.                                                                          |
| [2026-08-11-gke-judge-capacity-alignment](active/2026-08-11-gke-judge-capacity-alignment.md)                 | Capacity changes merged in PR #351; validate current deployment-specific ceilings before closing.                                                                  |
| [2026-08-11-single-machine-throughput-tuning](active/2026-08-11-single-machine-throughput-tuning.md)         | Tuning changes merged in PR #351; production benchmark and rollback/cleanup acceptance remain evidence-gated.                                                      |
| [2026-08-14-judge-admission-and-memory](active/2026-08-14-judge-admission-and-memory.md)                     | Implementation PR #352 is merged; the file still says in progress, so verify the full verification section before closing.                                         |
| [2026-08-14-judge-toolchain-policy](active/2026-08-14-judge-toolchain-policy.md)                             | Status needs a fresh source/CI check; its last edit predates several policy and toolchain changes.                                                                 |
| [2026-08-15-problem-forks-admin-visibility](active/2026-08-15-problem-forks-admin-visibility.md)             | Implementation PR #357 is merged; recheck remaining E2E remediation and acceptance evidence.                                                                       |
| [2026-08-15-reference-validation-editor-form](active/2026-08-15-reference-validation-editor-form.md)         | Implementation PR #358 is merged; recheck current acceptance evidence before closing.                                                                              |
| [2026-08-20-problem-selector-redesign](active/2026-08-20-problem-selector-redesign.md)                       | Implementation is present in main; verify the complete task list and current routes before closing.                                                                |
| [2026-08-21-browser-local-run-npm-migration](active/2026-08-21-browser-local-run-npm-migration.md)           | Implementation PR #379 is merged; confirm deferred items remain intentionally deferred.                                                                            |
| [2026-08-21-ui-and-reliability-fixes](active/2026-08-21-ui-and-reliability-fixes.md)                         | Implementation PR #385 is merged; this plan spans more UI work than one merge, so reconcile each task against main.                                                |
| [2026-09-04-home-scroll-panels](active/2026-09-04-home-scroll-panels.md)                                     | Implementation PR #399 is merged; rerun its acceptance against the current homepage before closing.                                                                |
| [2026-09-07-admin-content-entry](active/2026-09-07-admin-content-entry.md)                                   | PR #406 is merged. The plan records local verification, not deployment; close after current code acceptance is confirmed.                                          |
| [2026-09-07-admin-signin-corrections](active/2026-09-07-admin-signin-corrections.md)                         | Implementation PR #413 is merged 2026-09-07; recheck current authentication acceptance before closing.                                                             |
| [2026-09-07-course-roster](active/2026-09-07-course-roster.md)                                               | Roster changes merged in PR #412 and follow-up #415; plan retains two unchecked delivery steps requiring reconciliation.                                           |
| [2026-09-08-assessment-problem-weights](active/2026-09-08-assessment-problem-weights.md)                     | Implementation PR #422 is merged. The plan explicitly leaves production migration/deployment outside its local verification.                                       |
| [2026-09-08-late-submission-policy](active/2026-09-08-late-submission-policy.md)                             | Implementation PR #420 is merged; production deployment is explicitly outside the plan verification.                                                               |
| [2026-09-08-problem-permissions](active/2026-09-08-problem-permissions.md)                                   | Permission and library work merged through PRs #421/#424; production migration remains tracked by the linked release plan.                                         |
| [2026-09-08-prod-roster-release](active/2026-09-08-prod-roster-release.md)                                   | Release implementation PRs #419/#421/#422/#424 are merged; at least one production rollout checkpoint remains unchecked.                                           |
| [2026-09-08-test-submit-parity](active/2026-09-08-test-submit-parity.md)                                     | Implementation PR #419 is merged; historical production sample repair is recorded separately from application release evidence.                                    |
| [2026-09-09-draft-delete](active/2026-09-09-draft-delete.md)                                                 | Implementation PR #427 is merged; production rollout remains pending per the plan.                                                                                 |
| [2026-09-09-test-reliability](active/2026-09-09-test-reliability.md)                                         | Implementation PR #428 is merged; remaining publication/production checks are still listed in the plan.                                                            |
| [2026-09-21-exam-access-safety](active/2026-09-21-exam-access-safety.md)                                     | Core changes merged in PR #477; later plan revisions add UI/search acceptance that must be checked against the final mainline commit.                              |
| [2026-09-21-sandbox-quota-recovery](active/2026-09-21-sandbox-quota-recovery.md)                             | Implementation PR #471 is merged; deployed migration/image and recovery evidence remain unchecked.                                                                 |
| [2026-09-21-submission-history](active/2026-09-21-submission-history.md)                                     | Implementation PR #473 is merged and local verification is recorded; production deployment is not implied.                                                         |
| [2026-09-22-durable-work-cron](active/2026-09-22-durable-work-cron.md)                                       | Implementation PR #483 is merged; the plan retains one unchecked item that needs reconciliation.                                                                   |
| [2026-09-24-codebase-clarity](active/2026-09-24-codebase-clarity.md)                                         | Active; this is the current repository-wide cleanup plan.                                                                                                          |

## Completed history

These original plans remain available with their decisions and reasons. Do not edit them to describe current implementation; link to current architecture or operations guidance instead.

- [2026-03-20-page-lock-ip-lock-design](completed/2026-03-20-page-lock-ip-lock-design.md)
- [2026-04-01-cp-problem-judge-mapping](completed/2026-04-01-cp-problem-judge-mapping.md)
- [2026-04-02-architecture-implementation-plan](completed/2026-04-02-architecture-implementation-plan.md)
- [2026-04-02-judge-pipeline-spec](completed/2026-04-02-judge-pipeline-spec.md)
- [2026-04-02-microservice-architecture-redesign](completed/2026-04-02-microservice-architecture-redesign.md)
- [2026-04-02-temporal-migration-design](completed/2026-04-02-temporal-migration-design.md)
- [2026-04-03-problem-config-implementation](completed/2026-04-03-problem-config-implementation.md)
- [2026-04-03-problem-config-redesign](completed/2026-04-03-problem-config-redesign.md)
- [2026-04-06-image-upload-design](completed/2026-04-06-image-upload-design.md)
- [2026-04-07-documentation-restructure](completed/2026-04-07-documentation-restructure.md)
- [2026-04-09-problem-ui-redesign](completed/2026-04-09-problem-ui-redesign.md)
- [2026-04-11-admin-users-ux-refinement-design](completed/2026-04-11-admin-users-ux-refinement-design.md)
- [2026-04-11-admin-users-ux-refinement](completed/2026-04-11-admin-users-ux-refinement.md)
- [2026-04-11-contest-hide-problems-and-tabs-design](completed/2026-04-11-contest-hide-problems-and-tabs-design.md)
- [2026-04-11-contest-hide-problems-and-tabs](completed/2026-04-11-contest-hide-problems-and-tabs.md)
- [2026-04-11-course-experience-redesign-design](completed/2026-04-11-course-experience-redesign-design.md)
- [2026-04-11-dashboard-ability-redesign-design](completed/2026-04-11-dashboard-ability-redesign-design.md)
- [2026-04-11-dashboard-ability-redesign](completed/2026-04-11-dashboard-ability-redesign.md)
- [2026-04-11-silent-failure-and-problemids-fix](completed/2026-04-11-silent-failure-and-problemids-fix.md)
- [2026-04-12-codebase-cleanup-audit](completed/2026-04-12-codebase-cleanup-audit.md)
- [2026-04-13-judge-config-simplification-design](completed/2026-04-13-judge-config-simplification-design.md)
- [2026-04-13-testcase-blob-storage-design](completed/2026-04-13-testcase-blob-storage-design.md)
- [2026-04-14-course-experience-redesign](completed/2026-04-14-course-experience-redesign.md)
- [2026-04-16-account-edit-name-username](completed/2026-04-16-account-edit-name-username.md)
- [2026-04-16-cuid-url-unification-design](completed/2026-04-16-cuid-url-unification-design.md)
- [2026-04-16-list-page-unification-design](completed/2026-04-16-list-page-unification-design.md)
- [2026-04-16-practice-after-close-design](completed/2026-04-16-practice-after-close-design.md)
- [2026-04-19-clarification-board-design](completed/2026-04-19-clarification-board-design.md)
- [2026-04-19-clarification-board-plan](completed/2026-04-19-clarification-board-plan.md)
- [2026-04-19-notification-center-design](completed/2026-04-19-notification-center-design.md)
- [2026-04-19-notification-center-plan](completed/2026-04-19-notification-center-plan.md)
- [2026-04-19-rejudge-and-score-override-design](completed/2026-04-19-rejudge-and-score-override-design.md)
- [2026-04-19-rejudge-and-score-override-plan](completed/2026-04-19-rejudge-and-score-override-plan.md)
- [2026-04-20-dolos-migration-design](completed/2026-04-20-dolos-migration-design.md)
- [2026-04-20-dolos-migration-plan](completed/2026-04-20-dolos-migration-plan.md)
- [2026-04-30-functional-gaps](completed/2026-04-30-functional-gaps.md)
- [2026-04-30-page-layout-system](completed/2026-04-30-page-layout-system.md)
- [2026-05-06-advanced-required-paths](completed/2026-05-06-advanced-required-paths.md)
- [2026-05-06-grafana-observability](completed/2026-05-06-grafana-observability.md)
- [2026-05-10-problem-display-id-design](completed/2026-05-10-problem-display-id-design.md)
- [2026-05-10-problem-display-id](completed/2026-05-10-problem-display-id.md)
- [2026-05-11-code-draft-autosave-design](completed/2026-05-11-code-draft-autosave-design.md)
- [2026-05-12-about-page-and-footer-design](completed/2026-05-12-about-page-and-footer-design.md)
- [2026-05-12-full-source-system-templates-design](completed/2026-05-12-full-source-system-templates-design.md)
- [2026-05-12-submission-detail-redesign-design](completed/2026-05-12-submission-detail-redesign-design.md)
- [2026-05-16-analytics-virtual-contest-upsolve](completed/2026-05-16-analytics-virtual-contest-upsolve.md)
- [2026-05-18-feature-completion-batch](completed/2026-05-18-feature-completion-batch.md)
- [2026-05-19-quality-followups](completed/2026-05-19-quality-followups.md)
- [2026-05-20-grading-feedback-audit-batch-design](completed/2026-05-20-grading-feedback-audit-batch-design.md)
- [2026-05-20-grading-feedback-audit-batch](completed/2026-05-20-grading-feedback-audit-batch.md)
- [2026-05-22-feedback-audit-and-plagiarism-trigger-log-design](completed/2026-05-22-feedback-audit-and-plagiarism-trigger-log-design.md)
- [2026-05-26-exam-ip-gating-hardening-design](completed/2026-05-26-exam-ip-gating-hardening-design.md)
- [2026-05-27-problems-filter-sidebar](completed/2026-05-27-problems-filter-sidebar.md)
- [2026-05-27-submission-unification-design](completed/2026-05-27-submission-unification-design.md)
- [2026-05-28-judge-isolation-domjudge-validator](completed/2026-05-28-judge-isolation-domjudge-validator.md)
- [2026-05-28-storage-unification-and-uploads](completed/2026-05-28-storage-unification-and-uploads.md)
- [2026-06-02-ui-overhaul-animations](completed/2026-06-02-ui-overhaul-animations.md)
- [2026-06-03-public-internal-api-docs](completed/2026-06-03-public-internal-api-docs.md)
- [2026-06-04-rejudge-ops-attempt-limit](completed/2026-06-04-rejudge-ops-attempt-limit.md)
- [2026-06-09-api-token-auth](completed/2026-06-09-api-token-auth.md)
- [2026-06-10-audit-remediation](completed/2026-06-10-audit-remediation.md)
- [2026-06-10-stale-submission-reaper](completed/2026-06-10-stale-submission-reaper.md)
- [2026-06-11-post-audit-next-phase](completed/2026-06-11-post-audit-next-phase.md)
- [2026-06-11-timed-assessment-supertype-design](completed/2026-06-11-timed-assessment-supertype-design.md)
- [2026-06-11-triplet-model-convergence-design](completed/2026-06-11-triplet-model-convergence-design.md)
- [2026-06-12-full-audit-remediation](completed/2026-06-12-full-audit-remediation.md)
- [2026-06-13-domjudge-alignment-followup](completed/2026-06-13-domjudge-alignment-followup.md)
- [2026-06-13-domjudge-alignment](completed/2026-06-13-domjudge-alignment.md)
- [2026-06-14-advanced-judge-run-grade-split-design](completed/2026-06-14-advanced-judge-run-grade-split-design.md)
- [2026-06-14-advanced-judge-run-grade-split-implementation](completed/2026-06-14-advanced-judge-run-grade-split-implementation.md)
- [2026-06-23-api-token-step-up-2fa-design](completed/2026-06-23-api-token-step-up-2fa-design.md)
- [2026-06-23-api-token-step-up-2fa-implementation](completed/2026-06-23-api-token-step-up-2fa-implementation.md)
- [2026-06-24-passwordless-stepup-2fa](completed/2026-06-24-passwordless-stepup-2fa.md)
- [2026-07-08-flux-gitops-cutover](completed/2026-07-08-flux-gitops-cutover.md)
- [2026-07-10-email-notifications-design](completed/2026-07-10-email-notifications-design.md)
- [2026-07-10-email-notifications-plan](completed/2026-07-10-email-notifications-plan.md)
- [2026-07-10-gradebook-public-profile](completed/2026-07-10-gradebook-public-profile.md)
- [2026-07-10-problem-posts-discussions-plan](completed/2026-07-10-problem-posts-discussions-plan.md)
- [2026-07-10-problem-posts-discussions](completed/2026-07-10-problem-posts-discussions.md)
- [2026-07-11-teacher-onboarding-tour-implementation](completed/2026-07-11-teacher-onboarding-tour-implementation.md)
- [2026-07-11-teacher-onboarding-tour](completed/2026-07-11-teacher-onboarding-tour.md)
- [2026-07-13-atomic-helm-artifact](completed/2026-07-13-atomic-helm-artifact.md)
- [2026-07-15-durable-onboarding-tour-state](completed/2026-07-15-durable-onboarding-tour-state.md)
- [2026-07-19-compiler-environment](completed/2026-07-19-compiler-environment.md)
- [2026-07-20-markdown-image-proxy](completed/2026-07-20-markdown-image-proxy.md)
- [2026-07-20-security-hardening](completed/2026-07-20-security-hardening.md)
- [2026-07-24-auth-rate-limit-admin-mode](completed/2026-07-24-auth-rate-limit-admin-mode.md)
- [2026-07-24-step-up-verification-modal](completed/2026-07-24-step-up-verification-modal.md)
- [2026-07-24-v-tag-releases](completed/2026-07-24-v-tag-releases.md)
- [2026-08-07-status-version-notification](completed/2026-08-07-status-version-notification.md)
- [2026-08-07-release-deploy-notification](completed/2026-08-07-release-deploy-notification.md)
- [2026-08-08-simplify-release-deploy-tags](completed/2026-08-08-simplify-release-deploy-tags.md)
- [2026-08-15-problem-publication-permissions](completed/2026-08-15-problem-publication-permissions.md)
- [2026-08-16-problem-picker-search](completed/2026-08-16-problem-picker-search.md)
- [2026-08-18-drag-reorder-problems](completed/2026-08-18-drag-reorder-problems.md)
- [2026-08-18-forge-judge-spike-design](completed/2026-08-18-forge-judge-spike-design.md)
- [2026-08-22-typescript-standard-judge](completed/2026-08-22-typescript-standard-judge.md)
- [2026-09-03-announcement-notification-links](completed/2026-09-03-announcement-notification-links.md)
- [2026-09-04-admin-mfa-redesign](completed/2026-09-04-admin-mfa-redesign.md)
- [2026-09-05-architecture-simplification](completed/2026-09-05-architecture-simplification.md)
- [2026-09-07-member-table-filters](completed/2026-09-07-member-table-filters.md)
- [2026-09-08-exam-submission-finality](completed/2026-09-08-exam-submission-finality.md)
- [2026-09-08-submission-id](completed/2026-09-08-submission-id.md)
- [2026-09-15-username-identity-boundary](completed/2026-09-15-username-identity-boundary.md)
- [2026-09-18-identity-hardening](completed/2026-09-18-identity-hardening.md)
- [2026-09-21-course-member-removal](completed/2026-09-21-course-member-removal.md)
- [2026-09-21-judge-capacity](completed/2026-09-21-judge-capacity.md)
- [2026-09-22-judge-slot-tuner](completed/2026-09-22-judge-slot-tuner.md)
- [2026-09-22-temporal-native-judge-queue](completed/2026-09-22-temporal-native-judge-queue.md)
- [2026-09-23-judge-single-sandbox-per-stage](completed/2026-09-23-judge-single-sandbox-per-stage.md)
- [2026-09-23-server-code-drafts](completed/2026-09-23-server-code-drafts.md)
- [README](completed/README.md)

## Related and overlapping records

- The two `2026-07-10-problem-posts-discussions` files are different design states, not duplicates: the active proposal uses standalone pages; the completed record captures the later workspace-panel decision. Keep both linked until the superseded proposal is formally closed.
- `2026-08-06-secure-low-latency-judge-autoscaling`, `2026-08-11-gke-judge-capacity-alignment`, and `2026-08-11-single-machine-throughput-tuning` share PR #351 but cover security/capacity policy, GKE capacity, and single-machine tuning respectively. A shared merge does not collapse their separate operational acceptance.
- `2026-09-07-course-roster`, `2026-09-08-problem-permissions`, and `2026-09-08-prod-roster-release` share rollout and identity/migration evidence. Read the release plan for production gates; do not repeat deployment claims from implementation plans.
- `2026-09-08-assessment-problem-weights` and `2026-09-08-late-submission-policy` are separate contracts even though their changes both affect assessment scoring and share mainline integration.
- `2026-07-13-atomic-helm-artifact` and `2026-08-08-simplify-release-deploy-tags` record successive release decisions; PR #348 removed the optional deploy tag while preserving the revision-pinned chart artifact.
- `2026-08-07-release-deploy-notification` was superseded when public verification moved to `NOJV-TW/status`; its completed file links to that successor.
- `2026-08-18-forge-judge-spike-design` is a completed browser-local execution spike, later implemented with WASM-OJ in PR #731. Its parity/performance corpus remains deferred and is not production judge evidence.
