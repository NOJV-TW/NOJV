import { describe, expect, it } from "vitest";

import {
  ariaSort,
  sortDirection,
  sortRows,
  toggleSort,
  type TableSort,
} from "$lib/utils/table-sort";

describe("table sort", () => {
  it("flips the active column and starts a new column descending", () => {
    const desc: TableSort = { key: "joined", direction: "desc" };
    const asc: TableSort = { key: "joined", direction: "asc" };
    expect(toggleSort(desc, "joined")).toEqual({ key: "joined", direction: "asc" });
    expect(toggleSort(asc, "joined")).toEqual({ key: "joined", direction: "desc" });
    expect(toggleSort(asc, "score")).toEqual({ key: "score", direction: "desc" });
  });

  it("reports the direction only for the active column", () => {
    const sort: TableSort = { key: "joined", direction: "asc" };
    expect(sortDirection(sort, "joined")).toBe("asc");
    expect(sortDirection(sort, "score")).toBeNull();
    expect(ariaSort("asc")).toBe("ascending");
    expect(ariaSort("desc")).toBe("descending");
    expect(ariaSort(null)).toBe("none");
  });

  it("sorts a copy stably in both directions", () => {
    const rows = [
      { id: "a", n: 2 },
      { id: "b", n: 1 },
      { id: "c", n: 2 },
    ];
    expect(sortRows(rows, "asc", (row) => row.n).map((row) => row.id)).toEqual(["b", "a", "c"]);
    expect(sortRows(rows, "desc", (row) => row.n).map((row) => row.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });
});
