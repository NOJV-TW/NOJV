import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({
  NODE_ENV: { schema: (input: string | undefined) => input },
  DEV_ADMIN_MODE_USERNAME: { schema: (input: string | undefined) => input },
  DATABASE_URL: { schema: (input: string | undefined) => input },
  REDIS_URL: { schema: (input: string | undefined) => input },
  ADVANCED_IMAGE_ALLOWED_REGISTRIES: { schema: (input: string | undefined) => input },
  REGISTRY_PUBLIC_HOST: { schema: (input: string | undefined) => input },
  REGISTRY_INTERNAL_URL: { schema: (input: string | undefined) => input },
  REGISTRY_TOKEN_ISSUER: { schema: (input: string | undefined) => input },
  REGISTRY_TOKEN_PRIVATE_KEY: { schema: (input: string | undefined) => input },
  REGISTRY_TOKEN_CERT: { schema: (input: string | undefined) => input },
  REGISTRY_PULL_PASSWORD_HASH: { schema: (input: string | undefined) => input },
  BETTER_AUTH_SECRET: { schema: (input: string | undefined) => input },
  BETTER_AUTH_URL: { schema: (input: string | undefined) => input },
  GITHUB_CLIENT_ID: { schema: (input: string | undefined) => input },
  GITHUB_CLIENT_SECRET: { schema: (input: string | undefined) => input },
  GOOGLE_CLIENT_ID: { schema: (input: string | undefined) => input },
  GOOGLE_CLIENT_SECRET: { schema: (input: string | undefined) => input },

  PUBLIC_APP_VERSION: { public: true, schema: (input) => input ?? "" },
});
