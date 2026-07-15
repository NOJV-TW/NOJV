import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { webIsReady } from "$lib/server/health-probes";

export const GET: RequestHandler = async () => {
  const ready = await webIsReady();
  return json(
    { ready },
    { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
};
