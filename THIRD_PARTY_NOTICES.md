# Third-Party Notices

This file lists third-party software vendored into the NOJV repository.
For dependencies installed via package managers (`pnpm`, `apk`, etc.),
see the respective lockfiles and base image inventories instead.

## testlib.h

Source: https://github.com/MikeMirzayanov/testlib
Commit: 1e4e8a24c79c6bad3becbdb5a332ffc352b7d5dd
License: MIT
Copyright (c) 2015 Mike Mirzayanov

Bundled at `apps/sandbox-runner/assets/testlib/`. See that directory's
`LICENSE` file for the full text. The sandbox image installs the header
to `/usr/include/testlib.h` so that C++ checkers and interactors can
`#include "testlib.h"` directly.
