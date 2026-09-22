<script lang="ts">
  import SubmissionId from "$lib/components/features/submission/SubmissionId.svelte";
  import { Check, Copy, Download } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { watchSubmissionStates } from "$lib/services/submission-tracker";
  import { formatDateTime } from "$lib/utils/datetime";
  import { formatJudgeOutput } from "$lib/utils/judge-output";
  import { verdictTone } from "$lib/utils/verdict-style";
  import { languageLabel } from "@nojv/core";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";
  import { flattenSourcesForDisplay } from "$lib/utils/submission-source-display";
  import SubtaskResultTree from "$lib/components/features/submission/SubtaskResultTree.svelte";
  import HighlightedCode from "$lib/components/primitives/ui/HighlightedCode.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import BackLink from "$lib/components/primitives/layout/BackLink.svelte";

  let { data } = $props();

  const submission = $derived(data.submission);
  const result = $derived(submission.result);
  const verdict = $derived(submission.status);
  const verdictClass = $derived(verdictTone(verdict));
  const execution = $derived(data.execution);
  const executionActive = $derived(
    execution && !["completed", "cancelled"].includes(execution.state),
  );
  const isPending = $derived(
    executionActive ||
      verdict === "pending_upload" ||
      verdict === "queued" ||
      verdict === "compiling" ||
      verdict === "running",
  );

  const recoveryMessage = $derived.by(() => {
    if (!execution || !executionActive) return null;
    if (execution.reasonCode === "original_version_unavailable")
      return m.judgeRecovery_missingVersion();
    if (execution.state === "waiting_capacity" || execution.state === "queued")
      return verdict === "system_error" ? null : m.judgeRecovery_waiting();
    if (execution.state === "running" || execution.state === "finalizing")
      return m.judgeRecovery_running();
    return m.judgeRecovery_recovering();
  });

  const verdictLabel = $derived(
    verdict === "pending_upload"
      ? "Pending"
      : verdict.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase()),
  );

  $effect(() => watchSubmissionStates([submission.id], () => undefined));

  const submittedAt = $derived(formatDateTime(submission.createdAt));
  const runtimeMs = $derived(submission.runtimeMs ?? result?.runtimeMs ?? null);
  const memoryKb = $derived(submission.memoryKb ?? result?.memoryKb ?? null);

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

  const sourceCode = $derived(flattenSourcesForDisplay(submission.sources));
  const codeLines = $derived(sourceCode.split("\n"));
  const displayLines = $derived(
    codeLines.length > 1 && codeLines[codeLines.length - 1] === ""
      ? codeLines.slice(0, -1)
      : codeLines,
  );

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
    await navigator.clipboard.writeText(sourceCode);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2000);
  }

  function handleDownload() {
    const ext = downloadExtension[submission.language] ?? "txt";
    const blob = new Blob([sourceCode], { type: "text/plain" });
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

<PageContainer class="flex flex-col gap-4">
  <BackLink class="w-fit text-body-sm" href={backTarget.href} label={backTarget.label} />

  <div class="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
    <aside class="flex min-w-0 flex-col gap-5">
      <div class="flex flex-col gap-2">
        <p class="break-words text-title-lg font-semibold leading-tight {verdictClass}">
          {verdictLabel}
        </p>
        {#if recoveryMessage}
          <p class="text-body-sm text-muted-foreground" role="status">{recoveryMessage}</p>
        {/if}
        <p class="text-headline font-semibold tabular-nums">
          {submission.score}<span class="text-title-sm text-muted-foreground">
            / {submission.totalScore}</span
          >
        </p>
      </div>

      <dl class="grid grid-cols-2 gap-3 rounded-lg border border-border-subtle bg-muted/20 p-4">
        <div class="flex flex-col gap-0.5">
          <dt class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.submissionDetail_runtime()}
          </dt>
          <dd class="text-body font-medium tabular-nums">
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
          <dd class="text-body font-medium tabular-nums">
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
          <dd class="text-body font-medium">{languageLabel(submission.language)}</dd>
        </div>
        <div class="flex flex-col gap-0.5">
          <dt class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.submissionDetail_submittedAt()}
          </dt>
          <dd class="text-body-sm tabular-nums">{submittedAt}</dd>
        </div>
        <div class="col-span-2 min-w-0 border-t border-border-subtle pt-3">
          <dt class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.submissionDetail_problem()}
          </dt>
          <dd class="mt-1 break-words text-body-sm font-medium">
            <a class="hover:underline" href={backTarget.href}>
              {formatProblemDisplayName(submission.problem)}
            </a>
          </dd>
        </div>
        <div class="col-span-2 min-w-0 border-t border-border-subtle pt-3">
          <dt class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.submission_id()}
          </dt>
          <dd class="mt-1"><SubmissionId id={submission.id} /></dd>
        </div>
      </dl>

      {#if submission.context.kind === "contest"}
        <p
          class="rounded-md border border-border-subtle bg-muted/30 px-3 py-2 text-body-sm text-muted-foreground"
        >
          {m.submissionDetail_contextContest({ contestTitle: submission.context.contestTitle })}
        </p>
      {:else if submission.context.kind === "assignment" || submission.context.kind === "exam"}
        <dl
          class="flex flex-col gap-3 rounded-md border border-border-subtle bg-muted/30 px-3 py-3"
        >
          <div class="min-w-0">
            <dt class="text-caption text-muted-foreground">{m.submissionDetail_course()}</dt>
            <dd class="mt-0.5 break-words text-body-sm font-medium">
              <a class="hover:underline" href={`/courses/${submission.context.courseId}`}>
                {submission.context.courseTitle}
              </a>
            </dd>
          </div>
          <div class="min-w-0 border-t border-border-subtle pt-3">
            <dt class="text-caption text-muted-foreground">
              {submission.context.kind === "assignment"
                ? m.submissions_kind_assignment()
                : m.submissions_kind_exam()}
            </dt>
            <dd class="mt-0.5 break-words text-body-sm font-medium">
              {#if submission.context.kind === "assignment"}
                <a
                  class="hover:underline"
                  href={`/assignments/${submission.context.assignmentId}`}
                >
                  {submission.context.assignmentTitle}
                </a>
              {:else}
                <a class="hover:underline" href={`/exams/${submission.context.examId}`}>
                  {submission.context.examTitle}
                </a>
              {/if}
            </dd>
          </div>
        </dl>
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
        </div>
      {/if}

      {#if isPending && !executionActive}
        <p
          class="flex flex-col items-center gap-1 rounded-md border border-dashed border-border-strong bg-muted/20 px-3 py-3 text-center text-body-sm text-muted-foreground"
        >
          <span>{m.submissionDetail_judging()}</span>
          <span class="text-caption">{m.submissionDetail_autoRefreshing()}</span>
        </p>
      {:else if result?.feedback}
        <div class="flex flex-col gap-1.5">
          <h2 class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.submissionDetail_feedback()}
          </h2>
          <pre
            class="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-muted/30 px-3 py-2 font-mono text-body-sm text-foreground">{formatJudgeOutput(
              result.feedback,
            )}</pre>
        </div>
      {/if}

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

      {#if subtaskResults.length > 0}
        <div class="flex flex-col gap-2">
          <h2 class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.submissionDetail_subtasks()}
          </h2>
          <SubtaskResultTree {subtaskResults} />
        </div>
      {/if}
    </aside>

    <section
      class="flex h-[60vh] flex-col overflow-hidden rounded-lg border border-border lg:h-[calc(100vh-9rem)] lg:sticky lg:top-4"
    >
      <header
        class="flex items-center justify-between gap-3 border-b border-border-subtle bg-muted/60 px-4 py-2"
      >
        <div class="flex items-center gap-2 text-caption text-muted-foreground">
          <span class="font-medium text-foreground">{languageLabel(submission.language)}</span>
          <span>·</span>
          <span class="tabular-nums"
            >{m.submissionDetail_lineCount({ count: displayLines.length })}</span
          >
        </div>
        <div class="flex items-center gap-1">
          <button
            class="inline-flex size-7 items-center justify-center rounded-md bg-transparent text-muted-foreground transition hover:bg-transparent hover:text-foreground"
            onclick={handleCopy}
            type="button"
            aria-label={copied ? m.common_copied() : m.common_copy()}
            title={copied ? m.common_copied() : m.common_copy()}
          >
            {#if copied}
              <Check aria-hidden="true" class="size-3.5 text-success" />
            {:else}
              <Copy aria-hidden="true" class="size-3.5" />
            {/if}
          </button>
          <button
            class="inline-flex size-7 items-center justify-center rounded-md bg-transparent text-muted-foreground transition hover:bg-transparent hover:text-foreground"
            onclick={handleDownload}
            type="button"
            aria-label={m.submissionDetail_downloadCode()}
            title={m.submissionDetail_downloadCode()}
          >
            <Download aria-hidden="true" class="size-3.5" />
          </button>
        </div>
      </header>
      <div class="min-h-0 flex-1 overflow-hidden">
        <HighlightedCode code={sourceCode} language={submission.language} />
      </div>
    </section>
  </div>
</PageContainer>
