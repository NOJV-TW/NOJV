# Shared tooling

This directory contains reusable workspace configuration packages:

- `eslint/` owns the shared ESLint rules; app-specific boundary rules stay with
  the app that owns those boundaries.
- `prettier/` owns shared formatting configuration.
- `typescript/` owns shared TypeScript compiler settings.

Root-level repository guards belong in `scripts/` and are wired through the
root `package.json`. Keep generated framework config in its owning app.
