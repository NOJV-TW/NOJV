<script lang="ts" module>
  export interface CourseHeroCourse {
    id: string;
    title: string;
    studentCount: number;
    ownerDisplayName?: string;
  }
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import PageHero from "$lib/components/primitives/layout/PageHero.svelte";
  import TeacherBadge from "$lib/components/features/course/TeacherBadge.svelte";

  interface Props {
    course: CourseHeroCourse;
    isManager: boolean;
  }

  let { course, isManager }: Props = $props();
</script>

{#snippet teacherActions()}
  <TeacherBadge role="teacher" />
{/snippet}

{#snippet metaContent()}
  <span>{m.course_studentCount({ count: course.studentCount })}</span>
  {#if course.ownerDisplayName}
    <span
      class="inline-block size-[3px] shrink-0 rounded-full bg-muted-foreground"
      aria-hidden="true"
    ></span>
    <span>{m.course_taughtBy({ name: course.ownerDisplayName })}</span>
  {/if}
{/snippet}

<PageHero
  variant="hub"
  breadcrumbHref="/courses"
  breadcrumbLabel={m.navigation_courses()}
  title={course.title}
  meta={metaContent}
  actions={isManager ? teacherActions : undefined}
/>
