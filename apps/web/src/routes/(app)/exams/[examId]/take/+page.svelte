<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import * as Dialog from "$lib/components/ui/dialog";
  import ExamTakeTopBar from "$lib/components/course/exam/take/ExamTakeTopBar.svelte";
  import ExamTakeSidebar, {
    type ProbStatus
  } from "$lib/components/course/exam/take/ExamTakeSidebar.svelte";
  import ExamTakeProblemPanel from "$lib/components/course/exam/take/ExamTakeProblemPanel.svelte";
  import ExamTakeConsole from "$lib/components/course/exam/take/ExamTakeConsole.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const detail = $derived(data.detail);
  const examCode = $derived(`EX-${detail.id.slice(-6).toUpperCase()}`);

  const allowedLanguages = $derived(
    detail.manager?.allowedLanguages ?? ["cpp17", "python311", "java17"]
  );

  // Tick once a second for the countdown.
  let nowMs = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => {
      nowMs = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });

  const endsAtMs = $derived(new Date(detail.endsAt).getTime());
  const remainMs = $derived(Math.max(0, endsAtMs - nowMs));

  // Auto-redirect to detail when time runs out.
  $effect(() => {
    if (remainMs <= 0) {
      void goto(`/exams/${detail.id}`);
    }
  });

  const problems = $derived(
    detail.problems.map((p) => ({ id: p.id, letter: p.letter, title: p.title }))
  );

  // Active problem state + status map are client-only — they reset
  // on a refresh. A future iteration should sync via the exam-session
  // SSE / API so a student who refreshes mid-exam keeps their state.
  let activeId = $state(untrack(() => problems[0]?.id ?? ""));
  let statusMap = $state<Record<string, ProbStatus>>({});
  let collapsed = $state(false);
  let showConfirm = $state(false);

  let code = $state(untrack(() => data.starterCode));
  let savedAt = $state<string | null>(null);

  // Faux auto-save indicator — flash every 30s to match the design copy.
  $effect(() => {
    const id = setInterval(() => {
      const d = new Date();
      savedAt = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }, 30_000);
    return () => clearInterval(id);
  });

  const activeProblem = $derived(
    detail.problems.find((p) => p.id === activeId) ?? detail.problems[0]
  );

  function toggleFlag(pid: string) {
    statusMap = {
      ...statusMap,
      [pid]: statusMap[pid] === "flagged" ? "attempted" : "flagged"
    };
  }

  function markDone(pid: string) {
    statusMap = { ...statusMap, [pid]: "done" };
  }

  const doneCount = $derived(
    Object.values(statusMap).filter((s) => s === "done").length
  );

  function confirmSubmit() {
    // TODO(NOJV): wire to real submit-exam endpoint. For now we just
    // bounce back to the detail page; the session-end + final-grade
    // flow runs through the existing per-problem submission API.
    showConfirm = false;
    void goto(`/exams/${detail.id}`);
  }

  const lineCount = $derived(code.split("\n").length);
</script>

<svelte:head>
  <title>{detail.title} · {examCode}</title>
</svelte:head>

<div
  class="fixed inset-0 z-30 flex flex-col"
  style="background: var(--background);"
