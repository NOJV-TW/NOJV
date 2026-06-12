import { test, expect } from "@playwright/test";
import path from "node:path";

import { apiWriteHeaders } from "./_shared";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");
const studentAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/student.json");

const ORIGIN = "http://localhost:5173";
const TIMESTAMP = Date.now();
const PROBLEM_TITLE = `Parallelogram Library E2E ${TIMESTAMP}`;

const PROBLEM_STATEMENT = `Develop a Parallelogram library in **C**. Given three points $P_1$, $P_2$, $P_3$, where $P_2$ and $P_3$ are both connected to $P_1$ but $P_2$ and $P_3$ are NOT connected to each other, the parallelogram is formed by these three vertices plus the implicit fourth vertex $P_4 = P_2 + P_3 - P_1$.

Your solution must be split into three files:

- \`parallelogram.h\` — header file declaring \`set_p1\`, \`set_p2\`, \`set_p3\`, \`check\`, \`get_perimeter\`, \`get_area\`, and \`get_p1_degree\`.
- \`parallelogram.c\` — implementation of the library.
- \`main.c\` — reads the six integers from stdin, calls the library, and prints the result.

If the three input points are collinear, the parallelogram is invalid and every numeric getter must return \`-1\`.`;

const INPUT_FORMAT = String.raw`A single line containing six integers separated by spaces:
$P_{1x}\ P_{1y}\ P_{2x}\ P_{2y}\ P_{3x}\ P_{3y}$

All coordinates satisfy $-10^{4} \le x, y \le 10^{4}$.`;

const OUTPUT_FORMAT = `A single line containing three floating-point numbers separated by spaces, each rounded to two decimal places:

\`perimeter area degree_at_p1\`

If the input points are collinear, print \`-1.00 -1.00 -1.00\`.`;

const SAMPLE_CASES: Array<{ input: string; output: string }> = [
  { input: "0 0 4 0 0 3", output: "14.00 12.00 90.00" },
  { input: "0 0 2 0 3 4", output: "14.00 8.00 53.13" },
  { input: "0 0 1 0 2 0", output: "-1.00 -1.00 -1.00" },
];

const HIDDEN_CASES: Array<{ input: string; output: string }> = [
  { input: "1 1 4 1 1 5", output: "14.00 12.00 90.00" },
  { input: "0 0 5 0 3 4", output: "20.00 20.00 53.13" },
  { input: "-2 -2 2 -2 -2 2", output: "16.00 16.00 90.00" },
  { input: "0 0 3 0 6 0", output: "-1.00 -1.00 -1.00" },
];

const MAIN_C = String.raw`#include <stdio.h>
#include <stdint.h>
#include "parallelogram.h"

int main(void) {
    int32_t x1, y1, x2, y2, x3, y3;
    if (scanf("%d %d %d %d %d %d", &x1, &y1, &x2, &y2, &x3, &y3) != 6) {
        return 1;
    }
    set_p1(x1, y1);
    set_p2(x2, y2);
    set_p3(x3, y3);
    double perimeter = get_perimeter();
    double area = get_area();
    double degree = get_p1_degree();
    printf("%.2f %.2f %.2f\n", perimeter, area, degree);
    return 0;
}
`;

const PARALLELOGRAM_H = `#ifndef PARALLELOGRAM_H
#define PARALLELOGRAM_H

#include <stdint.h>

int32_t set_p1(int32_t x, int32_t y);
int32_t set_p2(int32_t x, int32_t y);
int32_t set_p3(int32_t x, int32_t y);

int check(void);
double get_perimeter(void);
double get_area(void);
double get_p1_degree(void);

#endif
`;

