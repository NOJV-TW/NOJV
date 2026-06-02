import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type UserConfig } from "vite";

try {
  process.loadEnvFile("../../.env");
} catch {}

const allowedHostsEnv = process.env.ALLOWED_HOSTS?.trim();
const allowedHosts =
  allowedHostsEnv === "*"
    ? true
    : allowedHostsEnv
        ?.split(",")
        .map((host) => host.trim())
        .filter(Boolean);

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
    sveltekit(),
  ],
};

if (allowedHosts) {
  config.server = { allowedHosts };
}

export default defineConfig(config);
