import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

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

export default defineConfig({
  server: allowedHosts ? { allowedHosts } : undefined,
  ssr: {
    // @grpc/grpc-js and the Temporal client rely on dynamic requires, proto
    // loading and Node http2 internals that break when bundled by Vite.
    // Keep them as external imports resolved at runtime.
    noExternal: [],
    external: ["@grpc/grpc-js", "@temporalio/client"]
  },
  plugins: [
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/lib/paraglide"
    }),
    tailwindcss(),
    sveltekit()
  ]
});
