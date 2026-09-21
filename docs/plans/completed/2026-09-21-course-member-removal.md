# Course member removal

## Scope and policy

Investigate reported teacher/TA removal failures in an isolated worktree. The user
confirmed that TAs may remove students but may neither remove TAs nor promote
students to TA. Teacher/admin protections and durable roster/grading identities
remain governed by [Security](../../operations/SECURITY.md) and
[Database Schema](../../architecture/DATABASE.md#course-roster-and-grading-subjects).

## Findings

- Baseline `origin/main` at `48b179e7` exposed removal and role controls to TAs
  through `isManager`, while the page action and domain transaction denied removal.
- SvelteKit returns action failures such as `{ type: "failure", status: 403 }`
  with HTTP 200. Checking only `res.ok` silently treated denied removal as success.
- Before policy changes, actual course teachers successfully removed all four
  combinations of linked/pending students/TAs. The reported teacher failure is
  not reproduced; course URL and actual course role remain unknown. A platform
  teacher with course TA membership was denied just like any other course TA.

## Changes

- Parse the removal action response with SvelteKit `deserialize` and refresh only
  after success; surface unsuccessful responses through the existing error toast.
- Allow active TAs through the remove action and authorize only student targets
  inside the locked domain transaction. Preserve owner, teacher, inactive actor,
  and cross-course protections. Role and username changes remain teacher/admin-only.
- Return per-member removal permission and a role-management permission from the
  loader. Hide removal controls for staff rows and all role-changing controls from
  TAs, including the bulk-add TA option. Direct requests remain server-validated.
- Add unit, component, and browser coverage for the policy and response handling.

## Validation

- [x] Unit baseline: 40 tests passed before changes.
- [x] Failure reproduced: TA removal of linked and pending students failed before
      changing authorization; 45 authorization unit tests now pass.
- [x] Silent failure reproduced: HTTP-200/action-failure did not show an error;
      both component cases now pass after parsing the action result.
- [x] Five browser cases passed, including the TA policy and all four teacher cases.
- [x] Web/application and test TypeScript checks passed; Svelte reported zero errors/warnings.
- [x] Changed production files passed ESLint; documentation drift and formatting checks passed.

Implementation is complete; deployment is outside this change.

Browser checks use the existing safety-marked local `nojv_e2e_test` database and
clean up only test-owned fixtures. The normal global setup requires Prisma consent
for `db push --force-reset`; it was not run. The local `.tmp/removal.config.ts`
and `.tmp/removal-setup.ts` preserve the non-resetting test setup. The browser suite
checks TA removal of linked/pending students, hidden controls, direct removal of
staff/self, direct promotion and bulk-add TA requests, and four teacher cases.