const PARALLELOGRAM_C = `#include "parallelogram.h"
#include <math.h>
#include <stdint.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static int32_t p1x, p1y;
static int32_t p2x, p2y;
static int32_t p3x, p3y;
static int has_p1 = 0;
static int has_p2 = 0;
static int has_p3 = 0;

int32_t set_p1(int32_t x, int32_t y) {
    p1x = x;
    p1y = y;
    has_p1 = 1;
    return 1;
}

int32_t set_p2(int32_t x, int32_t y) {
    p2x = x;
    p2y = y;
    has_p2 = 1;
    return 1;
}

int32_t set_p3(int32_t x, int32_t y) {
    p3x = x;
    p3y = y;
    has_p3 = 1;
    return 1;
}

int check(void) {
    if (!has_p1 || !has_p2 || !has_p3) {
        return 0;
    }
    int64_t v1x = (int64_t) p2x - p1x;
    int64_t v1y = (int64_t) p2y - p1y;
    int64_t v2x = (int64_t) p3x - p1x;
    int64_t v2y = (int64_t) p3y - p1y;
    int64_t cross = v1x * v2y - v1y * v2x;
    return cross != 0 ? 1 : 0;
}

double get_perimeter(void) {
    if (!check()) {
        return -1.0;
    }
    double v1x = (double) p2x - p1x;
    double v1y = (double) p2y - p1y;
    double v2x = (double) p3x - p1x;
    double v2y = (double) p3y - p1y;
    double side1 = sqrt(v1x * v1x + v1y * v1y);
    double side2 = sqrt(v2x * v2x + v2y * v2y);
    return 2.0 * (side1 + side2);
}

double get_area(void) {
    if (!check()) {
        return -1.0;
    }
    double v1x = (double) p2x - p1x;
    double v1y = (double) p2y - p1y;
    double v2x = (double) p3x - p1x;
    double v2y = (double) p3y - p1y;
    double cross = v1x * v2y - v1y * v2x;
    return fabs(cross);
}

double get_p1_degree(void) {
    if (!check()) {
        return -1.0;
    }
    double v1x = (double) p2x - p1x;
    double v1y = (double) p2y - p1y;
    double v2x = (double) p3x - p1x;
    double v2y = (double) p3y - p1y;
    double dot = v1x * v2x + v1y * v2y;
    double m1 = sqrt(v1x * v1x + v1y * v1y);
    double m2 = sqrt(v2x * v2x + v2y * v2y);
    double cos_angle = dot / (m1 * m2);
    if (cos_angle > 1.0) cos_angle = 1.0;
    if (cos_angle < -1.0) cos_angle = -1.0;
    return acos(cos_angle) * 180.0 / M_PI;
}
`;

type FormActionResult = {
  type?: string;
  status?: number;
  data?: Record<string, unknown>;
  location?: string;
};

async function postFormAction(
  page: import("@playwright/test").Page,
  urlPath: string,
  form: Record<string, string>,
): Promise<FormActionResult> {
  const res = await page.request.post(urlPath, {
    form,
    headers: { origin: ORIGIN },
  });
  return res.json() as Promise<FormActionResult>;
}

let problemId = "";

