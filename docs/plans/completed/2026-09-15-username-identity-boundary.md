# Username identity boundary

## Goal and approved behavior

Onboarding sets a unique general username and rejects reserved school-ID formats.
Only explicit three-school verification replaces that username with a student ID.
Sign-in, primary-email changes, and provider linking preserve the existing username.

## Scope

- Remove school-email inference from `linkUserCourseRoster`; retain binding of
  pending memberships using the username the user already owns.
- Simplify `/complete-profile` to the existing general-username form and remove
  its school-verification action. Keep explicit school verification in settings.
- Keep username uniqueness, reserved-format validation, disabled-user rejection,
  and the existing verified-school roster merge behavior.
- No schema migration or production data changes.

## Milestones

- [x] Update roster integration cases to preserve null, general, and verified
      usernames despite verified school emails, including a conflicting owner.
- [x] Run the focused regression against the original implementation, then remove
      automatic username assignment and run roster/account identity integration tests.
- [x] Simplify onboarding and update its copy and relevant browser coverage.
- [x] Align the product contract and run formatting, type/lint checks, focused
      auth tests, and an independent code review.

## Validation

Use the existing safety-marked loopback `nojv_test` database for integration tests
and `nojv_e2e_test` for browser tests. Do not use the development or production DB.
Record executed commands and results below. Other uncommitted work in the primary
checkout is outside this isolated worktree.

## References

- [Product behavior](../../product/PRODUCT_SENSE.md)
- [Roster identity](../../architecture/DATABASE.md#course-roster-and-grading-subjects)
- [Testing](../../runbooks/testing.md)

## Results

- Removed email-derived username assignment; login retains existing-username roster
  binding, and explicit school verification remains the school-ID assignment path.
- Added real Better Auth / PostgreSQL OAuth callback and linking regression cases
  in `tests/integration/http/auth-username-identity.test.ts`, included in test
  typechecking. Provider network responses alone are mocked.
- Baseline: 37 school-identity and username unit tests passed before the change.
- Validation: 51 focused auth, email-change, school-identity, and username unit
  tests passed; web/dependency build (9 tasks), typecheck (16 tasks),
  `pnpm typecheck:tests`, targeted ESLint/Prettier, and `lint:doc-drift` passed.
- The user explicitly authorized rebuilding the local test databases. Their
  allowlisted names and safety markers were rechecked before running the existing
  integration and E2E setup with Prisma's documented consent mechanism.
- Regression proof: the original implementation failed 6 focused cases, including
  actual OAuth callbacks returning 500 and a general username being overwritten.
  Restoring the fix passed all 66 tests across `course-roster`, `account-edit`, and
  `auth-username-identity` integration suites.
- The OAuth linking test checks identity fields while allowing the existing
  account-security trigger to advance `securityGeneration`.
- Focused onboarding E2E passed in Chromium without retries: direct username
  setup, reserved-format and duplicate rejection, unchanged User identity, and
  activation of the original roster row with its existing grades preserved.
- Formal production data audit ran separately using read-only transactions; no
  production data was modified. No account identifiers are stored in this plan.
- The user authorized deployment. Rebase the isolated fix onto current main,
  require the release CI gates, then verify the exact source revision and repeat
  the production identity audit after rollout. Account ownership transfers remain
  dependent on confirmation that the accounts belong to the same person.
