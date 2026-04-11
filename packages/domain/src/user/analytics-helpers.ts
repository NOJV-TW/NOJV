export interface TagAcCount {
  tag: string;
  acCount: number;
}

interface AcRow {
  problem: { tags: string[] };
}

const MAX_TAGS = 8;

/**
 * Count AC problems per topic tag. One AC problem contributes +1 to every
 * tag it carries. Result is sorted descending by count and capped at 8 entries
 * so the dashboard tag bar chart stays legible.
 */
export function aggregateByTag(rows: readonly AcRow[]): TagAcCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.problem.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, acCount]) => ({ tag, acCount }))
    .sort((a, b) => b.acCount - a.acCount)
    .slice(0, MAX_TAGS);
}
