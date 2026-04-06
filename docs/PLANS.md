# Planning System

Use execution plans for work that spans multiple decisions, checkpoints, or follow-up tasks.

## Plan Locations

- Active plans live in [plans/active/](plans/active/).
- Completed plans live in [plans/completed/](plans/completed/).

## Naming And Lifecycle

- Name plan files `YYYY-MM-DD-short-topic.md` so agents can sort them chronologically.
- Start in `plans/active/` when work needs explicit coordination or staged validation.
- Move the file to `plans/completed/` once the work is shipped or explicitly abandoned.

## Expectations

- Plans should record the problem, constraints, concrete milestones, and unresolved risks.
- Plans should link to the living docs they depend on instead of repeating them.
- If implementation changes invalidate a plan assumption, update the plan or close it immediately.

## Related Docs

- [Quality Ledger](QUALITY_SCORE.md)
- [Architecture Overview](../ARCHITECTURE.md)
