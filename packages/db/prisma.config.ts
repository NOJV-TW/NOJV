import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile("../../.env");
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  migrations: {
    path: process.env.PRISMA_MIGRATIONS_PATH ?? "prisma/migrations",
  },
  schema: "prisma/schema",
});
