<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { t } from "svelte-i18n";

  import type { CourseAssessmentRecord } from "$lib/server/course/queries";

  interface Props {
    assessments: CourseAssessmentRecord[];
    courseSlug: string;
    problemSlugs: string[];
  }

  let { assessments, courseSlug, problemSlugs }: Props = $props();

  function toDateTimeLocalValue(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${String(year)}-${month}-${day}T${hours}:${minutes}`;
  }

  function createDefaultAssessmentWindow() {
    const opensAt = new Date();
    const dueAt = new Date(opensAt.getTime() + 1000 * 60 * 60 * 24 * 7);
    const closesAt = new Date(dueAt.getTime() + 1000 * 60 * 60 * 24);
    return {
      closesAt: toDateTimeLocalValue(closesAt),
      dueAt: toDateTimeLocalValue(dueAt),
      opensAt: toDateTimeLocalValue(opensAt)
    };
  }

  const inputClassName =
    "mt-2 w-full rounded-2xl border border-[color:var(--color-border)] bg-white/80 px-3 py-3 text-sm";
  const textareaClassName = `${inputClassName} min-h-24 resize-y`;

  const defaultWindow = createDefaultAssessmentWindow();

  let assessmentTitle = $state("");
  let assessmentSlug = $state("");
  let assessmentType = $state<"assignment" | "exam">("assignment");
  let assessmentSummary = $state("");
  let scoreboardMode = $state<"hidden" | "live" | "frozen">("hidden");
  let problemSlugsText = $state(problemSlugs.join(", "));
  let opensAt = $state(defaultWindow.opensAt);
  let dueAt = $state(defaultWindow.dueAt);
  let closesAt = $state(defaultWindow.closesAt);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);
  let isPublishing = $state(false);

  async function handlePublishAssessment() {
    isPublishing = true;
    error = null;
    status = null;

    try {
      const payload = {
        closesAt: new Date(closesAt).toISOString(),
        dueAt: new Date(dueAt).toISOString(),
        ipLockEnabled: false,
        opensAt: new Date(opensAt).toISOString(),
        pageLockEnabled: false,
        problemSlugs: problemSlugsText
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
        scoreboardMode,
        slug: assessmentSlug,
        summary: assessmentSummary,
        title: assessmentTitle,
        type: assessmentType
      };

      const formData = new FormData();
      formData.set("data", JSON.stringify(payload));

      const response = await fetch("?/create", { method: "POST", body: formData });
      const result = await response.json();

      if (result.type === "failure") {
        throw new Error(result.data?.error ?? "Assessment publish failed.");
      }

      status = `Published ${assessmentTitle}.`;
      void invalidateAll();
    } catch (issue) {
      error = issue instanceof Error ? issue.message : "Assessment publish failed.";
    } finally {
      isPublishing = false;
    }
  }
</script>

<div class="space-y-6">
  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
  >
    <div class="flex items-center justify-between gap-4">
      <h3 class="text-2xl font-semibold">{$t("courseManage.assessments")}</h3>
      <span
        class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
      >
        {assessments.length}
      </span>
    </div>
    <div class="mt-5 grid gap-3">
      {#each assessments as assessment (assessment.slug)}
        <article
          class="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <p
                class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]"
              >
                {assessment.type}
              </p>
              <p class="mt-2 text-lg font-semibold">{assessment.title}</p>
              <p class="mt-2 text-sm text-[color:var(--color-muted)]">
                {assessment.summary}
              </p>
            </div>
            <span
              class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium"
            >
              {assessment.problemSlugs.length} problems
            </span>
          </div>
          <p class="mt-3 text-sm text-[color:var(--color-muted)]">
            {assessment.opensAt.slice(0, 10)} &rarr; {assessment.closesAt.slice(0, 10)}
          </p>
        </article>
      {/each}
    </div>
  </section>

  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-5 py-5"
  >
    <h3 class="text-2xl font-semibold">{$t("courseManage.publishAssessment")}</h3>
    <form
      class="mt-4 grid gap-3"
      onsubmit={(e) => {
        e.preventDefault();
        void handlePublishAssessment();
      }}
    >
      <div class="grid gap-3 md:grid-cols-2">
        <input
          class={inputClassName}
          bind:value={assessmentTitle}
          placeholder="Assessment title"
          required
        />
        <input
          class={inputClassName}
          bind:value={assessmentSlug}
          pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
          placeholder="assessment-slug"
          required
        />
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <select class={inputClassName} bind:value={assessmentType}>
          <option value="assignment">assignment</option>
          <option value="exam">exam</option>
        </select>
        <select class={inputClassName} bind:value={scoreboardMode}>
          <option value="hidden">hidden</option>
          <option value="live">live</option>
          <option value="frozen">frozen</option>
        </select>
      </div>
      <textarea
        class={textareaClassName}
        bind:value={assessmentSummary}
        placeholder="Assessment summary"
        required
      ></textarea>
      <textarea
        class={textareaClassName}
        bind:value={problemSlugsText}
        placeholder="problem-one, problem-two"
        required
      ></textarea>
      <div class="grid gap-3 md:grid-cols-3">
        <input class={inputClassName} bind:value={opensAt} required type="datetime-local" />
        <input class={inputClassName} bind:value={dueAt} required type="datetime-local" />
        <input class={inputClassName} bind:value={closesAt} required type="datetime-local" />
      </div>
      <button
        class="inline-flex w-fit rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={isPublishing}
        type="submit"
      >
        {isPublishing ? $t("common.publishing") : $t("courseManage.publishAssessment")}
      </button>
    </form>
    {#if status}
      <p class="mt-4 text-sm text-emerald-700">{status}</p>
    {/if}
    {#if error}
      <p class="mt-4 text-sm text-red-700">{error}</p>
    {/if}
  </section>
</div>
