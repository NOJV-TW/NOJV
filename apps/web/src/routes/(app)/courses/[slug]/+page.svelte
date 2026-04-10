<script lang="ts">
  import { page } from "$app/stores";
  import { m } from "$lib/paraglide/messages.js";
  import CourseAssessmentBoard from "$lib/components/course/AssessmentBoard.svelte";
  import CourseProblemShelf from "$lib/components/course/ProblemShelf.svelte";
  import CourseJoinPanel from "$lib/components/course/JoinPanel.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import StatCard from "$lib/components/ui/StatCard.svelte";

  let { data } = $props();
  let slug = $derived($page.params.slug);
  let course = $derived(data.courseData.course);
</script>

<div class="space-y-6">
  <section
    class="rounded-2xl border border-border bg-[color:var(--color-panel-strong)] px-6 py-8 shadow-rest backdrop-blur-sm sm:px-8"
  >
    <div class="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <div>
        <div class="flex items-center gap-3">
          <p class="text-body-sm uppercase tracking-[0.18em] text-muted-foreground">
            {m.navigation_courses()} / {course.slug}
          </p>
          <Badge variant="outline" href="/courses/{slug}/manage">
            {m.courses_manageShort()}
          </Badge>
        </div>
        <h2 class="mt-2 font-display text-headline">
          {course.title}
        </h2>
        <p class="mt-4 max-w-3xl text-body leading-7 text-muted-foreground">
          {course.description}
        </p>
      </div>
      <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
        <StatCard label={m.common_members()} value={course.members.length} />
        <StatCard label={m.common_assessments()} value={course.assessments.length} />
        <StatCard label={m.courseDetail_problemPool()} value={course.problemIds.length} />
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
