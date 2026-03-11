<script lang="ts">
  import ManageMembers from "$lib/components/manage/Members.svelte";

  let { data } = $props();
</script>

<ManageMembers
  courseSlug={data.courseSlug}
  courseTitle={data.courseTitle}
  members={data.members}
/>
