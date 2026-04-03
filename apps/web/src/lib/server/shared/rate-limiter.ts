import { fail } from "@sveltejs/kit";
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";

// General API rate limiter: 60 requests per minute per IP
export const apiRateLimiter = new RateLimiterMemory({
  points: 60,
  duration: 60
});

// Stricter limiter for write API endpoints (POST): 10 requests per minute per IP
export const writeApiRateLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60
});

// Form action rate limiter: 20 requests per minute per IP
const formActionRateLimiter = new RateLimiterMemory({
  points: 20,
  duration: 60
});

/**
 * Consume a form action rate limit token. Returns a SvelteKit fail(429) if exceeded.
 * Usage: `const limited = await consumeFormRateLimit(event); if (limited) return limited;`
 */
export async function consumeFormRateLimit(event: {
  getClientAddress: () => string;
}): Promise<ReturnType<typeof fail<{ error: string }>> | null> {
  try {
    await formActionRateLimiter.consume(event.getClientAddress());
    return null;
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      return fail(429, { error: "Too many requests. Please try again later." });
    }
    throw err;
  }
}
