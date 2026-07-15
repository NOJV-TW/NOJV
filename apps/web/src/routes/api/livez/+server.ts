import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () => {
  return json({ alive: true }, { headers: { "cache-control": "no-store" } });
};
