import { problemTypeSchema, judgeTypeSchema } from "@nojv/core";
import type { problemDomain } from "@nojv/application";

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

export function parseProblemListQuery(
  url: URL,
): Omit<problemDomain.ProblemListParams, "userId" | "pageSize"> {
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
  const page = pageParam ? Math.max(1, Number.parseInt(pageParam, 10) || 1) : 1;
  const sort = url.searchParams.get("sort") === "desc" ? ("desc" as const) : ("asc" as const);

  return { difficulty, judgeMethods, page, q, sort, status, tags, types };
}
