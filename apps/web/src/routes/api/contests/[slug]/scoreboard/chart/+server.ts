import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { contestDomain } from "@nojv/domain";

const { getScoreboardChart } = contestDomain;
import { apiHandler } from "$lib/server/shared/api-handler";

export const GET: RequestHandler = apiHandler(async (event) => {
  const { slug } = event.params;
  if (!slug) return json({ message: "Missing contest slug." }, { status: 400 });

  const topN = Math.min(
    Math.max(1, parseInt(event.url.searchParams.get("topN") ?? "10", 10) || 10),
    50
  );

  const chart = await getScoreboardChart(slug, topN);

  return json(chart);
});
