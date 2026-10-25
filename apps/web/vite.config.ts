import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { existsSync } from "node:fs";

import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { sveltekit, type Config } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type UserConfig } from "vite";

if (existsSync("../../.env")) {
  process.loadEnvFile("../../.env");
}

const allowedHostsEnv = process.env.ALLOWED_HOSTS?.trim();
const allowedHosts =
  allowedHostsEnv === "*"
    ? true
    : allowedHostsEnv
        ?.split(",")
        .map((host) => host.trim())
        .filter(Boolean);

export const svelteKitConfig: Config = {
  preprocess: vitePreprocess(),
  adapter: adapter(),
  csrf: {
    // Disables the framework origin check ("*" is the supported off switch).
    // Origin CSRF is enforced in hooks (enforceCsrf) instead, so the
    // credential-authenticated /api/registry/token endpoint can accept the
    // docker registry client's cross-origin OAuth2 form POST.
    trustedOrigins: ["*"],
  },
  csp: {
    mode: "auto",
    directives: {
      "default-src": ["self"],
      "script-src": ["self", "wasm-unsafe-eval", "https://www.googletagmanager.com"],
      "style-src": ["self", "unsafe-inline"],
      "img-src": [
        "self",
        "data:",
        "blob:",
        "https://avatars.githubusercontent.com",
        "https://*.google-analytics.com",
      ],
      "font-src": ["self", "data:"],
      "connect-src": [
        "self",
        "https://*.google-analytics.com",
        "https://*.analytics.google.com",
        "https://*.googletagmanager.com",
      ],
      "worker-src": ["self", "blob:"],
      "frame-ancestors": ["none"],
      "base-uri": ["self"],
      "object-src": ["none"],
      "form-action": ["self"],
    },
  },
};

const config: UserConfig = {
  ssr: {
    external: ["@grpc/grpc-js"],
  },
  plugins: [
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/lib/paraglide",
    }),
    tailwindcss(),
    sveltekit(svelteKitConfig),
  ],
};

if (allowedHosts) {
  config.server = { allowedHosts };
}

export default defineConfig(config);
