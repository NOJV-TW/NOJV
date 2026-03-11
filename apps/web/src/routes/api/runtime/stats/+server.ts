import { json } from "@sveltejs/kit";

import { withAuth } from "$lib/server/api-handler";
import { getRuntimeStats } from "$lib/server/data-access/shared";

export const GET = withAuth(async () => {
  return json(await getRuntimeStats());
});
