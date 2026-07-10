const HTTP_METHODS = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
]);

const TOKEN_WHITELISTED_OPERATIONS = new Set(["GET /api/admin/healthz"]);

const READ_METHODS = new Set(["get", "head", "options"]);

type PathItem = Record<string, unknown>;
type PathsObject = Record<string, PathItem>;

function inferScope(tags: readonly string[] | undefined, method: string): string | null {
  const tag = tags?.[0];
  const isRead = READ_METHODS.has(method);

  switch (tag) {
    case "System":
      return "admin:read";
    case "Account":
      return isRead ? "profile:read" : "profile:write";
    case "Problems Management":
      return isRead ? "problems:read" : "problems:write";
    case "Submissions":
      return isRead ? "submissions:read" : "submissions:write";
    case "Rejudge":
      return "rejudge:write";
    case "Contests":
      return isRead ? "contests:read" : "contests:write";
    case "Exams / Proctoring":
      return isRead ? "exams:read" : "exams:write";
    case "Clarifications":
      return isRead ? "clarifications:read" : "clarifications:write";
    case "Notifications":
      return isRead ? "notifications:read" : "notifications:write";
    case "Editorials":
      return isRead ? "editorials:read" : "editorials:write";
    case "Plagiarism":
      return isRead ? "plagiarism:read" : "plagiarism:write";
    case "Grading":
      return isRead ? "grading:read" : "grading:write";
    case "Uploads":
      return "uploads:write";
    case "Events":
      return "events:read";
    default:
      return null;
  }
}

function appendAuthNote(description: unknown, enabled: boolean, requiredScope: string | null) {
  const base = typeof description === "string" ? description : "";
  const note = enabled
    ? `Bearer API token access is enabled for this endpoint. Required scope: ${requiredScope ?? "none"}.`
    : `Bearer API token access is documented for future support but is not currently allowlisted for this endpoint. Planned scope: ${requiredScope ?? "none"}.`;

  return base ? `${base}\n\n${note}` : note;
}

export function withInternalAuthMetadata<TPaths extends PathsObject>(paths: TPaths): TPaths {
  return Object.fromEntries(
    Object.entries(paths).map(([path, pathItem]) => [
      path,
      Object.fromEntries(
        Object.entries(pathItem).map(([method, operation]) => {
          if (
            !HTTP_METHODS.has(method) ||
            typeof operation !== "object" ||
            operation === null
          ) {
            return [method, operation];
          }

          const operationObject = operation as Record<string, unknown>;
          const methodKey = method.toUpperCase();
          const enabled = TOKEN_WHITELISTED_OPERATIONS.has(`${methodKey} ${path}`);
          const requiredScope = inferScope(
            operationObject.tags as string[] | undefined,
            method,
          );

          return [
            method,
            {
              ...operationObject,
              description: appendAuthNote(operationObject.description, enabled, requiredScope),
              ...(enabled && !operationObject.security ? { security: [{ ApiToken: [] }] } : {}),
              "x-browser-session-auth": {
                required: true,
                csrfHeaderRequired: !READ_METHODS.has(method),
              },
              "x-api-token-access": {
                enabled,
                requiredScope,
                visibility: "internal",
                whitelistStatus: enabled ? "enabled" : "not_allowlisted",
              },
            },
          ];
        }),
      ),
    ]),
  ) as TPaths;
}
