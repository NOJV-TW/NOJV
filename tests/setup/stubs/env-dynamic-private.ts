export const env: Record<string, string | undefined> = {
  ...process.env,
  NODE_ENV: "test",
};
