import { cheatingSignalSchema, evaluateIntegritySignals } from "@nojv/domain";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withAuth } from "@/lib/server/api-handler";
import { persistCheatingSignals } from "@/lib/server/poc-persistence";
import { bufferCheatingSignals } from "@/lib/server/queue";

const cheatingSignalBatchSchema = z.array(cheatingSignalSchema).min(1);

export const POST = withAuth(async (request, _actor) => {
  const payload: unknown = await request.json();
  const batchedPayload = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && "signals" in payload
      ? (payload as { signals: unknown }).signals
      : [payload];
  const signals = cheatingSignalBatchSchema.parse(batchedPayload);

  await bufferCheatingSignals(signals);
  await persistCheatingSignals(signals);

  return NextResponse.json(evaluateIntegritySignals(signals));
});
