# Documentation agent guide

Read the [authoring standards](README.md#authoring-standards) and choose the owning document using the [documentation map](README.md). These standards also apply to Markdown outside this directory, as directed by the root guide.

## Editing workflow

- Check current source and tests before describing behavior. Use the owning document for the complete contract and link to it from summaries.
- Choose sections for the reader's task and document type; do not add empty template headings or split cohesive material for line count.
- Keep current behavior in living docs, rationale in decisions and in-flight work in `superpowers/`. Follow the root [planning rules](../AGENTS.md#planning-and-decisions) when shipping a change.
- Update incoming links when moving or deleting a document. New agent guides supplement ancestor instructions and apply only to their subtree.
- Edit the source of generated documentation and run its generator. For the database reference, use `pnpm db:docs` after updating the schema.
- Verify commands, working directories and prerequisites. State verification limits rather than treating example commands as executed evidence.

## Verify

From the repository root:

```bash
pnpm exec vitest run --project unit tests/unit/docs/
pnpm lint:doc-drift
```

Run Prettier on the changed Markdown files. The link guard checks local file targets; manually verify changed heading anchors and external sources. For diagrams, inspect their rendering. A passing link check does not establish factual correctness.
