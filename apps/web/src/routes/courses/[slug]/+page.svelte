<script lang="ts">
  import { page } from "$app/stores";
  import { t } from "svelte-i18n";
  import CourseAssessmentBoard from "$lib/components/course/AssessmentBoard.svelte";
  import CourseProblemShelf from "$lib/components/course/ProblemShelf.svelte";
  import CourseJoinPanel from "$lib/components/course/JoinPanel.svelte";

  let { data } = $props();
  let slug = $derived(($page.params as { slug: string }).slug);
  let course = $derived(data.courseData.course);
</script>

<div class="space-y-6">
  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-gradient-to-br from-white/90 to-stone-50/80 px-6 py-8 sm:px-8"
  >
    <div class="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <div>
        <div class="flex items-center gap-3">
          <p class="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
            {$t("navigation.courses")} / {course.slug}
          </p>
          <a
            class="rounded-full border border-[color:var(--color-border)] px-3 py-1 text-xs font-medium transition hover:-translate-y-0.5"
            href="/courses/{slug}/manage"
          >
            Manage &rarr;
          </a>
        </div>
        <h2 class="mt-2 font-[family-name:var(--font-display)] text-4xl">
          {course.title}
        </h2>
        <p class="mt-4 max-w-3xl text-base leading-7 text-[color:var(--color-muted)]">
          {course.description}
        </p>
      </div>
      <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
        <div
          class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
        >
          <p class="text-sm text-[color:var(--color-muted)]">{$t("common.members")}</p>
          <p class="mt-2 text-lg font-semibold">{course.members.length}</p>
        </div>
        <div
          class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
        >
          <p class="text-sm text-[color:var(--color-muted)]">{$t("common.assessments")}</p>
          <p class="mt-2 text-lg font-semibold">{course.assessments.length}</p>
        </div>
        <div
          class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
        >
          <p class="text-sm text-[color:var(--color-muted)]">{$t("courseDetail.problemPool")}</p>
          <p class="mt-2 text-lg font-semibold">{course.problemSlugs.length}</p>
        </div>
      </div>
    </div>
  </section>

  <section class="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
    <div class="space-y-6">
      <CourseAssessmentBoard assessments={course.assessments} courseSlug={course.slug} />
      <CourseProblemShelf
        courseSlug={course.slug}
        problems={data.courseData.problems}
      />
    </div>
    <div class="space-y-6">
      <CourseJoinPanel courseSlug={course.slug} joinChannels={course.joinChannels} />
    </div>
  </section>
</div>
