import { ScalarApiReference } from "@scalar/sveltekit";
import type { RequestHandler } from "./$types";

const LIGHT_MODE_CARD_CSS = `
body.light-mode .scalar-app .dark-mode {
  --scalar-background-1: #ffffff;
  --scalar-background-2: #f6f6f6;
  --scalar-background-3: #e7e7e7;
  --scalar-color-1: #1b1b1b;
  --scalar-color-2: #757575;
  --scalar-color-3: #8e8e8e;
  --scalar-border-color: #dfdfdf;
  color-scheme: light;
}
`;

const THEME_BRIDGE = `<script>
(() => {
  try {
    const siteThemeKey = "nojv-theme";
    const scalarThemeKey = "colorMode";
    const nativeSetItem = Storage.prototype.setItem;
    const isExplicitTheme = (value) => value === "light" || value === "dark";
    const write = (key, value) => nativeSetItem.call(localStorage, key, value);
    const resolveSiteTheme = () => {
      const stored = localStorage.getItem(siteThemeKey);
      if (isExplicitTheme(stored)) return stored;
      return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    };

    write(scalarThemeKey, resolveSiteTheme());
    Storage.prototype.setItem = function (key, value) {
      nativeSetItem.call(this, key, value);
      if (this === localStorage && key === scalarThemeKey && isExplicitTheme(value)) {
        nativeSetItem.call(this, siteThemeKey, value);
      }
    };

    addEventListener("storage", (event) => {
      if (event.key === siteThemeKey) {
        write(scalarThemeKey, resolveSiteTheme());
        location.reload();
      } else if (event.key === scalarThemeKey && isExplicitTheme(event.newValue)) {
        write(siteThemeKey, event.newValue);
        location.reload();
      }
    });

    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (localStorage.getItem(siteThemeKey) === "system") {
        write(scalarThemeKey, resolveSiteTheme());
        location.reload();
      }
    });
  } catch {
    // Scalar still owns its own theme if storage is unavailable.
  }
})();
</script>`;

const render = ScalarApiReference({
  sources: [
    {
      title: "API Token",
      slug: "token",
      url: "/api/openapi.public.json",
      default: true,
    },
    {
      title: "Full API",
      slug: "full",
      url: "/api/openapi.internal.json",
    },
  ],
  layout: "modern",
  theme: "bluePlanet",
  customCss: LIGHT_MODE_CARD_CSS,
  defaultHttpClient: {
    targetKey: "shell",
    clientKey: "curl",
  },
  documentDownloadType: "both",
  showSidebar: true,
  showOperationId: true,
  defaultOpenAllTags: true,
  hideTestRequestButton: true,
  metaData: {
    title: "NOJV API Docs",
    description: "API reference for NOJV",
  },
  agent: {
    disabled: true,
  },
});

export const GET: RequestHandler = async () => {
  const response = render();
  const html = (await response.text()).replace("<body>", `<body>${THEME_BRIDGE}`);

  return new Response(html, {
    status: response.status,
    headers: response.headers,
  });
};
