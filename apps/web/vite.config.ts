import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

try {
  process.loadEnvFile("../../.env");
} catch {}

export default defineConfig({
  server: {
    allowedHosts: ["nojv.ntnu.cc"]
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
