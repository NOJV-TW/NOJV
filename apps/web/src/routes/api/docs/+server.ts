import { ScalarApiReference } from "@scalar/sveltekit";
import type { RequestHandler } from "./$types";

const render = ScalarApiReference({
  url: "/api/openapi.json",
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
    description: "Public API reference for NOJV external clients",
  },
  agent: {
    disabled: true,
  },
});

export const GET: RequestHandler = () => {
  return render();
};
