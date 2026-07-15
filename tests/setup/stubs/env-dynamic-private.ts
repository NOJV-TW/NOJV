export const env: Record<string, string | undefined> = {
  ...process.env,
  APP_BASE_URL: "http://localhost:5173",
  MAILER_MODE: "sink",
  NODE_ENV: "test",
  BETTER_AUTH_SECRET: "nojv-integration-test-better-auth-secret-0123456789",
};
