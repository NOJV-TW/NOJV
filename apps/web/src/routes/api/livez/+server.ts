import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () => {
  return Response.json({ alive: true }, { headers: { "cache-control": "no-store" } });
};
