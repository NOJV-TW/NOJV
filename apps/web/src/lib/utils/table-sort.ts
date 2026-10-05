export type SortDirection = "asc" | "desc";

export interface TableSort<K extends string = string> {
  key: K;
  direction: SortDirection;
}

export function toggleSort<K extends string>(sort: TableSort<K>, key: K): TableSort<K> {
  if (sort.key !== key) return { key, direction: "desc" };
  return { key, direction: sort.direction === "desc" ? "asc" : "desc" };
}

export function sortDirection<K extends string>(
  sort: TableSort<K>,
  key: K,
): SortDirection | null {
  return sort.key === key ? sort.direction : null;
}

export function ariaSort(
  direction: SortDirection | null,
): "ascending" | "descending" | undefined {
  if (direction === "asc") return "ascending";
  return direction === "desc" ? "descending" : undefined;
}

export function sortRows<T>(
  rows: readonly T[],
  direction: SortDirection,
  value: (row: T) => number | string,
): T[] {
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    return left < right ? -sign : left > right ? sign : 0;
  });
}
