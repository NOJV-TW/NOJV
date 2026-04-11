<script lang="ts">
  import { browser } from "$app/environment";
  import {
    BarChart3,
    BookOpen,
    ClipboardList,
    GraduationCap,
    Languages,
    LayoutDashboard,
    ListChecks,
    Plus,
    Users
  } from "@lucide/svelte";
  import { onMount, untrack } from "svelte";
  import { superForm } from "sveltekit-superforms";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import Section from "$lib/components/ui/Section.svelte";
  import StatCard from "$lib/components/ui/StatCard.svelte";
  import EmptyState from "$lib/components/ui/EmptyState.svelte";

  let { data }: { data: any } = $props();

  let canCreate = $derived(
    data.user?.platformRole === "admin" || data.user?.platformRole === "teacher"
  );

  type UiLang = "zh" | "en";
  let uiLang = $state<UiLang>("zh");

  const text = {
    en: {
      acceptedRate: "AC rate",
      action: "Action",
      activeAssessments: "Active assessments",
      assessments: "Assessments",
      course: "Course",
      crossCourseHealth: "Cross-course teaching health",
      dashboard: "Dashboard",
      english: "English",
      hotAssessments: "Most active assessments",
      openAnalytics: "Open analytics",
      progress: "Progress",
      staffShortcuts: "Staff shortcuts",
      students: "Students",
      submissions: "Submissions",
      systemText: "System Text",
      teacherDashboard: "Teacher Dashboard",
      weekPulse: "Last 7 days operational pulse",
      zh: "中文"
    },
    zh: {
      acceptedRate: "通過率",
      action: "操作",
      activeAssessments: "進行中評量",
      assessments: "評量",
      course: "課程",
      crossCourseHealth: "跨課程教學健康度",
      dashboard: "儀表板",
      english: "English",
      hotAssessments: "高活躍評量",
      openAnalytics: "開啟分析",
      progress: "進度",
      staffShortcuts: "教職捷徑",
      students: "學生",
      submissions: "提交",
      systemText: "系統文字",
      teacherDashboard: "教師儀表板",
      weekPulse: "最近 7 天營運脈動",
      zh: "中文"
    }
  } as const;

  function t<K extends keyof (typeof text)["en"]>(key: K): string {
    return text[uiLang][key];
  }

  onMount(() => {
    if (!browser) return;
    const saved = localStorage.getItem("nojv-system-text-lang");
    if (saved === "zh" || saved === "en") {
      uiLang = saved;
    }
  });

  function setUiLang(next: UiLang): void {
    uiLang = next;
    if (browser) {
      localStorage.setItem("nojv-system-text-lang", next);
    }
  }

  let showCreateForm = $state(false);

  const { form, errors, submitting, message: formMessage, enhance } = superForm(untrack(() => data.form), {
    invalidateAll: true
  });
</script>

