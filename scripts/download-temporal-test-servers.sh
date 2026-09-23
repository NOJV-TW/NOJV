#!/usr/bin/env bash
set -euo pipefail

for attempt in 1 2 3 4 5; do
  if timeout 180 node --input-type=module -e '
    import { TestWorkflowEnvironment } from "@temporalio/testing";
    await (await TestWorkflowEnvironment.createLocal()).teardown();
    await (await TestWorkflowEnvironment.createTimeSkipping()).teardown();
  '; then
    exit 0
  fi
  rm -f "${TMPDIR:-/tmp}"/temporal-*sdk-typescript-*
  sleep $((attempt * 10))
done
exit 1
