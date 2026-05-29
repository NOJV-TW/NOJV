import type { PageServerLoad } from "./$types";
import { problemDomain } from "@nojv/domain";
import { problemTypeSchema, judgeTypeSchema } from "@nojv/core";
import { isAdvancedModeSupported } from "$lib/server/execution-backend";

const { listEditableProblems, listProblemCards } = problemDomain;

const STATUS_VALUES = ["solved", "attempted", "untried", "bookmarked"] as const;
type StatusFilter = (typeof STATUS_VALUES)[number];

function parseEnumCsv<T>(
  raw: string | null,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
): T[] | undefined {
  if (!raw) return undefined;
  const values = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  const parsed = values
    .map((v) => schema.safeParse(v))
    .filter((r) => r.success)
    .map((r) => r.data as T);
  return parsed.length > 0 ? parsed : undefined;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const userId = locals.user?.id ?? null;

  const q = url.searchParams.get("q") ?? undefined;
  const difficulty = url.searchParams.get("difficulty") ?? undefined;
  const tagsParam = url.searchParams.get("tags");
  const tags = tagsParam ? tagsParam.split(",").filter(Boolean) : undefined;
  const types = parseEnumCsv(url.searchParams.get("types"), problemTypeSchema);
  const judgeMethods = parseEnumCsv(url.searchParams.get("judge"), judgeTypeSchema);
  const statusParam = url.searchParams.get("status");
  const status = STATUS_VALUES.includes(statusParam as StatusFilter)
    ? (statusParam as StatusFilter)
    : undefined;
  const pageParam = url.searchParams.get("page");
  const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1;
  const sort = url.searchParams.get("sort") === "desc" ? "desc" : "asc";

  const [publicResult, editableProblems] = await Promise.all([
    listProblemCards({ difficulty, judgeMethods, page, q, sort, status, tags, types, userId }),
    userId ? listEditableProblems(userId, sort) : Promise.resolve(null),
  ]);

  const sessionUser = locals.sessionUser;
  const canCreate =
    !!sessionUser && (sessionUser.platformRole !== "student" || sessionUser.emailVerified);

  return {
    editableProblems,
    publicResult,
    canCreate,
    loggedIn: userId !== null,
    advancedModeSupported: isAdvancedModeSupported(),
  };
};
