<script lang="ts">
  import { CircleDot, Search, Shield } from "@lucide/svelte";
  import { Button } from "$lib/components/primitives/ui/button";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Input } from "$lib/components/primitives/ui/input";
  import FormField from "$lib/components/primitives/ui/FormField.svelte";
  import { m } from "$lib/paraglide/messages.js";

  interface Props {
    search: string;
    role: string;
    status: string;
    onApply: () => void;
  }

  let {
    search = $bindable(),
    role = $bindable(),
    status = $bindable(),
    onApply,
  }: Props = $props();
</script>

<Card variant="flat" size="md">
  <div class="flex flex-wrap items-end gap-3">
    <div class="min-w-[240px] flex-1">
      <FormField label={m.admin_usersSearch()} for="search">
        <Input
          id="search"
          placeholder={m.admin_usersSearchPlaceholder()}
          type="text"
          bind:value={search}
          onkeydown={(e) => e.key === "Enter" && onApply()}
        />
      </FormField>
    </div>
    <div>
      <label
        class="mb-1.5 inline-flex items-center gap-1 text-body-sm font-medium"
        for="role-filter"
      >
        <Shield aria-hidden="true" class="h-3.5 w-3.5 text-muted-foreground" />
        {m.admin_usersRole()}
      </label>
      <select
        id="role-filter"
        class="flex h-11 w-full min-w-0 rounded-sm border border-input bg-background px-3 py-2 text-body shadow-rest outline-none transition-[border-color,box-shadow] duration-fast ease-out-soft focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        bind:value={role}
        onchange={onApply}
      >
        <option value="">{m.admin_usersAllRoles()}</option>
        <option value="admin">{m.common_roleAdmin()}</option>
        <option value="teacher">{m.common_roleTeacher()}</option>
        <option value="student">{m.common_roleStudent()}</option>
      </select>
    </div>
    <div>
      <label
        class="mb-1.5 inline-flex items-center gap-1 text-body-sm font-medium"
        for="status-filter"
      >
        <CircleDot aria-hidden="true" class="h-3.5 w-3.5 text-muted-foreground" />
        {m.admin_usersStatus()}
      </label>
      <select
        id="status-filter"
        class="flex h-11 w-full min-w-0 rounded-sm border border-input bg-background px-3 py-2 text-body shadow-rest outline-none transition-[border-color,box-shadow] duration-fast ease-out-soft focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        bind:value={status}
        onchange={onApply}
      >
        <option value="">{m.admin_usersAllStatuses()}</option>
        <option value="active">{m.admin_usersStatusActive()}</option>
        <option value="disabled">{m.admin_usersStatusDisabled()}</option>
      </select>
    </div>
    <Button variant="default" type="button" onclick={onApply}>
      <Search aria-hidden="true" class="h-4 w-4" />
      {m.admin_usersSearch()}
    </Button>
  </div>
</Card>
