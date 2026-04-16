import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { contestDomain } from "@nojv/domain";

const { getScoreboardChart } = contestDomain;
import { apiHandler } from "$lib/server/shared/api-handler";

export const GET: RequestHandler = apiHandler(async (event) => {
  const { contestId } = event.params;
  if (!contestId) return json({ message: "Missing contest id." }, { status: 400 });

  const topN = Math.min(
    Math.max(1, parseInt(event.url.searchParams.get("topN") ?? "10", 10) || 10),
    50
  );

  const chart = await getScoreboardChart(contestId, topN);

  return json(chart);
});
