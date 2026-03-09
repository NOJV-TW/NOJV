import { NextResponse } from "next/server";

import { getActorContext } from "@/lib/server/actor-context";
import { getPocRuntimeStats } from "@/lib/server/poc-persistence";

export async function GET(request: Request) {
  try {
    const actor = await getActorContext(request);

    if (!actor) {
      return NextResponse.json({ message: "Authentication required." }, { status: 401 });
    }

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
