import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile("../../.env");
} catch (_) {}

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  migrations: {
    path: "prisma/migrations",
  },
  schema: "prisma/schema",
});
