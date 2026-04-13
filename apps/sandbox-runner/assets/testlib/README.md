# testlib.h

Vendored copy of [Codeforces / Polygon `testlib.h`](https://github.com/MikeMirzayanov/testlib).
The sandbox image installs `testlib.h` to `/usr/include/testlib.h` so that
problem authors can `#include "testlib.h"` from C++ checkers and
interactors without configuring extra include paths.

- **Source:** https://github.com/MikeMirzayanov/testlib
- **Pinned commit:** `1e4e8a24c79c6bad3becbdb5a332ffc352b7d5dd`
- **License:** MIT (see `./LICENSE`)

## Update procedure

```bash
gh api repos/MikeMirzayanov/testlib/contents/testlib.h --jq '.content' \
  | base64 -d > apps/sandbox-runner/assets/testlib/testlib.h
gh api repos/MikeMirzayanov/testlib/contents/LICENSE --jq '.content' \
  | base64 -d > apps/sandbox-runner/assets/testlib/LICENSE
gh api repos/MikeMirzayanov/testlib/commits/master --jq .sha
```

Update the pinned commit SHA above with the new value, then update
`THIRD_PARTY_NOTICES.md` at the repo root.
