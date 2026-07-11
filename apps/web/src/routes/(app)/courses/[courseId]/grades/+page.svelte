<script lang="ts">
  import { Download } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const gradebook = $derived(data.gradebook);
  const isManager = $derived(data.isManager);

  function cellKey(contextType: string, contextId: string, problemId: string): string {
    return `${contextType}:${contextId}:${problemId}`;
  }

  function cellScore(row: PageData["gradebook"]["rows"][number], key: string): number | null {
    return row.cells[key] ?? null;
  }

  function csvEscape(value: string | number): string {
    const s = String(value);
    if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  }

  function exportCsv() {
    const contextRow = [m.courseGradebook_student(), ""];
    const problemRow = ["", ""];
    const maxRow = [m.courseGradebook_maxScoreLabel(), ""];
    for (const column of gradebook.columns) {
      for (const [index, problem] of column.problems.entries()) {
        contextRow.push(index === 0 ? column.contextTitle : "");
        problemRow.push(m.courseGradebook_problemOrdinal({ n: problem.ordinal }));
        maxRow.push(String(problem.maxScore));
      }
    }
    contextRow.push(m.courseGradebook_total());
    problemRow.push("");
    maxRow.push(String(gradebook.maxTotal));

    const lines = [contextRow, problemRow, maxRow].map((r) => r.map(csvEscape).join(","));
    for (const row of gradebook.rows) {
      const cells = gradebook.columns.flatMap((column) =>
        column.problems.map(
          (p) =>
            cellScore(row, cellKey(column.contextType, column.contextId, p.problemId)) ?? "",
        ),
      );
      lines.push([row.name, row.username ?? "", ...cells, row.total].map(csvEscape).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `course-${data.course.id}-grades.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
</script>

<svelte:head>
  <title>{m.courseGradebook_heading()} · {data.course.title} · NOJV</title>
</svelte:head>

<PageContainer class="space-y-6">
  <section data-slot="course-gradebook" class="animate-in animate-in-1 space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 class="text-title font-medium leading-tight">
          {isManager ? m.courseGradebook_heading() : m.courseGradebook_headingOwn()}
        </h2>
        <p class="mt-1 text-caption text-muted-foreground">
          {isManager ? m.courseGradebook_hint() : m.courseGradebook_hintOwn()}
        </p>
      </div>
      {#if isManager && gradebook.rows.length > 0}
        <Button variant="outline" size="sm" onclick={exportCsv} data-tour="gradebook-export">
          <Download class="size-4" />
          {m.courseGradebook_exportCsv()}
        </Button>
      {/if}
    </div>

    {#if gradebook.columns.length === 0 || gradebook.rows.length === 0}
      <div
        class="rounded-md border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center text-body-sm text-muted-foreground"
      >
        {m.courseGradebook_empty()}
      </div>
    {:else}
      <div class="overflow-x-auto rounded-md border border-border">
        <table class="w-full border-separate border-spacing-0 tabular-nums">
          <thead>
            <tr>
              <th
                rowspan="2"
                class="sticky left-0 z-[3] border-b border-r border-border-subtle bg-muted px-5 py-3 text-left text-caption font-semibold uppercase tracking-[0.06em] text-muted-foreground"
                style="min-width: 200px"
              >
                {m.courseGradebook_student()}
              </th>
              {#each gradebook.columns as column (column.contextType + column.contextId)}
                <th
                  colspan={column.problems.length}
                  class="border-b border-r border-border-subtle bg-muted px-3 py-2.5 text-center text-caption font-semibold text-foreground"
                >
                  {column.contextTitle}
                </th>
              {/each}
              <th
                rowspan="2"
                class="border-b border-border-subtle bg-primary/8 px-3 py-3 text-center text-caption font-semibold text-primary"
                style="min-width: 110px"
              >
                {m.courseGradebook_total()}
                <span class="mt-1 block text-micro font-normal text-muted-foreground">
                  {m.courseGradebook_maxPoints({ points: gradebook.maxTotal })}
                </span>
              </th>
            </tr>
            <tr>
              {#each gradebook.columns as column (column.contextType + column.contextId)}
                {#each column.problems as problem (problem.problemId)}
                  <th
                    class="border-b border-r border-border-subtle bg-muted px-3 py-2.5 text-center text-caption font-semibold"
                    style="min-width: 80px"
                    title={problem.title}
                  >
                    <span class="block leading-none text-foreground">
                      {m.courseGradebook_problemOrdinal({ n: problem.ordinal })}
                    </span>
                    <span class="mt-1 block text-micro font-normal text-muted-foreground">
                      {m.courseGradebook_maxPoints({ points: problem.maxScore })}
                    </span>
                  </th>
                {/each}
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each gradebook.rows as row (row.userId)}
              <tr>
                <td
                  class="sticky left-0 z-[1] border-b border-r border-border-subtle bg-background px-5 py-3 text-left before:absolute before:inset-0 before:-z-[1] before:bg-[color:var(--color-panel)] before:content-['']"
                >
                  <div class="font-medium tracking-[-0.005em] text-foreground">{row.name}</div>
                  {#if row.username}
                    <div class="mt-0.5 font-mono text-caption text-muted-foreground">
                      {row.username}
                    </div>
                  {/if}
                </td>
                {#each gradebook.columns as column (column.contextType + column.contextId)}
                  {#each column.problems as problem (problem.problemId)}
                    {@const score = cellScore(
                      row,
                      cellKey(column.contextType, column.contextId, problem.problemId),
                    )}
                    <td
                      class="border-b border-r border-border-subtle px-3 py-3 text-center text-body-sm {score ===
                      null
                        ? 'text-muted-foreground'
                        : score >= problem.maxScore
                          ? 'font-semibold text-success'
                          : 'text-foreground'}"
                    >
                      {score ?? "—"}
                    </td>
                  {/each}
                {/each}
                <td
                  class="border-b border-border-subtle bg-primary/5 px-3 py-3 text-center text-body-lg font-medium text-foreground"
                >
                  {row.total}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</PageContainer>
