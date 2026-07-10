import { ScalarApiReference } from "@scalar/sveltekit";
import type { RequestHandler } from "./$types";

const render = ScalarApiReference({
  sources: [
    {
      title: "Stable API",
      slug: "stable",
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

export const GET: RequestHandler = () => {
  return render();
};
