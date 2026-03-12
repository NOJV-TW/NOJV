import { RateLimiterMemory } from "rate-limiter-flexible";

// General API rate limiter: 60 requests per minute per IP
export const apiRateLimiter = new RateLimiterMemory({
  points: 60,
  duration: 60
});