test.describe("Submission Lifecycle — Multi-file Parallelogram Library", () => {
  test.describe.configure({ mode: "serial" });

  test("teacher creates a draft problem via API", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    const res = await page.request.post("/api/problems", { headers: apiWriteHeaders });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    problemId = body.id;
    expect(problemId).toBeTruthy();

    await context.close();
  });

  test("teacher fills basic info and sets visibility to public", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    await page.goto(`/problems/${problemId}/edit`);
    await expect(page.getByRole("main")).toBeVisible();

    const titleInput = page.locator("input[name='title']");
    await titleInput.click();
    await titleInput.fill(PROBLEM_TITLE);

    await page.locator("textarea[name='statement']").fill(PROBLEM_STATEMENT);
    await page.locator("textarea[name='inputFormat']").fill(INPUT_FORMAT);
    await page.locator("textarea[name='outputFormat']").fill(OUTPUT_FORMAT);

    await page.evaluate(() => {
      const triggers = [
        ...document.querySelectorAll<HTMLButtonElement>('[data-slot="select-trigger"]'),
      ];
      const visTrigger = triggers.find((t) => /private/i.test(t.textContent ?? ""));
      if (!visTrigger) throw new Error("Visibility trigger not found");
      const hiddenInput = visTrigger.parentElement?.querySelector<HTMLInputElement>(
        'input[type="hidden"], input[name="visibility"]',
      );
      if (hiddenInput) {
        hiddenInput.value = "public";
        hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const visTrigger = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: /private/i });
    await visTrigger.click();
    await page.keyboard.press("p");
    await page.keyboard.press("Enter");

    await page
      .getByRole("button", { name: /save|儲存/i })
      .first()
      .click();

    await expect(page.getByRole("heading", { name: PROBLEM_TITLE })).toBeVisible({
      timeout: 15_000,
    });

    await context.close();
  });

  test("teacher creates a sample testcase set", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    const body = await postFormAction(page, `/problems/${problemId}/edit?/createTestcaseSet`, {
      data: JSON.stringify({
        name: "Sample",
        weight: 1,
        cases: SAMPLE_CASES,
      }),
    });
    expect(body.type).not.toBe("error");
    expect(body.type).not.toBe("failure");

    await context.close();
  });

  test("teacher creates a hidden testcase set", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    const body = await postFormAction(page, `/problems/${problemId}/edit?/createTestcaseSet`, {
      data: JSON.stringify({
        name: "Hidden",
        weight: 2,
        cases: HIDDEN_CASES,
      }),
    });
    expect(body.type).not.toBe("error");
    expect(body.type).not.toBe("failure");

    await context.close();
  });

  test("teacher publishes the problem", async ({ browser }) => {
    const context = await browser.newContext({ storageState: teacherAuth });
    const page = await context.newPage();

    const body = await postFormAction(page, `/problems/${problemId}/edit?/publish`, {});
    expect(body.type).not.toBe("error");
    expect(body.type).not.toBe("failure");

    await page.goto(`/problems/${problemId}/edit`);
    await expect(page.getByText(/^Draft$|^草稿$/)).not.toBeVisible();

    await context.close();
  });

  test("student sees the published problem on the problem workspace", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    await page.goto(`/problems/${problemId}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { name: PROBLEM_TITLE })).toBeVisible();
    await expect(page.getByRole("button", { name: /^submit$|^繳交$/i })).toBeVisible();

    await context.close();
  });

  test("student submits multi-file C solution and polls for verdict", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    const createRes = await page.request.post("/api/submissions", {
      data: {
        problemId,
        language: "c",
        sourceCode: MAIN_C,
        sourceFiles: [
          { path: "parallelogram.h", content: PARALLELOGRAM_H },
          { path: "parallelogram.c", content: PARALLELOGRAM_C },
        ],
      },
      headers: apiWriteHeaders,
    });
    expect(createRes.status()).toBe(202);
    const created = await createRes.json();
    expect(created.submissionId).toBeTruthy();
    expect(created.status).toBe("queued");
    expect(created.pollUrl).toBe(`/api/submissions/${created.submissionId}`);

    const deadline = Date.now() + 30_000;
    let lastStatus = created.status as string;
    while (Date.now() < deadline) {
      const pollRes = await page.request.get(created.pollUrl);
      expect(pollRes.ok()).toBe(true);
      const pollBody = await pollRes.json();
      expect(pollBody.submissionId).toBe(created.submissionId);
      lastStatus = pollBody.status;
      if (lastStatus !== "queued" && lastStatus !== "running") {
        break;
      }
      await page.waitForTimeout(1500);
    }

    const terminalStatuses = [
      "accepted",
      "wrong_answer",
      "compile_error",
      "runtime_error",
      "time_limit_exceeded",
      "memory_limit_exceeded",
    ];

    if (process.env.NOJV_E2E_RUN_JUDGE === "1") {
      expect(terminalStatuses).toContain(lastStatus);
    } else {
      expect([...terminalStatuses, "queued", "running"]).toContain(lastStatus);
    }

    await context.close();
  });

  test("submission appears in the student's submissions page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: studentAuth });
    const page = await context.newPage();

    await page.goto("/submissions");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText(PROBLEM_TITLE).first()).toBeVisible({ timeout: 10_000 });

    await context.close();
  });
});
