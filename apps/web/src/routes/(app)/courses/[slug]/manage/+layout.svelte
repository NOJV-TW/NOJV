<script lang="ts">
  import { page } from "$app/stores";
  import ManageNav from "$lib/components/manage/ManageNav.svelte";

  import type { Snippet } from "svelte";

  interface Props {
    data: { courseRole: string };
    children: Snippet;
  }

  let { data, children }: Props = $props();
  let slug = $derived($page.params.slug ?? "");
</script>

<div class="space-y-6">
  <ManageNav {slug} role={data.courseRole} />
  {@render children()}
</div>
