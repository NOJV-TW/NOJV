import type { RequestHandler } from "@sveltejs/kit";
import { toSvelteKitHandler } from "better-auth/svelte-kit";

import { getAuth } from "$lib/auth";

export const GET: RequestHandler = (event) => toSvelteKitHandler(getAuth())(event);

export const POST: RequestHandler = (event) => toSvelteKitHandler(getAuth())(event);
