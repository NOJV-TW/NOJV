import { NextResponse } from "next/server";

import { withAuth } from "@/lib/server/api-handler";
import { getPocRuntimeStats } from "@/lib/server/poc-persistence";

export const GET = withAuth(async (_request, _actor) => {
  return NextResponse.json(await getPocRuntimeStats());
});
