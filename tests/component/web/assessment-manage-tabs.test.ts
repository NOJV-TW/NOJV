import { createRawSnippet, mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import AssessmentManageTabs from "$lib/components/features/coursework/AssessmentManageTabs.svelte";

const mocks = vi.hoisted(() => ({ goto: vi.fn().mockResolvedValue(undefined) }));
vi.mock("$app/navigation", () => ({ goto: mocks.goto }));

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;
beforeEach(() => {
  target = document.body.appendChild(document.createElement("div"));
  vi.clearAllMocks();
});
afterEach(async () => {
  if (component) await unmount(component);
  target.remove();
});

it.each(["assignment", "exam"] as const)(
  "groups shared %s views with settings last",
  async (kind) => {
    component = mount(AssessmentManageTabs, {
      target,
      props: {
        kind,
        value: "audit",
        url: new URL(`https://nojv.test/${kind}s/example?tab=audit&view=compact`),
        canViewClarifications: true,
        children: createRawSnippet(() => ({ render: () => "<p>Audit entries</p>" })),
      },
    });
    await tick();

    const tabs = [...target.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      m.assessmentNav_problems(),
      m.assessmentNav_submissions(),
      m.assessmentNav_results(),
      ...(kind === "exam" ? [m.examDetail_subTabProctoring()] : []),
      m.clarification_tab_title(),
      m.assessmentNav_settings(),
    ]);
    expect(target.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe(
      `${kind}-manage-tab-results`,
    );
    const links = [...target.querySelectorAll<HTMLAnchorElement>("nav a")];
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      m.assessmentNav_grades(),
      m.assessmentNav_plagiarism(),
      m.assessmentNav_audit(),
    ]);
    expect(links[2]?.getAttribute("aria-current")).toBe("page");
    expect(target.querySelector('[role="tabpanel"]')?.textContent).toContain("Audit entries");
    links[1]!.click();
    expect(mocks.goto).toHaveBeenCalledWith(`/${kind}s/example?tab=plagiarism&view=compact`, {
      keepFocus: true,
      noScroll: true,
      replaceState: true,
    });

    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(mocks.goto).toHaveBeenLastCalledWith(
      `/${kind}s/example?tab=settings&view=compact`,
      expect.any(Object),
    );
    expect(document.activeElement?.id).toBe(`${kind}-manage-tab-settings`);
  },
);

it("hides unavailable clarifications and opens the exam roster from Proctoring", async () => {
  component = mount(AssessmentManageTabs, {
    target,
    props: {
      kind: "exam",
      value: "credentials",
      url: new URL("https://nojv.test/exams/example?tab=credentials"),
      canViewClarifications: false,
      children: createRawSnippet(() => ({ render: () => "<p>Student roster</p>" })),
    },
  });
  await tick();
  expect(target.querySelector("#exam-manage-tab-clarifications")).toBeNull();
  expect([...target.querySelectorAll("nav a")].map((link) => link.textContent?.trim())).toEqual(
    [m.examCredentials_tab(), m.examCredentials_ipRecords()],
  );
  target.querySelector<HTMLAnchorElement>('a[href$="tab=proctoring"]')!.click();
  expect(mocks.goto).toHaveBeenCalledWith("/exams/example?tab=proctoring", expect.any(Object));
  const modifiedClick = new MouseEvent("click", {
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  let preventedByNavigation: boolean | undefined;
  document.addEventListener(
    "click",
    (event) => {
      preventedByNavigation = event.defaultPrevented;
      event.preventDefault();
    },
    { once: true },
  );
  target
    .querySelector<HTMLAnchorElement>('a[href$="tab=proctoring"]')!
    .dispatchEvent(modifiedClick);
  expect(preventedByNavigation).toBe(false);
  expect(mocks.goto).toHaveBeenCalledTimes(1);
});