<Section class="space-y-6">
  {#snippet header()}
    <h1 class="font-display text-title-lg">{m.navigation_courses()}</h1>
  {/snippet}
  {#snippet actions()}
    {#if canCreate}
      <Button onclick={() => (showCreateForm = !showCreateForm)}>
        <Plus class="h-4 w-4" />
        {m.admin_createCourseButton()}
      </Button>
    {/if}
  {/snippet}

  {#if canCreate && data.teacherOverview}
    <section
      class="rounded-3xl border border-border bg-[color:var(--color-panel)] px-5 py-5 shadow-rest backdrop-blur-sm"
    >
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="inline-flex items-center gap-1 text-caption uppercase tracking-[0.18em] text-muted-foreground">
            <LayoutDashboard class="h-3.5 w-3.5" /> {t("teacherDashboard")}
          </p>
          <h3 class="mt-2 text-title-sm font-semibold">{t("crossCourseHealth")}</h3>
        </div>
        <div class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 p-1">
          <span class="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground">
            <Languages class="h-3.5 w-3.5" /> {t("systemText")}
          </span>
          <button
            type="button"
            class="rounded-full px-3 py-1 text-xs font-medium {uiLang === 'zh' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}"
            onclick={() => setUiLang("zh")}
          >
            {t("zh")}
          </button>
          <button
            type="button"
            class="rounded-full px-3 py-1 text-xs font-medium {uiLang === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}"
            onclick={() => setUiLang("en")}
          >
            {t("english")}
          </button>
        </div>
      </div>
      <p class="mt-1 text-caption text-muted-foreground">{t("weekPulse")}</p>

      <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label={m.navigation_courses()} value={data.teacherOverview.managedCourses} icon={BookOpen} />
        <StatCard label={t("students")} value={data.teacherOverview.totalStudents} icon={Users} />
        <StatCard label={t("activeAssessments")} value={data.teacherOverview.activeAssessments} icon={ClipboardList} />
        <StatCard label={t("submissions")} value={`${data.teacherOverview.submissions7d} / 7d`} icon={BarChart3} />
        <StatCard label={t("acceptedRate")} value={`${data.teacherOverview.acceptedRate7d}%`} icon={ListChecks} />
      </div>

      {#if data.teacherOverview.hottestAssessments.length > 0}
        <p class="mt-4 text-caption font-medium uppercase tracking-wider text-muted-foreground">{t("hotAssessments")}</p>
        <div class="mt-4 overflow-x-auto rounded-xl border border-border-subtle">
          <table class="w-full text-body-sm">
            <thead>
              <tr class="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th class="px-3 py-2">{t("course")}</th>
                <th class="px-3 py-2">{t("assessments")}</th>
                <th class="px-3 py-2 text-center">{t("submissions")}</th>
                <th class="px-3 py-2 text-center">{t("acceptedRate")}</th>
                <th class="px-3 py-2">{t("action")}</th>
              </tr>
            </thead>
            <tbody>
              {#each data.teacherOverview.hottestAssessments as row (row.courseSlug + row.assessmentSlug)}
                <tr class="border-b border-border last:border-b-0">
                  <td class="px-3 py-2">
                    <a class="font-medium hover:underline" href="/courses/{row.courseSlug}">{row.courseTitle}</a>
                  </td>
                  <td class="px-3 py-2">{row.assessmentTitle}</td>
                  <td class="px-3 py-2 text-center">{row.submissionCount}</td>
                  <td class="px-3 py-2 text-center">{row.acceptedRate}%</td>
                  <td class="px-3 py-2 text-xs">
                    <a class="text-primary hover:underline" href="/courses/{row.courseSlug}/manage/progress?assessment={row.assessmentSlug}">
                      {t("openAnalytics")}
                    </a>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/if}

  {#if canCreate && showCreateForm}
    <section
      class="rounded-3xl border border-border bg-[color:var(--color-panel)] px-5 py-5 shadow-rest backdrop-blur-sm"
    >
      <h3 class="text-title-sm font-semibold">{m.admin_createCourse()}</h3>
      <p class="mt-1 text-body-sm text-muted-foreground">
        {m.admin_createCourseSubtitle()}
      </p>
      <form
        class="mt-4 grid gap-3"
        method="POST"
        action="?/create"
        use:enhance
      >
        <div>
          <label class="text-body-sm font-medium" for="course-title">{m.admin_title()}</label>
          <input
            class="mt-2 w-full rounded-lg border border-border bg-[color:var(--color-panel)] px-3 py-3 text-body-sm"
            id="course-title"
            name="title"
            bind:value={$form.title}
            required
          />
          {#if $errors.title}<span class="text-body-sm text-destructive">{$errors.title}</span>{/if}
        </div>
        <div>
          <label class="text-body-sm font-medium" for="course-slug">{m.admin_slug()}</label>
          <input
            class="mt-2 w-full rounded-lg border border-border bg-[color:var(--color-panel)] px-3 py-3 text-body-sm"
            id="course-slug"
            name="slug"
            bind:value={$form.slug}
            pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
            placeholder="my-course"
            required
          />
          {#if $errors.slug}<span class="text-body-sm text-destructive">{$errors.slug}</span>{/if}
        </div>
        <div>
          <label class="text-body-sm font-medium" for="course-description">{m.admin_description()}</label>
          <textarea
            class="mt-2 w-full rounded-lg border border-border bg-[color:var(--color-panel)] px-3 py-3 text-body-sm"
            id="course-description"
            name="description"
            bind:value={$form.description}
            rows="3"
            required
          ></textarea>
          {#if $errors.description}<span class="text-body-sm text-destructive">{$errors.description}</span>{/if}
        </div>
        <div>
          <label class="text-body-sm font-medium" for="course-locale">{m.admin_locale()}</label>
          <select
            class="mt-2 w-full rounded-lg border border-border bg-[color:var(--color-panel)] px-3 py-3 text-body-sm"
            id="course-locale"
            name="locale"
            bind:value={$form.locale}
          >
            <option value="zh-TW">zh-TW</option>
            <option value="en">en</option>
          </select>
        </div>
        <Button type="submit" disabled={$submitting} loading={$submitting} class="w-fit">
          {$submitting ? m.common_creating() : m.admin_createCourseButton()}
        </Button>
      </form>
      {#if $formMessage}
        <p class="mt-4 text-body-sm text-success">{$formMessage}</p>
      {/if}
    </section>
  {/if}

  {#if data.courses.length === 0}
    <EmptyState
      variant="onboarding"
      icon={GraduationCap}
      title={m.courses_emptyTitle()}
      description={m.courses_emptyDescription()}
      actions={canCreate ? [{ href: "#", label: m.admin_createCourseButton() }] : []}
    />
  {:else}
    <section class="grid gap-4 lg:grid-cols-2">
      {#each data.courses as course (course.slug)}
        <article
          class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-6 py-6 shadow-rest backdrop-blur-sm transition-[transform,box-shadow,background-color] duration-fast ease-out-soft hover:-translate-y-0.5 hover:shadow-hover"
        >
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-body-sm uppercase tracking-[0.18em] text-muted-foreground">
                {m.courseDetail_course()}
              </p>
              <h3 class="mt-2 text-title font-semibold">
                <a href="/courses/{course.slug}" class="hover:underline">{course.title}</a>
              </h3>
            </div>
            <Badge variant="outline">{m.courseDetail_rbacEnabled()}</Badge>
          </div>
          <dl class="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <dt class="text-body-sm text-muted-foreground">{m.common_members()}</dt>
              <dd class="mt-1 text-body-lg font-semibold tabular-nums">{course.memberCount}</dd>
            </div>
            <div>
              <dt class="text-body-sm text-muted-foreground">{m.common_assessments()}</dt>
              <dd class="mt-1 text-body-lg font-semibold tabular-nums">{course.assessmentCount}</dd>
            </div>
          </dl>

          {#if canCreate}
            <div class="mt-4 flex flex-wrap gap-3 text-body-sm">
              <span class="text-muted-foreground">{t("staffShortcuts")}:</span>
              <a class="text-primary hover:underline" href="/courses/{course.slug}/manage">
                {t("dashboard")}
              </a>
              <a class="text-primary hover:underline" href="/courses/{course.slug}/manage/assessments">
                {t("assessments")}
              </a>
              <a class="text-primary hover:underline" href="/courses/{course.slug}/manage/progress">
                {t("progress")}
              </a>
            </div>
          {/if}
        </article>
      {/each}
    </section>
  {/if}
</Section>
