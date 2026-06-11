import { backfillParticipation } from "../../src/repositories/participation-mirror";

async function main(): Promise<void> {
  const result = await backfillParticipation();
  console.log(
    `[backfill-participation] mirrored rows — contest=${String(result.contest)} exam=${String(result.exam)} virtual=${String(result.virtual)}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error("[backfill-participation] failed", err);
    process.exit(1);
  });
