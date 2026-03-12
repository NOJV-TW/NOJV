import { RateLimiterMemory } from "rate-limiter-flexible";

// General API rate limiter: 60 requests per minute per IP
export const apiRateLimiter = new RateLimiterMemory({
  points: 60,
  duration: 60
});

// Submission rate limiter: 10 submissions per minute per user
export const submissionRateLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60
});

// Auth rate limiter: 5 login attempts per minute per IP
export const authRateLimiter = new RateLimiterMemory({
  points: 5,
  duration: 60
});
