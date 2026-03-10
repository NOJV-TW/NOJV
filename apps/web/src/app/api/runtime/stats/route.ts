import { NextResponse } from "next/server";

import { withAuth } from "@/lib/server/api-handler";
import { getRuntimeStats } from "@/lib/server/data-access";

export const GET = withAuth(async () => {
  return NextResponse.json(await getRuntimeStats());
});
