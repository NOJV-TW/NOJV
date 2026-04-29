<script lang="ts">
  import { page } from "$app/state";
  import CourseHero from "$lib/components/course/CourseHero.svelte";
  import CourseTabBar from "$lib/components/course/CourseTabBar.svelte";
  import type { CourseTabKey } from "$lib/components/course/CourseTabBar.svelte";
  import type { LayoutData } from "./$types";

  interface Props {
    data: LayoutData;
    children?: import("svelte").Snippet;
  }

  let { data, children }: Props = $props();

  const active = $derived<CourseTabKey>(deriveActiveTab(page.url.pathname, data.course.id));

  function deriveActiveTab(pathname: string, courseId: string): CourseTabKey {
    const prefix = `/courses/${courseId}`;
    if (!pathname.startsWith(prefix)) return "overview";
    const rest = pathname.slice(prefix.length).replace(/^\/+/, "");
    if (rest === "") return "overview";
    const first = rest.split("/", 1)[0];
    switch (first) {
      case "assignments":
        return "assignments";
      case "exams":
        return "exams";
      case "members":
        return "members";
      case "settings":
        return "settings";
      default:
        return "overview";
    }
  }
</script>

<CourseHero course={data.course} isManager={data.isManager} />
<CourseTabBar
  courseId={data.course.id}
  {active}
  counts={data.counts}
  showSettings={data.isManager}
/>
{@render children?.()}