>
  <ExamTakeTopBar
    {examCode}
    examTitle={detail.title}
    {remainMs}
    {savedAt}
    onSubmit={() => (showConfirm = true)}
  />

  <div
    class="grid min-h-0 flex-1"
    style:grid-template-columns={collapsed ? "48px 1fr" : "260px 1fr"}
  >
    <ExamTakeSidebar
      {problems}
      {activeId}
      {statusMap}
      {collapsed}
      onToggle={() => (collapsed = !collapsed)}
      onSelect={(id) => (activeId = id)}
    />

    <!-- Workspace: problem + editor + console -->
    <main class="grid min-h-0" style="grid-template-columns: 1fr 1.2fr;">
      {#if activeProblem}
        <ExamTakeProblemPanel
          letter={activeProblem.letter}
          title={activeProblem.title}
          difficulty={activeProblem.difficulty}
          points={activeProblem.points}
          flagged={statusMap[activeProblem.id] === "flagged"}
          onToggleFlag={() => toggleFlag(activeProblem.id)}
        />
      {/if}

      <!-- Editor + Console -->
      <section class="flex min-h-0 flex-col">
        <div
          class="flex flex-shrink-0 items-center justify-between border-b border-border-subtle px-4 py-2"
          style="background: var(--panel-strong, var(--panel));"
        >
          <div class="flex items-center gap-2">
            <select
              class="rounded-md border border-border-subtle bg-transparent px-2 py-1 font-mono text-caption"
            >
              {#each allowedLanguages as lang (lang)}
                <option value={lang}>{lang}</option>
              {/each}
            </select>
            <span
              class="font-mono text-micro uppercase tracking-wider text-muted-foreground"
            >
              main.cpp · {m.examTake_fileLineCount({ count: lineCount })}
            </span>
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="rounded-md border border-border-subtle px-3 py-1 text-caption transition-colors hover:bg-muted"
            >
              {m.examTake_runCompileButton()}
            </button>
            <button
              type="button"
              class="rounded-md border border-border-subtle px-3 py-1 text-caption transition-colors hover:bg-muted"
            >
              {m.examTake_runSampleButton()}
            </button>
            <button
              type="button"
              onclick={() => activeProblem && markDone(activeProblem.id)}
              class="rounded-md bg-primary px-3 py-1 text-caption font-medium text-primary-foreground transition-opacity hover:opacity-95"
            >
              {m.examTake_submitInline()}
            </button>
          </div>
        </div>

        <div class="grid min-h-0 flex-1" style="grid-template-rows: 1.4fr 1fr;">
          <!--
            TODO(NOJV): replace this read-only preview with the real
            Monaco editor (`apps/web/src/lib/components/problem/Editor.svelte`).
            That component is currently tightly coupled to ProblemDetail
            and the submission service; integrating it here means either
            loading the full problem detail in +page.server.ts and
            adapting the contract, or extracting a leaner editor shell.
          -->
          <div
            class="relative min-h-0 overflow-auto font-mono text-caption"
            style="background: var(--background);"
          >
            <div class="flex">
              <div
                class="select-none border-r border-border-subtle px-3 py-3 text-right text-muted-foreground/70"
                style="background: color-mix(in oklab, var(--muted) 45%, transparent);"
              >
                {#each code.split("\n") as _line, i (i)}
                  <div class="leading-6 tabular-nums">{i + 1}</div>
                {/each}
              </div>
              <pre class="flex-1 whitespace-pre px-4 py-3 leading-6">{code}</pre>
            </div>
            <div
              class="absolute bottom-3 right-3 rounded-md px-2 py-1 font-mono text-micro uppercase tracking-wider text-muted-foreground"
              style="background: var(--panel-strong, var(--panel)); border: 1px solid var(--border-subtle);"
            >
              Read-only preview
            </div>
          </div>
          <ExamTakeConsole />
        </div>
      </section>
    </main>
  </div>
</div>

<Dialog.Root open={showConfirm} onOpenChange={(v) => (showConfirm = v)}>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title class="text-title font-semibold">{m.examTake_confirmTitle()}</Dialog.Title>
      <Dialog.Description class="mt-2 text-body-sm text-muted-foreground">
        {m.examTake_confirmBodyPrefix()}
        <span class="font-semibold text-foreground">{doneCount}</span>
        {m.examTake_confirmBodySuffix({ total: problems.length })}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer class="mt-4 flex justify-end gap-3">
      <button
        type="button"
        onclick={() => (showConfirm = false)}
        class="rounded-md border border-border px-4 py-2 text-body-sm font-medium transition-colors hover:bg-muted"
      >
        {m.examTake_confirmCancel()}
      </button>
      <button
        type="button"
        onclick={confirmSubmit}
        class="rounded-md bg-primary px-5 py-2 text-body-sm font-semibold text-primary-foreground transition-opacity hover:opacity-95"
      >
        {m.examTake_confirmConfirm()}
      </button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
