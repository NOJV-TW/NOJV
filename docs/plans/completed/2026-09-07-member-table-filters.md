# Member table and custom filter menus

## Scope

Follow the [frontend surface](../../architecture/FRONTEND.md) and [design rules](../../architecture/DESIGN.md). Align course members with the submissions table, remove the placeholder implementation note, and use existing Bits UI menus for list and chart filters.

## Inventory and decisions

- `TableSelectColumnFilter` serves submissions, live course submissions, admin reports, and course members. Replace its native overlay once for all callers.
- The contest scoreboard chart participant selector is the other native filtering control.
- Follow-up audit covered all 22 tables in 20 components/pages. The three remaining native row editors (member role, platform role, advanced creation permission) now use custom Select menus; non-table form and editor settings remain outside this scope.
- Keep filters accessible when no members match. Use a scrollable native table so mobile columns remain readable.

## Validation

- [x] Web typecheck, focused component tests, and teacher/student browser checks.
- [x] Desktop and mobile member-table inspection.
- [x] Final review and scoreboard chart selection (7 options, no native select).
- PR checks record CI and merge evidence for the final commit.

## Table audit follow-up

- Preserve privileged-role confirmation and reset custom row selections on cancellation or rejected actions.
- Use the Bits UI Dialog.Close path so the shared confirmation cancel button invokes the caller cleanup.
- Browser tests intercept rejected writes and verify rollback without changing account data.
