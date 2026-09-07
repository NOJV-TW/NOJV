# Member table and custom filter menus

## Scope

Follow the [frontend surface](../../architecture/FRONTEND.md) and [design rules](../../architecture/DESIGN.md). Align course members with the submissions table, remove the placeholder implementation note, and use existing Bits UI menus for list and chart filters.

## Inventory and decisions

- `TableSelectColumnFilter` serves submissions, live course submissions, admin reports, and course members. Replace its native overlay once for all callers.
- The contest scoreboard chart participant selector is the other native filtering control.
- Other native selects edit form values, permissions, or editor settings; they are outside the requested filter scope pending clarification.
- Keep filters accessible when no members match. Use a scrollable native table so mobile columns remain readable.

## Validation

- [x] Web typecheck, focused component tests, and teacher/student browser checks.
- [x] Desktop and mobile member-table inspection.
- [x] Final review and scoreboard chart selection (7 options, no native select).
- PR checks record CI and merge evidence for the final commit.
