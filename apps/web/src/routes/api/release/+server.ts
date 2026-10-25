import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () => {
  return Response.json(
    {
      version: process.env.NOJV_RELEASE_VERSION ?? "dev",
      sourceSha: process.env.NOJV_RELEASE_SOURCE_SHA ?? "unknown",
    },
    { headers: { "cache-control": "no-store" } },
  );
};
