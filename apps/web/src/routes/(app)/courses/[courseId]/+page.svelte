<script lang="ts">
  import {
    CalendarClock,
    ChevronRight,
    ClipboardList,
    Megaphone,
    Pencil,
    Pin,
    Plus,
    Trash2
  } from "@lucide/svelte";
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Button } from "$lib/components/primitives/ui/button";
  import ConfirmDialog from "$lib/components/primitives/ui/ConfirmDialog.svelte";
  import CourseAnnouncementDialog from "$lib/components/features/course/CourseAnnouncementDialog.svelte";
  import AnnouncementViewDialog from "$lib/components/features/announcement/AnnouncementViewDialog.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { formatDate, formatTimeRangeCompact } from "$lib/utils/datetime";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { course, isManager, announcements, assignments, exams } = $derived(data);

  type AnnouncementRow = (typeof announcements)[number];

  let dialogOpen = $state(false);
  let dialogMode = $state<"create" | "edit">("create");
  let dialogInitial = $state<AnnouncementRow | null>(null);
  let pendingDeleteId = $state<string | null>(null);
  let viewingAnnouncement = $state<AnnouncementRow | null>(null);
  let viewOpen = $state(false);

  function openView(announcement: AnnouncementRow) {
    viewingAnnouncement = announcement;
    viewOpen = true;
  }

  function openCreate() {
    dialogMode = "create";
    dialogInitial = null;
    dialogOpen = true;
  }

  function openEdit(announcement: AnnouncementRow) {
    dialogMode = "edit";
    dialogInitial = announcement;
    dialogOpen = true;
  }

  let deleteFormEl: HTMLFormElement | undefined = $state();
  function confirmDelete() {
    deleteFormEl?.requestSubmit();
  }

  function assignmentStatusBadge(
    status: "draft" | "upcoming" | "open" | "closed"
  ): { variant: "default" | "info" | "muted"; label: string; dot: boolean } {
    switch (status) {
      case "open":
        return { variant: "default", label: m.courseOverview_statusOpen(), dot: true };
      case "upcoming":
        return { variant: "info", label: m.courseOverview_statusUpcoming(), dot: true };
      case "draft":
        return { variant: "muted", label: m.courseOverview_statusDraftTaVisible(), dot: false };
      case "closed":
      default:
        return { variant: "muted", label: m.courseOverview_statusClosed(), dot: false };
    }
  }

  function examStatusBadge(
    status: "draft" | "upcoming" | "running" | "ended"
  ): { variant: "default" | "info" | "muted"; label: string; dot: boolean } {
    switch (status) {
      case "running":
        return { variant: "default", label: m.courseOverview_examStatusRunning(), dot: true };
      case "upcoming":
        return { variant: "info", label: m.courseOverview_statusUpcoming(), dot: true };
      case "draft":
        return { variant: "muted", label: m.courseOverview_statusDraftTaVisible(), dot: false };
      case "ended":
      default:
        return { variant: "muted", label: m.courseOverview_examStatusEnded(), dot: false };
    }
  }

  function scoringLabel(mode: "point_sum" | "problem_count"): string {
    return mode === "problem_count"
      ? m.courseOverview_scoringProblemCount()
      : m.courseOverview_scoringPointSum();
  }
</script>

