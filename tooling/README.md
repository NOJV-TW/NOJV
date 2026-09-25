# Shared tooling

Reusable workspace configuration packages:

| Package                   | Directory     | Owns                                                                                  |
| ------------------------- | ------------- | ------------------------------------------------------------------------------------- |
| `@nojv/eslint-config`     | `eslint/`     | Shared ESLint 9 flat config (`base.mjs`); app-specific boundary rules stay in the app |
| `@nojv/prettier-config`   | `prettier/`   | Shared Prettier config (`base.mjs`)                                                   |
| `@nojv/typescript-config` | `typescript/` | Shared compiler settings (`base.json`)                                                |

Repository guards (`lint:repo`: query returns, retired colors, doc drift,
migrations, comments, supply chain) live in `scripts/` and are wired through the
root `package.json`. Generated framework config stays in its owning app.
