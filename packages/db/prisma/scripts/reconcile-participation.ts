import { reconcileParticipation } from "../../src/repositories/participation-mirror";

async function main(): Promise<void> {
  const report = await reconcileParticipation();
  console.log("[reconcile-participation]", JSON.stringify(report, null, 2));
  if (!report.ok) {
    console.error(
      "[reconcile-participation] DRIFT DETECTED — run backfill:participation first",
    );
    process.exit(2);
  }
  console.log("[reconcile-participation] mirror matches legacy tables ✓");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[reconcile-participation] failed", err);
    process.exit(1);
  });
