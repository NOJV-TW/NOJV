import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      $lib: "src/lib",
    },
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
        "script-src": ["self"],
        "style-src": ["self", "unsafe-inline"],
        "img-src": ["self", "data:", "blob:"],
        "font-src": ["self", "data:"],
        "connect-src": ["self"],
        "worker-src": ["self", "blob:"],
        "frame-ancestors": ["none"],
        "base-uri": ["self"],
        "object-src": ["none"],
        "form-action": ["self"],
      },
    },
  },
};

export default config;
