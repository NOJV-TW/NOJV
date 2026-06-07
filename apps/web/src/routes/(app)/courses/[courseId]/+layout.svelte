<script lang="ts">
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import CourseHero from "$lib/components/features/course/CourseHero.svelte";
  import CourseTabBar from "$lib/components/features/course/CourseTabBar.svelte";
  import type { CourseTabKey } from "$lib/components/features/course/CourseTabBar.svelte";
  import type { LayoutData } from "./$types";

  interface Props {
    data: LayoutData;
    children?: Snippet;
  }

  let { data, children }: Props = $props();

  const activeTabKey = $derived<CourseTabKey>(
    deriveActiveTab(page.url.pathname, data.course.id),
  );

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
      case "analytics":
        return "analytics";
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
  {activeTabKey}
  counts={data.counts}
  showAnalytics={data.isManager}
  showSettings={data.isManager}
/>
{@render children?.()}
