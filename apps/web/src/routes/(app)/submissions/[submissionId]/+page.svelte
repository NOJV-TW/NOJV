<script lang="ts">
  import { ArrowLeft, Check, Copy, Download } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { formatDateTime } from "$lib/utils/datetime";
  import { formatVerdictLabel, verdictTone } from "$lib/utils/verdict-style";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
  import SubtaskResultTree from "$lib/components/features/submission/SubtaskResultTree.svelte";
  import CaseResultGrid from "$lib/components/features/submission/CaseResultGrid.svelte";

  let { data } = $props();

  const submission = $derived(data.submission);
  const result = $derived(submission.result);
  const verdict = $derived(result?.verdict ?? submission.status);
  const verdictLabel = $derived(formatVerdictLabel(verdict));
  const verdictClass = $derived(verdictTone(verdict));
  const isPending = $derived(
    verdict === "queued" || verdict === "compiling" || verdict === "running",
  );

  const submittedAt = $derived(formatDateTime(submission.createdAt));
  const runtimeMs = $derived(submission.runtimeMs ?? result?.runtimeMs ?? null);
  const memoryKb = $derived(submission.memoryKb ?? result?.memoryKb ?? null);

  const caseResults = $derived(result?.caseResults ?? []);
  const subtaskResults = $derived(result?.subtaskResults ?? []);

  const backTarget = $derived.by(() => {
    const ctx = submission.context;
    const problemId = submission.problem.id;
    if (ctx.kind === "assignment") {
      return {
        href: `/assignments/${ctx.assignmentId}/problems/${problemId}`,
        label: m.submissionDetail_backToAssignment(),
      };
    }
    if (ctx.kind === "contest") {
      return {
        href: `/contests/${ctx.contestId}/problems/${problemId}`,
        label: m.submissionDetail_backToContest(),
      };
    }
    if (ctx.kind === "exam") {
      return {
        href: `/exams/${ctx.examId}/problems/${problemId}`,
        label: m.submissionDetail_backToExam(),
      };
    }
    return {
      href: `/problems/${problemId}`,
      label: m.submissionDetail_backToProblem(),
    };
  });

  const codeLines = $derived(submission.sourceCode.split("\n"));
  const displayLines = $derived(
    codeLines.length > 1 && codeLines[codeLines.length - 1] === ""
      ? codeLines.slice(0, -1)
      : codeLines,
  );
  const gutterWidth = $derived(String(displayLines.length).length);

  const downloadExtension: Record<string, string> = {
    c: "c",
    cpp: "cpp",
    go: "go",
    java: "java",
    javascript: "mjs",
    python: "py",
    rust: "rs",
    typescript: "ts",
  };

  let copied = $state(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(submission.sourceCode);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  }

  function handleDownload() {
    const ext = downloadExtension[submission.language] ?? "txt";
    const blob = new Blob([submission.sourceCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `submission-${submission.id}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function formatMemory(kb: number): string {
    if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${String(kb)} KB`;
  }
</script>

<div class="flex flex-col gap-4">
  <a
    class="inline-flex w-fit items-center gap-1.5 text-body-sm text-muted-foreground transition-[color] duration-fast ease-out-soft hover:text-foreground"
    href={backTarget.href}
  >
    <ArrowLeft class="size-4" />
    {backTarget.label}
  </a>

  <div class="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
    <!-- Left rail -->
    <aside class="flex flex-col gap-5">
      <!-- Hero -->
      <div class="flex flex-col gap-2">
        <p class="text-caption uppercase tracking-wide text-muted-foreground">
          {formatProblemDisplayName(submission.problem)}
        </p>
        <p class="text-title-lg font-semibold leading-tight {verdictClass}">
          {verdictLabel}
        </p>
        <p class="text-display-sm font-semibold tabular-nums">
          {submission.score}<span class="text-title-sm text-muted-foreground"> / 100</span>
        </p>
      </div>

      <!-- Metrics 2x2 -->
      <dl
        class="grid grid-cols-2 gap-3 rounded-lg border border-border-subtle bg-muted/20 p-2"
      >
        <div class="flex flex-col gap-0.5">
          <dt class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.submissionDetail_runtime()}
          </dt>
          <dd class="text-body-md font-medium tabular-nums">
            {#if runtimeMs !== null && runtimeMs > 0}
              {runtimeMs}<span class="text-body-sm text-muted-foreground"> ms</span>
            {:else}
              <span class="text-muted-foreground">—</span>
            {/if}
          </dd>
        </div>
        <div class="flex flex-col gap-0.5">
          <dt class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.submissionDetail_memory()}
          </dt>
          <dd class="text-body-md font-medium tabular-nums">
            {#if memoryKb !== null && memoryKb > 0}
              {formatMemory(memoryKb)}
            {:else}
              <span class="text-muted-foreground">—</span>
            {/if}
          </dd>
        </div>
        <div class="flex flex-col gap-0.5">
          <dt class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.submissionDetail_language()}
          </dt>
          <dd class="text-body-md font-medium">{submission.language}</dd>
        </div>
        <div class="flex flex-col gap-0.5">
          <dt class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.submissionDetail_submittedAt()}
          </dt>
          <dd class="text-body-sm tabular-nums">{submittedAt}</dd>
        </div>
      </dl>

      <!-- Context badges & notices -->
      {#if submission.context.kind === "contest"}
        <p
          class="rounded-md border border-border-subtle bg-muted/30 px-3 py-2 text-body-sm text-muted-foreground"
        >
          {m.submissionDetail_contextContest({ contestTitle: submission.context.contestTitle })}
        </p>
      {:else if submission.context.kind === "assignment"}
        <p
          class="rounded-md border border-border-subtle bg-muted/30 px-3 py-2 text-body-sm text-muted-foreground"
        >
          {m.submissionDetail_contextAssessment({
            assessmentTitle: submission.context.assignmentTitle,
            courseTitle: submission.context.courseTitle,
          })}
        </p>
      {:else if submission.context.kind === "exam"}
        <p
          class="rounded-md border border-border-subtle bg-muted/30 px-3 py-2 text-body-sm text-muted-foreground"
        >
          {m.submissionDetail_contextExam({
            examTitle: submission.context.examTitle,
            courseTitle: submission.context.courseTitle,
          })}
        </p>
      {/if}

      {#if submission.sampleOnly}
        <p
          class="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-body-sm text-primary"
        >
          {m.submissionDetail_sampleOnlyNotice()}
        </p>
      {/if}

      {#if submission.viewerIsStaff && submission.submitter}
        <div class="rounded-md border border-border-subtle bg-muted/30 px-3 py-2 text-body-sm">
          <p class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.submissionDetail_submitter()}
          </p>
          <p class="mt-0.5 font-medium text-foreground">
            {submission.submitter.name}
            <span class="text-muted-foreground">(@{submission.submitter.username})</span>
          </p>
          <p class="mt-1 text-caption text-muted-foreground">
            {m.submissionDetail_viewingAsStaff()}
          </p>
        </div>
      {/if}

      <!-- Feedback / judging -->
      {#if isPending}
        <p
          class="rounded-md border border-dashed border-border-strong bg-muted/20 px-3 py-3 text-center text-body-sm text-muted-foreground"
        >
          {m.submissionDetail_judging()}
        </p>
      {:else if result?.feedback}
        <div class="flex flex-col gap-1.5">
          <h2 class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.submissionDetail_feedback()}
          </h2>
          <pre
            class="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-muted/30 px-3 py-2 font-mono text-body-sm text-foreground">{result.feedback}</pre>
        </div>
      {/if}

      <!-- Teacher grading feedback — assignment/exam only, post-close. -->
      {#if data.feedback}
        <div class="flex flex-col gap-1.5">
          <h2 class="text-caption uppercase tracking-wide text-info">
            {m.feedback_student_label()}
          </h2>
          <p
            class="whitespace-pre-wrap break-words rounded-md border border-info/30 bg-info/5 px-3 py-2 text-body-sm text-foreground"
          >
            {data.feedback}
          </p>
        </div>
      {/if}

      <!-- Subtasks -->
      {#if subtaskResults.length > 0}
        <div class="flex flex-col gap-2">
          <h2 class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.submissionDetail_subtasks()}
          </h2>
          <SubtaskResultTree {subtaskResults} />
        </div>
      {/if}

      <!-- Case mini-grid -->
      {#if caseResults.length > 0}
        <div class="flex flex-col gap-2">
          <h2 class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.submissionDetail_perCaseBreakdown()}
          </h2>
          <CaseResultGrid
            cases={caseResults}
            allowExpand={submission.sampleOnly || submission.viewerIsStaff}
          />
        </div>
      {:else if result && !isPending}
        <p
          class="rounded-md border border-dashed border-border-strong bg-muted/20 px-3 py-3 text-center text-body-sm text-muted-foreground"
        >
          {m.submissionDetail_noCaseResults()}
        </p>
      {/if}
    </aside>

    <!-- Right pane: source code -->
    <section
      class="flex min-h-[60vh] flex-col overflow-hidden rounded-lg border border-border lg:h-[calc(100vh-9rem)] lg:sticky lg:top-4"
    >
      <header
        class="flex items-center justify-between gap-3 border-b border-border-subtle bg-muted/60 px-4 py-2"
      >
        <div class="flex items-center gap-2 text-caption text-muted-foreground">
          <span class="font-medium text-foreground">{submission.language}</span>
          <span>·</span>
          <span class="tabular-nums"
            >{m.submissionDetail_lineCount({ count: displayLines.length })}</span
          >
        </div>
        <div class="flex items-center gap-1">
          <button
            class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-caption text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onclick={handleCopy}
            type="button"
          >
            {#if copied}
              <Check class="size-3.5 text-success" />
              <span class="text-success">{m.common_copied()}</span>
            {:else}
              <Copy class="size-3.5" />
              <span>{m.common_copy()}</span>
            {/if}
          </button>
          <button
            class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-caption text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onclick={handleDownload}
            type="button"
          >
            <Download class="size-3.5" />
            <span>{m.submissionDetail_downloadCode()}</span>
          </button>
        </div>
      </header>
      <div class="flex-1 overflow-auto bg-[color:var(--color-panel)]">
        <table class="w-full border-collapse">
          <tbody>
            {#each displayLines as line, i (i)}
              <tr class="leading-6">
                <td
                  class="select-none border-r border-border/50 px-3 text-right font-mono text-xs text-muted-foreground/50"
                  style="min-width: {gutterWidth + 1.5}ch"
                >
                  {i + 1}
                </td>
                <td class="px-4 font-mono text-sm text-foreground">
                  <pre class="whitespace-pre-wrap break-all">{line || " "}</pre>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  </div>
</div>
