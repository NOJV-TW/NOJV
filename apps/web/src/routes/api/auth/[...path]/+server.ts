import type { RequestHandler } from "@sveltejs/kit";
import { toSvelteKitHandler } from "better-auth/svelte-kit";

import { getAuth } from "$lib/auth";
import { createLogger } from "$lib/server/logger";

const logger = createLogger("auth-route");
const authHandler = toSvelteKitHandler(getAuth());

const handleAuth: RequestHandler = async (event) => {
	try {
		return await authHandler(event);
	} catch (error) {
		logger.error("Auth route failed", {
			error: error instanceof Error ? error.message : String(error),
			method: event.request.method,
			path: event.url.pathname,
			provider: event.url.pathname.split("/").at(-1) ?? null,
			query: event.url.searchParams.toString(),
			stack: error instanceof Error ? error.stack : undefined
		});
		throw error;
	}
};

export const GET: RequestHandler = handleAuth;

export const POST: RequestHandler = handleAuth;
