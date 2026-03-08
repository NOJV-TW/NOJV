import { NextResponse } from "next/server";

import { getPocRuntimeStats } from "@/lib/server/poc-persistence";

export async function GET() {
  try {
    return NextResponse.json(await getPocRuntimeStats());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runtime stats query failed.";

    return NextResponse.json(
      {
        message
      },
      { status: 500 }
    );
  }
}
