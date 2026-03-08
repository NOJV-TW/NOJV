import {
  writeActorIdentityToSearchParams,
  type ActorIdentity,
  type AssessmentContext
} from "@nojv/domain";

const defaultWorkspaceAppUrl = "http://localhost:4173";
const supportedProtocols = new Set(["http:", "https:"]);

interface WorkspaceLaunchContext {
  assessment?: AssessmentContext | undefined;
  actor?: ActorIdentity | undefined;
  contestSlug?: string | undefined;
}

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

export function resolveWorkspaceAppUrl(env: Record<string, string | undefined> = process.env) {
  return normalizeAbsoluteAppUrl(
    env.NEXT_PUBLIC_WORKSPACE_URL ?? defaultWorkspaceAppUrl,
    "NEXT_PUBLIC_WORKSPACE_URL"
  );
}

export function buildWorkspaceLaunchUrl(baseUrl: string, context: WorkspaceLaunchContext = {}) {
  const url = new URL(`${normalizeAbsoluteAppUrl(baseUrl, "workspace base URL")}/`);

  if (context.assessment) {
    url.searchParams.set("mode", context.assessment.kind);
    url.searchParams.set("course", context.assessment.courseSlug);
    url.searchParams.set("assessment", context.assessment.assessmentSlug);
  } else if (context.contestSlug) {
    url.searchParams.set("mode", "contest");
    url.searchParams.set("contest", context.contestSlug);
  }

  if (context.actor) {
    url.search = writeActorIdentityToSearchParams(url.searchParams, context.actor).toString();
  }

  return url.toString();
}
