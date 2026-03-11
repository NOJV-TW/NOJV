import { cheatingSignalSchema, evaluateIntegritySignals } from "@nojv/domain";
import { json } from "@sveltejs/kit";
import { z } from "zod";

import { withAuth } from "$lib/server/api-handler";
import { persistCheatingSignals } from "$lib/server/data-access/integrity";
import { bufferCheatingSignals } from "$lib/server/queue";

const cheatingSignalBatchSchema = z.array(cheatingSignalSchema).min(1);

export const POST = withAuth(async (event) => {
  const payload: unknown = await event.request.json();
  const batchedPayload = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && "signals" in payload
      ? (payload as { signals: unknown }).signals
      : [payload];
  const signals = cheatingSignalBatchSchema.parse(batchedPayload);

  await Promise.all([bufferCheatingSignals(signals), persistCheatingSignals(signals)]);

  return json(evaluateIntegritySignals(signals));
});
