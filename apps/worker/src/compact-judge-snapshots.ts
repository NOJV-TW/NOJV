import { parseArgs } from "node:util";

import { submissionDomain } from "@nojv/application";
import { prismaAdapterClient } from "@nojv/db";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    limit: { type: "string", default: "1000" },
    "min-bytes": { type: "string", default: String(1024 * 1024) },
  },
});

const dryRun = values["dry-run"];
const ids = await submissionDomain.listCompactionCandidates({
  limit: Number(values.limit),
  minBytes: Number(values["min-bytes"]),
});
const totals = {
  executions: ids.length,
  compacted: 0,
  skipped: 0,
  failed: 0,
  freedBytes: 0,
  uploads: 0,
};
for (const executionId of ids) {
  try {
    const result = await submissionDomain.compactJudgeSnapshot(executionId, { dryRun });
    console.log(JSON.stringify({ executionId, ...result }));
    if ("freedBytes" in result) {
      totals.compacted += 1;
      totals.freedBytes += result.freedBytes;
      totals.uploads += result.uploads;
    } else totals.skipped += 1;
  } catch (error) {
    totals.failed += 1;
    console.log(JSON.stringify({ executionId, error: String(error) }));
  }
}
console.log(JSON.stringify({ dryRun, ...totals }));
await prismaAdapterClient.$disconnect();
process.exitCode = totals.failed > 0 ? 1 : 0;