<PageContainer class="grid gap-10 lg:grid-cols-[2fr_3fr]">
  
  <section class="animate-in animate-in-1">
    <header class="mb-4 flex items-center justify-between gap-4">
      <h2
        class="flex items-center gap-2.5 text-title font-medium tracking-[-0.01em]"
      >
        <span class="text-primary" aria-hidden="true">
          <Megaphone aria-hidden="true" class="h-5 w-5" />
        </span>
        {m.courseOverview_announcementsHeading()}
      </h2>
      {#if isManager}
        <Button
          variant="outline"
          size="sm"
          onclick={openCreate}
        >
          <Plus aria-hidden="true" class="h-4 w-4" />
          {m.courseOverview_newAnnouncement()}
        </Button>
      {/if}
    </header>

    {#if announcements.length === 0}
      <div
        class="rounded-xl border border-dashed border-border px-6 py-8 text-center text-body-sm text-muted-foreground"
      >
        {m.courseOverview_noAnnouncements()}
      </div>
    {:else}
      <div class="space-y-3">
        {#each announcements as announcement (announcement.id)}
          <div
            class="cursor-pointer rounded-md border border-border bg-[color:var(--color-panel-strong)] px-4 py-3 backdrop-blur-sm transition-colors duration-fast ease-out-soft hover:bg-accent/40"
            onclick={() => openView(announcement)}
            onkeydown={(e) => {
              if (e.currentTarget !== e.target) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openView(announcement);
              }
            }}
            role="button"
            tabindex="0"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <h3 class="flex items-center gap-1.5 text-body-sm font-semibold text-foreground">
                  {#if announcement.pinned}
                    <Pin aria-hidden="true"
                      class="size-3.5 shrink-0 text-warning"
                      aria-label={m.admin_announcementsPinned()}
                    />
                  {/if}
                  <span class="truncate">{announcement.title}</span>
                </h3>
                {#if announcement.content}
                  <p class="mt-1 line-clamp-2 text-body-sm text-muted-foreground">
                    {announcement.content}
                  </p>
                {/if}
              </div>
              <div class="flex shrink-0 flex-col items-end gap-2">
                <time
                  class="text-caption text-muted-foreground tabular-nums"
                  datetime={announcement.createdAt}
                >
                  {formatDate(announcement.createdAt)}
                </time>
                {#if isManager}
                  <div
                    class="flex items-center gap-1"
                    onclick={(e) => e.stopPropagation()}
                    role="presentation"
                  >
                    <form
                      method="POST"
                      action="?/togglePinAnnouncement"
                      use:enhance={() => {
                        return async ({ result }) => {
                          if (result.type === "success" || result.type === "redirect") {
                            await invalidateAll();
                          }
                        };
                      }}
                    >
                      <input type="hidden" name="id" value={announcement.id} />
                      <button
                        type="submit"
                        class="inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors duration-fast ease-out-soft {announcement.pinned
                          ? 'border-warning bg-warning/10 text-warning hover:bg-warning/15'
                          : 'border-border bg-[color:var(--color-panel)] text-muted-foreground hover:border-border-strong hover:text-foreground'}"
                        title={announcement.pinned
                          ? m.admin_announcementsUnpin()
                          : m.admin_announcementsPin()}
                        aria-label={announcement.pinned
                          ? m.admin_announcementsUnpin()
                          : m.admin_announcementsPin()}
                        aria-pressed={announcement.pinned}
                      >
                        <Pin aria-hidden="true" class="h-3.5 w-3.5" />
                      </button>
                    </form>
                    <button
                      type="button"
                      class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-[color:var(--color-panel)] text-muted-foreground transition-colors duration-fast ease-out-soft hover:border-border-strong hover:text-foreground"
                      title={m.courseOverview_editAnnouncement()}
                      aria-label={m.courseOverview_editAnnouncement()}
                      onclick={() => openEdit(announcement)}
                    >
                      <Pencil aria-hidden="true" class="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-[color:var(--color-panel)] text-muted-foreground transition-colors duration-fast ease-out-soft hover:border-destructive hover:text-destructive"
                      title={m.common_delete()}
                      aria-label={m.common_delete()}
                      onclick={() => (pendingDeleteId = announcement.id)}
                    >
                      <Trash2 aria-hidden="true" class="h-3.5 w-3.5" />
                    </button>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <div class="space-y-10">
    
    <section class="animate-in animate-in-2">
    <header class="mb-4 flex items-center justify-between gap-4">
      <h2
        class="flex items-center gap-2.5 text-title font-medium tracking-[-0.01em]"
      >
        <span class="text-primary" aria-hidden="true">
          <ClipboardList aria-hidden="true" class="h-5 w-5" />
        </span>
        {m.courseOverview_assignmentsHeading()}
      </h2>
      <div class="flex items-center gap-3">
        {#if isManager}
          <Button
            variant="outline"
            size="sm"
            href={`/courses/${course.id}/assignments/new`}
          >
            <Plus aria-hidden="true" class="h-4 w-4" />
            {m.courseOverview_newAssignment()}
          </Button>
        {/if}
        <a
          href={`/courses/${course.id}/assignments`}
          class="text-body-sm text-muted-foreground transition-colors duration-fast hover:text-foreground"
        >
          {m.courseOverview_viewAll()}
        </a>
      </div>
    </header>

    {#if assignments.length === 0}
      <div
        class="rounded-xl border border-dashed border-border px-6 py-8 text-center text-body-sm text-muted-foreground"
      >
        {m.courseOverview_noAssignments()}
      </div>
    {:else}
      <div class="grid gap-3">
        {#each assignments as assignment (assignment.id)}
          {@const badge = assignmentStatusBadge(assignment.status)}
          <a
            href={`/assignments/${assignment.id}`}
            class="grid grid-cols-[1fr_auto_auto] items-center gap-6 rounded-xl border bg-[color:var(--color-panel)] px-6 py-4 text-foreground no-underline transition-[transform,box-shadow,border-color] duration-fast ease-out-soft hover:translate-x-[3px] hover:border-border-strong hover:shadow-rest {assignment.status ===
            'draft'
              ? 'border-dashed bg-transparent'
              : 'border-border'}"
          >
            <div class="min-w-0">
              <div class="font-semibold tracking-[-0.005em]">{assignment.title}</div>
              <div
                class="mt-1.5 flex items-center gap-2.5 font-mono text-caption text-muted-foreground tabular-nums"
              >
                {#if assignment.opensAt && assignment.closesAt}
                  <span>{formatTimeRangeCompact(assignment.opensAt, assignment.closesAt)}</span>
                {:else}
                  <span class="opacity-60">{m.courseOverview_draftNoSchedule()}</span>
                {/if}
              </div>
              <div
                class="mt-2 flex items-center gap-3 text-caption text-muted-foreground"
              >
                {#if isManager}
                  <span
                    >{m.courseOverview_problemCount({ count: assignment.problemCount })}</span
                  >
                  <span
                    class="inline-block h-[3px] w-[3px] rounded-full bg-muted-foreground"
                    aria-hidden="true"
                  ></span>
                {/if}
                <Badge variant={badge.variant} dot={badge.dot} size="sm">{badge.label}</Badge>
              </div>
            </div>
            
            <div class="text-right font-mono text-caption text-muted-foreground tabular-nums">
              {#if assignment.status === "draft"}
                <span class="block text-body-lg font-medium text-foreground">—</span>
                {m.courseOverview_classStatsDraftHint()}
              {:else if assignment.status === "upcoming"}
                <span class="block text-body-lg font-medium text-foreground">—</span>
                {m.courseOverview_classStatsUpcomingHint()}
              {:else if isManager && assignment.classStats}
                <span class="block text-body-lg font-medium text-foreground">
                  {assignment.classStats.submittedUsers}/{assignment.classStats.totalStudents}
                </span>
                {m.courseOverview_avgScore({ score: assignment.classStats.avgScore })}
              {:else if !isManager && assignment.myStatus}
                <span class="block text-body-lg font-medium text-foreground">
                  {assignment.myStatus.score}/{assignment.myStatus.totalPoints}
                </span>
                {m.courseOverview_scoreCaption()}
              {:else}
                <span class="block text-body-lg font-medium text-foreground">—</span>
              {/if}
            </div>
            <ChevronRight
              class="h-5 w-5 text-muted-foreground"
              aria-hidden="true"
            />
          </a>
        {/each}
      </div>
    {/if}
  </section>

  
  <section class="animate-in animate-in-3">
    <header class="mb-4 flex items-center justify-between gap-4">
      <h2
        class="flex items-center gap-2.5 text-title font-medium tracking-[-0.01em]"
      >
        <span class="text-primary" aria-hidden="true">
          <CalendarClock aria-hidden="true" class="h-5 w-5" />
        </span>
        {m.courseOverview_examsHeading()}
      </h2>
      <div class="flex items-center gap-3">
        {#if isManager}
          <Button
            variant="outline"
            size="sm"
            href={`/courses/${course.id}/exams/new`}
          >
            <Plus aria-hidden="true" class="h-4 w-4" />
            {m.courseOverview_newExam()}
          </Button>
        {/if}
        <a
          href={`/courses/${course.id}/exams`}
          class="text-body-sm text-muted-foreground transition-colors duration-fast hover:text-foreground"
        >
          {m.courseOverview_viewAll()}
        </a>
      </div>
    </header>

    {#if exams.length === 0}
      <div
        class="rounded-xl border border-dashed border-border px-6 py-8 text-center text-body-sm text-muted-foreground"
      >
        {m.courseOverview_noExams()}
      </div>
    {:else}
      <div class="grid gap-3">
        {#each exams as exam (exam.id)}
          {@const badge = examStatusBadge(exam.status)}
          <a
            href={`/exams/${exam.id}`}
            class="grid grid-cols-[1fr_auto_auto] items-center gap-6 rounded-xl border bg-[color:var(--color-panel)] px-6 py-4 text-foreground no-underline transition-[transform,box-shadow,border-color] duration-fast ease-out-soft hover:translate-x-[3px] hover:border-border-strong hover:shadow-rest {exam.status ===
            'draft'
              ? 'border-dashed bg-transparent'
              : 'border-border'}"
          >
            <div class="min-w-0">
              <div class="font-semibold tracking-[-0.005em]">{exam.title}</div>
              <div
                class="mt-1.5 flex items-center gap-2.5 font-mono text-caption text-muted-foreground tabular-nums"
              >
                {#if exam.startsAt && exam.endsAt}
                  <span>{formatTimeRangeCompact(exam.startsAt, exam.endsAt)}</span>
                  {#if exam.durationMinutes !== null}
                    <span class="opacity-60">·</span>
                    <span
                      >{m.courseOverview_durationMinutes({
                        count: exam.durationMinutes
                      })}</span
                    >
                  {/if}
                {:else}
                  <span class="opacity-60">{m.courseOverview_draftNoSchedule()}</span>
                {/if}
              </div>
              <div
                class="mt-2 flex items-center gap-3 text-caption text-muted-foreground"
              >
                <span>
                  {#if isManager}
                    {m.courseOverview_problemCount({ count: exam.problemCount })} ·
                  {/if}
                  {scoringLabel(exam.scoringMode)}
                </span>
                <span
                  class="inline-block h-[3px] w-[3px] rounded-full bg-muted-foreground"
                  aria-hidden="true"
                ></span>
                <Badge variant={badge.variant} dot={badge.dot} size="sm">{badge.label}</Badge>
              </div>
            </div>
            <div class="text-right font-mono text-caption text-muted-foreground tabular-nums">
              {#if isManager && exam.registeredCount !== null && exam.totalStudents !== null}
                <span
                  class="block text-body-lg font-medium text-foreground"
                >
                  {exam.registeredCount}/{exam.totalStudents}
                </span>
                {m.courseOverview_registered()}
              {:else if !isManager && exam.myStatus}
                <span class="block text-body-lg font-medium text-foreground">
                  {exam.myStatus.score}/{exam.myStatus.totalPoints}
                </span>
                {m.courseOverview_scoreCaption()}
              {:else}
                <span
                  class="block text-body-lg font-medium text-foreground"
                >
                  —
                </span>
                {#if exam.status === "upcoming"}
                  {m.courseOverview_examUpcomingHint()}
                {:else if exam.status === "running"}
                  {m.courseOverview_examRunningHint()}
                {:else if exam.status === "draft"}
                  {m.courseOverview_classStatsDraftHint()}
                {:else}
                  {m.courseOverview_examEndedHint()}
                {/if}
              {/if}
            </div>
            <ChevronRight
              class="h-5 w-5 text-muted-foreground"
              aria-hidden="true"
            />
          </a>
        {/each}
      </div>
    {/if}
  </section>
  </div>
</PageContainer>

<AnnouncementViewDialog bind:open={viewOpen} announcement={viewingAnnouncement} />

{#if isManager}
  <CourseAnnouncementDialog
    bind:open={dialogOpen}
    mode={dialogMode}
    initial={dialogInitial}
  />

  <form
    bind:this={deleteFormEl}
    method="POST"
    action="?/deleteAnnouncement"
    use:enhance={() => {
      return async ({ result }) => {
        pendingDeleteId = null;
        if (result.type === "success" || result.type === "redirect") {
          await invalidateAll();
        }
      };
    }}
    class="hidden"
  >
    <input type="hidden" name="id" value={pendingDeleteId ?? ""} />
  </form>

  <ConfirmDialog
    open={pendingDeleteId !== null}
    title={m.common_delete()}
    message={m.admin_announcementsDeleteConfirm()}
    confirmText={m.common_delete()}
    variant="danger"
    onconfirm={confirmDelete}
    oncancel={() => (pendingDeleteId = null)}
  />
{/if}
