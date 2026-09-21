import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { getTemporalClient, closeTemporalClient } from "../packages/temporal/src/client.js";
import type { Client } from "@temporalio/client";

export interface JudgeReleaseState {
  paused: boolean;
  quotaReady: boolean;
  dispatchRoute?: "legacy" | "capacity" | "hold";
  draining?: boolean;
  routingInFlight?: number;
  activeSubmissionIds?: string[];
  activeRejudgeIds?: string[];
  stagedWorkflowIds?: string[];
  admission: { permits: { cleanupConfirmed: boolean }[]; pending: unknown[] };
}

export function rollbackStateBlockers(state: JudgeReleaseState): string[] {
  const blockers: string[] = [];
  if (state.dispatchRoute !== "legacy" || state.draining !== true)
    blockers.push("Dispatch must route to legacy with draining enabled");
  if (state.routingInFlight !== 0)
    blockers.push("Dispatch updates remain in flight or state is unknown");
  if (!state.activeRejudgeIds || state.activeRejudgeIds.length > 0)
    blockers.push("Active rejudge batches remain or state is unknown");
  if (!state.activeSubmissionIds || state.activeSubmissionIds.length > 0)
    blockers.push("Active staged submissions remain or state is unknown");
  if (!state.stagedWorkflowIds) blockers.push("Staged workflow ledger is unavailable");
  if (state.admission.permits.some((permit) => !permit.cleanupConfirmed))
    blockers.push("Sandbox permits have not confirmed cleanup");
  if (state.admission.pending.length > 0) blockers.push("Admission requests remain queued");
  return blockers;
}

export async function verifyJudgeRollbackReady(client: Client) {
  const coordinator = client.workflow.getHandle("judge-admission-v1");
  const before = await coordinator.query<JudgeReleaseState>("admissionState");
  const blockers = rollbackStateBlockers(before);
  const ids = new Set(before.stagedWorkflowIds ?? []);
  for await (const execution of client.workflow.list({
    query: 'TaskQueue = "judge-capacity-v1" AND ExecutionStatus = "Running"',
  }))
    ids.add(execution.workflowId);
  const redirected: string[] = [];
  for (const workflowId of ids) {
    const description = await client.workflow.getHandle(workflowId).describe();
    if (description.status.name !== "RUNNING") continue;
    if (description.taskQueue !== "judge") {
      blockers.push(`Candidate workflow still running: ${workflowId}`);
      continue;
    }
    const history = await client.workflow
      .getHandle(workflowId, description.runId)
      .fetchHistory();
    const started = history.events?.[0]?.workflowExecutionStartedEventAttributes;
    if (
      !started?.continuedExecutionRunId ||
      history.events?.some(
        (event) =>
          event.workflowTaskStartedEventAttributes ||
          event.workflowTaskCompletedEventAttributes,
      )
    ) {
      blockers.push(`Legacy destination is not an untouched continuation: ${workflowId}`);
      continue;
    }
    redirected.push(workflowId);
  }
  const after = await coordinator.query<JudgeReleaseState>("admissionState");
  blockers.push(...rollbackStateBlockers(after));
  if (JSON.stringify(before.stagedWorkflowIds) !== JSON.stringify(after.stagedWorkflowIds))
    blockers.push("Workflow ledger changed during verification; retry verification");
  return { ready: blockers.length === 0, blockers: [...new Set(blockers)], redirected };
}

async function main() {
  const { values } = parseArgs({ options: { command: { type: "string" } }, strict: true });
  const command = values.command;
  if (
    !command ||
    ![
      "status",
      "hold",
      "route-capacity",
      "begin-rollback",
      "verify-rollback",
      "finish-rollback",
    ].includes(command)
  )
    throw new Error(
      "Use --command status|hold|route-capacity|begin-rollback|verify-rollback|finish-rollback",
    );
  const client = await getTemporalClient();
  try {
    const coordinator = client.workflow.getHandle("judge-admission-v1");
    if (command === "hold" || command === "route-capacity" || command === "begin-rollback") {
      await coordinator.executeUpdate("configureJudgeDispatch", {
        args: [
          {
            route:
              command === "hold"
                ? "hold"
                : command === "route-capacity"
                  ? "capacity"
                  : "legacy",
            draining: command !== "route-capacity",
          },
        ],
      });
    }
    if (command === "finish-rollback") {
      const result = await verifyJudgeRollbackReady(client);
      if (!result.ready) throw new Error(result.blockers.join("; "));
      await coordinator.executeUpdate("relinquishJudgeQuota", { args: [] });
    }
    if (command === "verify-rollback") {
      const result = await verifyJudgeRollbackReady(client);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.ready) process.exitCode = 1;
    } else {
      process.stdout.write(
        `${JSON.stringify(await coordinator.query("admissionState"), null, 2)}\n`,
      );
    }
  } finally {
    await closeTemporalClient();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
