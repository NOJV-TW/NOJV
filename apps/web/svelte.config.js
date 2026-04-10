import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      $lib: "src/lib"
    },
    // Content Security Policy. SvelteKit generates a per-request nonce and
    // substitutes it into `app.html` (the inline theme-bootstrap script uses
    // `nonce="%sveltekit.nonce%"`), so no inline scripts need `unsafe-inline`.
    //
    // `'unsafe-eval'` on script-src is required by Monaco Editor — it uses
    // `new Function` for language-service internals. Without it the editor
    // crashes on problem edit pages. This is a pragmatic trade-off: the rest
    // of the directives stay strict.
    //
    // `'unsafe-inline'` on style-src is required for Svelte's scoped-style
    // compiler and Tailwind's arbitrary-value injection. SvelteKit does not
    // currently rewrite style attributes through the nonce machinery.
    csp: {
      mode: "auto",
      directives: {
        "default-src": ["self"],
        "script-src": ["self", "unsafe-eval"],
        "style-src": ["self", "unsafe-inline"],
        "img-src": ["self", "data:", "blob:"],
        "font-src": ["self", "data:"],
        "connect-src": ["self"],
        "worker-src": ["self", "blob:"],
        "frame-ancestors": ["none"],
        "base-uri": ["self"],
        "object-src": ["none"],
        "form-action": ["self"]
      }
    }
  }
};

export default config;
