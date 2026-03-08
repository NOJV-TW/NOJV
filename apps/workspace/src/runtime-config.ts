const defaultWebAppOrigin = "http://localhost:3000";
const supportedProtocols = new Set(["http:", "https:"]);

type WorkspaceEnv = Record<string, string | undefined>;

function normalizeAbsoluteAppUrl(rawValue: string, label: string) {
  let url: URL;

  try {
    url = new URL(rawValue);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }

  if (!supportedProtocols.has(url.protocol)) {
    throw new Error(`${label} must use http or https.`);
  }

  url.hash = "";
  url.search = "";

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString().replace(/\/$/, "");
}

export function resolveWebAppOrigin(env: WorkspaceEnv) {
  return normalizeAbsoluteAppUrl(
    env.VITE_NOJV_WEB_ORIGIN ?? defaultWebAppOrigin,
    "VITE_NOJV_WEB_ORIGIN"
  );
}
