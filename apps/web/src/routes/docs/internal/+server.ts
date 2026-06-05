import { ScalarApiReference } from "@scalar/sveltekit";
import type { RequestHandler } from "./$types";

const render = ScalarApiReference({
  url: "/api/openapi.internal.json",
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
    title: "NOJV Internal API Docs",
    description: "Internal API reference for NOJV maintainers",
  },
  agent: {
    disabled: true,
  },
});

export const GET: RequestHandler = () => {
  return render();
};
