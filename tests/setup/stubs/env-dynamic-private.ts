export const env: Record<string, string | undefined> = {
  ...process.env,
  NODE_ENV: "test",
  BETTER_AUTH_SECRET: "nojv-integration-test-better-auth-secret-0123456789",
};
