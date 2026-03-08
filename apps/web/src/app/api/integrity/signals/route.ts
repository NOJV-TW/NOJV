import { cheatingSignalSchema, evaluateIntegritySignals } from "@nojv/domain";
import { NextResponse } from "next/server";
import { ZodError, z } from "zod";

import { persistCheatingSignals } from "@/lib/server/poc-persistence";
import { bufferCheatingSignals } from "@/lib/server/queue";

const cheatingSignalBatchSchema = z.array(cheatingSignalSchema).min(1);

export async function POST(request: Request) {
  try {
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
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          issues: error.issues,
          message: "Invalid integrity signal payload."
        },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Integrity ingestion failed.";

    return NextResponse.json(
      {
        message
      },
      { status: 500 }
    );
  }
}
