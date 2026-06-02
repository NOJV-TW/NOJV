import { describe, expect, it } from "vitest";
import { aggregateByTag } from "@nojv/domain";

describe("aggregateByTag", () => {
  it("returns an empty array when there are no AC rows", () => {
    expect(aggregateByTag([])).toEqual([]);
  });

  it("counts each tag once per AC problem", () => {
    const rows = [
      { problem: { tags: ["dp", "graph"] } },
      { problem: { tags: ["dp", "math"] } },
      { problem: { tags: ["graph"] } },
    ];
    const result = aggregateByTag(rows);
    expect(result).toEqual([
      { tag: "dp", acCount: 2 },
      { tag: "graph", acCount: 2 },
      { tag: "math", acCount: 1 },
    ]);
  });

  it("sorts descending by acCount and caps at 8 tags", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      problem: { tags: [`tag${i}`] },
    }));
    rows.push({ problem: { tags: ["tag0"] } }, { problem: { tags: ["tag0"] } });

    const result = aggregateByTag(rows);
    expect(result).toHaveLength(8);
    expect(result[0]).toEqual({ tag: "tag0", acCount: 3 });
    for (let i = 1; i < result.length; i++) {
      expect(result[i].acCount).toBe(1);
    }
  });

  it("ignores problems with an empty tag list", () => {
    const rows = [{ problem: { tags: [] } }, { problem: { tags: ["dp"] } }];
    expect(aggregateByTag(rows)).toEqual([{ tag: "dp", acCount: 1 }]);
  });

  it("breaks count ties deterministically so repeated calls yield stable ordering", () => {
    const rows = [
      { problem: { tags: ["alpha"] } },
      { problem: { tags: ["beta"] } },
      { problem: { tags: ["gamma"] } },
    ];
    const first = aggregateByTag(rows);
    const second = aggregateByTag(rows);
    const third = aggregateByTag([...rows].reverse());
    expect(first).toEqual(second);
    expect(first.map((r) => r.tag)).toEqual(third.map((r) => r.tag));
  });
});
