import { auth } from "$lib/auth";
import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = async (event) => auth.handler(event.request);

export const POST: RequestHandler = async (event) => auth.handler(event.request);
