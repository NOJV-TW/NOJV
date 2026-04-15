<script lang="ts" module>
  import type { courseDomain } from "@nojv/domain";

  export type SubmissionsMatrixData = courseDomain.SubmissionsMatrix;
</script>

<script lang="ts">
  import { Download, Search } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils.js";

  interface Props {
    matrix: SubmissionsMatrixData;
    courseId: string;
    assessmentId: string;
    class?: string;
  }

  let { matrix, courseId, assessmentId, class: className }: Props = $props();

  type SortKey = "totalDesc" | "handleAsc" | "nameAsc";

  let sortKey = $state<SortKey>("totalDesc");
  let search = $state("");
  let page = $state(0);
  const PAGE_SIZE = 25;

  const filteredRows = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? matrix.rows.filter(
          (r) => r.handle.toLowerCase().includes(q) || r.displayName.toLowerCase().includes(q)
        )
      : [...matrix.rows];
    switch (sortKey) {
      case "handleAsc":
        base.sort((a, b) => a.handle.localeCompare(b.handle));
        break;
      case "nameAsc":
        base.sort((a, b) => a.displayName.localeCompare(b.displayName));
        break;
      case "totalDesc":
      default:
        base.sort((a, b) => b.total - a.total);
        break;
    }
    return base;
  });

  const totalRows = $derived(filteredRows.length);
  const pageRows = $derived(filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));
  const from = $derived(totalRows === 0 ? 0 : page * PAGE_SIZE + 1);
  const to = $derived(Math.min(totalRows, (page + 1) * PAGE_SIZE));

  function csvEscape(value: string | number): string {
    const s = String(value);
    if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  }

  function exportCsv() {
    const header = [
      m.assignmentDetail_matrixStudent(),
      "handle",
      ...matrix.problems.map((p) => `${p.letter}`),
      m.assignmentDetail_matrixTotal()
    ].map(csvEscape);
    const lines = [header.join(",")];
    for (const row of filteredRows) {
      const cells = matrix.problems.map((p, idx) => row.cells[idx]?.score ?? "");
      lines.push(
        [row.displayName, row.handle, ...cells, row.total].map(csvEscape).join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `assignment-${assessmentId}-matrix.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function prevPage() {
    if (page > 0) page -= 1;
  }
  function nextPage() {
    if ((page + 1) * PAGE_SIZE < totalRows) page += 1;
  }
</script>

<section data-slot="assignment-submissions-matrix" class={cn("space-y-4", className)}>
  <div class="flex items-baseline justify-between gap-4">
    <div>
      <h2 class="font-display text-title font-medium leading-tight">
        {m.assignmentDetail_matrixHeading()}
      </h2>
      <p class="mt-1 text-caption text-muted-foreground">
        {m.assignmentDetail_matrixHint()}
      </p>
    </div>
    <span class="text-caption text-muted-foreground">
      {m.assignmentDetail_matrixMeta({
        students: matrix.studentCount,
        problems: matrix.problems.length,
        total: matrix.totalPoints
      })}
    </span>
  </div>

  <!-- Toolbar -->
  <div class="flex flex-wrap items-center gap-3 border-b border-border-subtle pb-4">
    <select
      class="h-9 min-w-[140px] rounded-md border border-border bg-[color:var(--color-panel)] px-3 text-body-sm text-foreground"
      disabled
      title="Role filter — placeholder, matrix currently shows only students"
    >
      <option value="all">{m.assignmentDetail_matrixFilterAll()}</option>
      <option value="students">{m.assignmentDetail_matrixFilterStudents()}</option>
    </select>

    <select
      bind:value={sortKey}
      class="h-9 min-w-[140px] rounded-md border border-border bg-[color:var(--color-panel)] px-3 text-body-sm text-foreground"
    >
      <option value="totalDesc">{m.assignmentDetail_matrixSortTotalDesc()}</option>
      <option value="handleAsc">{m.assignmentDetail_matrixSortHandleAsc()}</option>
      <option value="nameAsc">{m.assignmentDetail_matrixSortNameAsc()}</option>
    </select>

    <div class="relative max-w-[260px] flex-1">
      <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
        <Search class="size-4" aria-hidden="true" />
      </span>
      <input
        type="text"
        bind:value={search}
        placeholder={m.assignmentDetail_matrixSearchPlaceholder()}
        class="h-9 w-full rounded-md border border-border bg-[color:var(--color-panel)] pl-9 pr-3 text-body-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
    </div>

    <span class="flex-1"></span>

    <Button variant="outline" size="sm" onclick={exportCsv}>
      <Download class="size-4" aria-hidden="true" />
      {m.assignmentDetail_matrixExportCsv()}
    </Button>
  </div>

  {#if totalRows === 0}
    <div
      class="rounded-lg border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center text-body-sm text-muted-foreground"
    >
      {m.assignmentDetail_matrixEmpty()}
    </div>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-border">
      <table class="w-full border-separate border-spacing-0 tabular-nums">
        <thead>
          <tr>
            <th
              class="sticky left-0 z-[3] border-b border-r border-border-subtle bg-muted px-5 py-3 text-left text-caption font-semibold uppercase tracking-[0.06em] text-muted-foreground"
              style="min-width: 200px"
            >
              {m.assignmentDetail_matrixStudent()}
            </th>
            {#each matrix.problems as problem (problem.problemId)}
              <th
                class="border-b border-r border-border-subtle bg-muted px-3 py-3 text-center text-caption font-semibold"
                style="min-width: 88px"
              >
                <span
                  class="block font-display text-title font-medium leading-none tracking-[-0.02em] text-foreground"
                >
                  {problem.letter}
                </span>
                <span class="mt-1 block text-micro font-normal text-muted-foreground">
                  {m.assignmentDetail_matrixMaxPoints({ points: problem.points })}
                </span>
              </th>
            {/each}
            <th
              class="border-b border-r border-border-subtle bg-[color:rgba(196,104,45,0.06)] px-3 py-3 text-center text-caption font-semibold text-primary"
              style="min-width: 110px"
            >
              {m.assignmentDetail_matrixTotal()}
            </th>
            <th
              class="border-b border-border-subtle bg-muted px-3 py-3 text-center text-caption font-semibold uppercase tracking-[0.06em] text-muted-foreground"
              style="min-width: 72px"
            >
            </th>
          </tr>
        </thead>
        <tbody>
          {#each pageRows as row (row.userId)}
            <tr>
              <td
                class="sticky left-0 z-[1] border-b border-r border-border-subtle bg-[color:var(--color-panel)] px-5 py-3 text-left"
              >
                <div class="font-medium tracking-[-0.005em] text-foreground">{row.displayName}</div>
                {#if row.handle}
                  <div class="mt-0.5 font-mono text-caption text-muted-foreground">
                    {row.handle}
                  </div>
                {/if}
              </td>
              {#each row.cells as cell (cell.problemId)}
                <td
                  class={cn(
                    "border-b border-r border-border-subtle px-3 py-3 text-center text-body-sm",
                    cell.state === "ac" && "bg-[color:rgba(77,141,91,0.14)] font-semibold text-success",
                    cell.state === "partial" && "bg-[color:rgba(184,55,42,0.1)] text-destructive",
                    cell.state === "zero" && "bg-[color:rgba(184,55,42,0.18)] font-semibold text-destructive",
                    cell.state === "empty" && "text-muted-foreground"
                  )}
                  style={cell.state === "empty"
                    ? "background: repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(79, 52, 35, 0.04) 4px, rgba(79, 52, 35, 0.04) 8px);"
                    : ""}
                >
                  {#if cell.state === "empty"}
                    <span>—</span>
                  {:else}
                    <span>{cell.score}</span>
                    {#if cell.state === "ac"}
                      <span class="ml-1 font-bold">✓</span>
                    {/if}
                    <span class="mt-0.5 block text-micro font-normal opacity-70">
                      {m.assignmentDetail_matrixAttempts({ count: cell.attempts })}
                    </span>
                  {/if}
                </td>
              {/each}
              <td
                class="border-b border-r border-border-subtle bg-[color:rgba(196,104,45,0.03)] px-3 py-3 text-center font-display text-body-lg font-medium text-foreground"
              >
                {row.total}<span class="font-normal text-muted-foreground"> / </span>
                <span class="text-caption font-normal text-muted-foreground">
                  {matrix.totalPoints}
                </span>
              </td>
              <td class="border-b border-border-subtle px-3 py-3 text-center">
                <a
                  href={`/courses/${courseId}/members?student=${row.userId}`}
                  class="text-caption font-medium text-primary hover:underline"
                >
                  {m.assignmentDetail_matrixView()}
                </a>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Legend -->
    <div class="flex flex-wrap items-center gap-5 text-caption text-muted-foreground">
      <span class="inline-flex items-center gap-1.5">
        <span
          class="inline-block h-[14px] w-[18px] rounded-[2px] border border-border-subtle bg-[color:rgba(77,141,91,0.14)]"
        ></span>
        {m.assignmentDetail_legendAc()}
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span
          class="inline-block h-[14px] w-[18px] rounded-[2px] border border-border-subtle bg-[color:rgba(184,55,42,0.1)]"
        ></span>
        {m.assignmentDetail_legendPartial()}
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span
          class="inline-block h-[14px] w-[18px] rounded-[2px] border border-border-subtle bg-[color:rgba(184,55,42,0.18)]"
        ></span>
        {m.assignmentDetail_legendZero()}
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span
          class="inline-block h-[14px] w-[18px] rounded-[2px] border border-border-subtle"
          style="background: repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(79, 52, 35, 0.04) 3px, rgba(79, 52, 35, 0.04) 6px);"
        ></span>
        {m.assignmentDetail_legendEmpty()}
      </span>
    </div>

    <!-- Pagination -->
    <div class="flex items-center justify-between text-caption text-muted-foreground">
      <span>
        {m.assignmentDetail_matrixPaginationLabel({ from, to, total: totalRows })}
      </span>
      <div class="flex gap-2">
        <Button variant="ghost" size="sm" onclick={prevPage} disabled={page === 0}>
          {m.assignmentDetail_matrixPrev()}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onclick={nextPage}
          disabled={(page + 1) * PAGE_SIZE >= totalRows}
        >
          {m.assignmentDetail_matrixNext()}
        </Button>
      </div>
    </div>
  {/if}
</section>
