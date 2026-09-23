<script lang="ts" module>
  export type MatrixCellState = "ac" | "partial" | "zero" | "empty";

  export interface MatrixProblemColumn {
    problemId: string;
    letter: string;
    ordinal: number;
    title: string;
    points: number;
  }

  export interface MatrixCell {
    problemId: string;
    score: number | null;
    attempts: number;
    state: MatrixCellState;
    practiceScore: number | null;
    practiceAttempts: number;
  }

  export interface MatrixRow {
    rowId: string;
    courseMembershipId: string | null;
    userId: string | null;
    displayName: string;
    handle: string;
    cells: MatrixCell[];
    total: number;
  }

  export interface MatrixViewData {
    problems: MatrixProblemColumn[];
    rows: MatrixRow[];
    totalPoints: number;
    studentCount: number;
  }

  export interface MatrixViewLabels {
    heading: () => string;
    hint: () => string;
    meta: (args: { students: number; problems: number; total: number }) => string;
    student: () => string;
    total: () => string;
    maxPoints: (args: { points: number }) => string;
    attempts: (args: { count: number }) => string;
    searchPlaceholder: () => string;
    exportCsv: () => string;
    empty: () => string;
    legendAc: () => string;
    legendPartial: () => string;
    legendZero: () => string;
    legendEmpty: () => string;
    legendPractice?: () => string;
    practiceSummary?: (args: { score: number; count: number }) => string;
    gradeCellTitle?: () => string;
  }
</script>

<script lang="ts">
  import { Button } from "$lib/components/primitives/ui/button";
  import { cn } from "$lib/utils/css.js";
  import MatrixTable from "./MatrixTable.svelte";
  import MatrixLegend from "./MatrixLegend.svelte";

  interface Props {
    matrix: MatrixViewData;
    csvDownloadName: string;
    labels: MatrixViewLabels;
    dataSlot: string;
    oncellclick?: ((rowId: string, problemId: string) => void) | undefined;
    showHeader?: boolean;
    showHint?: boolean;
    class?: string | undefined;
  }

  let {
    matrix,
    csvDownloadName,
    labels,
    dataSlot,
    oncellclick,
    showHeader = true,
    showHint = true,
    class: className,
  }: Props = $props();

  type SortDirection = "asc" | "desc";

  let sortKey = $state("total");
  let sortDirection = $state<SortDirection>("desc");
  let search = $state("");

  const filteredRows = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? matrix.rows.filter(
          (r) => r.handle.toLowerCase().includes(q) || r.displayName.toLowerCase().includes(q),
        )
      : [...matrix.rows];
    const multiplier = sortDirection === "desc" ? -1 : 1;
    base.sort((a, b) => {
      const aScore =
        sortKey === "total"
          ? a.total
          : (a.cells.find((cell) => cell.problemId === sortKey)?.score ?? -Infinity);
      const bScore =
        sortKey === "total"
          ? b.total
          : (b.cells.find((cell) => cell.problemId === sortKey)?.score ?? -Infinity);
      return (aScore - bScore) * multiplier || a.handle.localeCompare(b.handle);
    });
    return base;
  });

  function csvEscape(value: string | number): string {
    const s = String(value);
    if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  }

  function exportCsv() {
    const header = [
      labels.student(),
      "handle",
      ...matrix.problems.map((p) => `${p.letter}`),
      labels.total(),
    ].map(csvEscape);
    const lines = [header.join(",")];
    for (const row of filteredRows) {
      const cells = matrix.problems.map((_p, idx) => row.cells[idx]?.score ?? "");
      lines.push([row.displayName, row.handle, ...cells, row.total].map(csvEscape).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csvDownloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function toggleSort(key: string) {
    if (sortKey === key) sortDirection = sortDirection === "desc" ? "asc" : "desc";
    else {
      sortKey = key;
      sortDirection = "desc";
    }
  }
</script>

<section data-slot={dataSlot} class={cn("space-y-4", className)}>
  {#if showHeader}
    <div class="flex items-baseline justify-between gap-4">
      <div>
        <h2 class="text-title font-medium leading-tight">
          {labels.heading()}
        </h2>
        {#if showHint}
          <p class="mt-1 text-caption text-muted-foreground">
            {labels.hint()}
          </p>
        {/if}
      </div>
      <span class="text-caption text-muted-foreground">
        {labels.meta({
          students: matrix.studentCount,
          problems: matrix.problems.length,
          total: matrix.totalPoints,
        })}
      </span>
    </div>
  {/if}

  <div class="flex justify-end">
    <Button variant="outline" size="sm" onclick={exportCsv}>
      {labels.exportCsv()}
    </Button>
  </div>

  {#if filteredRows.length === 0}
    <div
      class="rounded-md border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center text-body-sm text-muted-foreground"
    >
      {labels.empty()}
    </div>
  {:else}
    <MatrixTable
      problems={matrix.problems}
      rows={filteredRows}
      totalPoints={matrix.totalPoints}
      {labels}
      bind:search
      {sortKey}
      {sortDirection}
      onsort={toggleSort}
      {oncellclick}
    />

    <MatrixLegend {labels} />
  {/if}
</section>
