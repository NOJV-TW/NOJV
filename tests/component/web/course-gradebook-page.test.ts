import { mount, tick, unmount } from "svelte";
import { expect, it } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import GradesPage from "../../../apps/web/src/routes/(app)/courses/[courseId]/grades/+page.svelte";

it("keeps a withheld activity column aligned without problem headings", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(GradesPage, {
    target,
    props: {
      data: {
        isManager: false,
        course: { id: "course_1", title: "Course" },
        gradebook: {
          maxTotal: 200,
          columns: [
            {
              contextType: "assignment",
              contextId: "a1",
              contextTitle: "HW 1",
              maxTotal: 100,
              problems: [
                { problemId: "p1", ordinal: 1, title: "Open", maxScore: 100, rawMaxScore: 100 },
              ],
            },
            {
              contextType: "exam",
              contextId: "e1",
              contextTitle: "Final",
              maxTotal: 100,
              problems: [],
            },
          ],
          rows: [
            {
              membershipId: "m1",
              userId: "u1",
              name: "Alice",
              username: "alice",
              cells: { "assignment:a1:p1": 80 },
              total: 80,
            },
          ],
        },
      } as never,
    },
  });
  try {
    await tick();
    const [contexts, problems] = target.querySelectorAll("thead tr");
    expect(contexts!.querySelectorAll("th")[2]?.getAttribute("colspan")).toBe("1");
    expect(problems!.querySelectorAll("th")).toHaveLength(2);
    expect(problems!.textContent).toContain(m.courseGradebook_notYetOpen());
    const cells = target.querySelectorAll("tbody tr td");
    expect(cells).toHaveLength(4);
    expect(cells[2]?.textContent?.trim()).toBe("—");
  } finally {
    await unmount(component);
    target.remove();
  }
});
