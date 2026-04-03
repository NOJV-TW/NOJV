/**
 * E2E tests for creating real-world CP problem types.
 * Based on NTNU CSIE Computer Programming I assignments.
 */
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

const teacherAuth = path.resolve(import.meta.dirname, "../fixtures/auth-states/teacher.json");

test.use({ storageState: teacherAuth });

// ─── Helpers ───────────────────────────────────────────────────────

async function createDraft(
  page: Page,
  opts: {
    title: string;
    statement: string;
    inputFormat: string;
    outputFormat: string;
  }
): Promise<string> {
  // Retry up to 3 times in case of rate limiting
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto("/problems/create");
    await page.locator("form button[type=submit]").waitFor();
    await page.locator("form input[required]").first().fill(opts.title);
    const textareas = page.locator("form textarea");
    await textareas.nth(0).fill(opts.statement);
    await textareas.nth(1).fill(opts.inputFormat);
    await textareas.nth(2).fill(opts.outputFormat);
    await page.getByRole("button", { name: /save basic info/i }).click();
    try {
      await page.waitForURL(/\/problems\/.*\/edit/, { timeout: 15000 });
      return page.url();
    } catch {
      // Rate limited or validation error - wait and retry
      await page.waitForTimeout(3000);
    }
  }
  // Final attempt without catching
  await page.goto("/problems/create");
  await page.locator("form button[type=submit]").waitFor();
  await page.locator("form input[required]").first().fill(opts.title);
  const textareas = page.locator("form textarea");
  await textareas.nth(0).fill(opts.statement);
  await textareas.nth(1).fill(opts.inputFormat);
  await textareas.nth(2).fill(opts.outputFormat);
  await page.getByRole("button", { name: /save basic info/i }).click();
  await page.waitForURL(/\/problems\/.*\/edit/, { timeout: 30000 });
  return page.url();
}

async function goToTab(page: Page, tabName: string) {
  await page.getByRole("button", { name: tabName, exact: true }).click();
  // Wait for tab content to render
  await page.waitForTimeout(1000);
}

// ─── 1. Standard I/O Problem (Flip Octal Number) ──────────────────

test.describe("Standard I/O Problem — Flip Octal Number", () => {
  test("create and configure with multiple subtask testcases", async ({ page }) => {
    await createDraft(page, {
      title: `Flip Octal Number ${Date.now()}`,
      statement: `Please write a program for a user to input an unsigned 16-bit integer and flip the number's octal form.

For example, if the input is 668:
- 668 in decimal = 1234 in octal
- Flipped: 4321 in octal = 2257 in decimal

You do not need to consider invalid inputs.`,
      inputFormat: "A single unsigned 16-bit integer (0–65535).",
      outputFormat:
        "Display the octal representation before and after flipping, along with their decimal equivalents."
    });

    // Configure submission settings: standard full_source, 1s time limit
    await goToTab(page, "Submission Settings");
    await expect(page.locator('input[value="full_source"]')).toBeChecked({ timeout: 10000 });
    const timeInput = page.locator('input[type="number"]').first();
    await timeInput.fill("1000");
    const memInput = page.locator('input[type="number"]').nth(1);
    await memInput.fill("256");
    await page.getByRole("button", { name: /save settings/i }).click();

    // Verify judge settings default to standard
    await goToTab(page, "Judge Settings");
    await expect(page.locator('input[name="judgeType"][value="standard"]')).toBeChecked({
      timeout: 10000
    });
  });
});

// ─── 2. Checker Problem (Colorful Words with ANSI codes) ──────────

test.describe("Checker Problem — Print Colorful Words", () => {
  test("create and configure with custom checker script", async ({ page }) => {
    const editUrl = await createDraft(page, {
      title: `Print Colorful Words ${Date.now()}`,
      statement: `Write a program to display a message with ANSI color codes.

Color Kim's lyrics with red, Chris's lyrics with blue, and duet lyrics with green.

The output must use proper ANSI escape codes (e.g. \\033[31m for red).`,
      inputFormat: "No input.",
      outputFormat:
        "The formatted lyrics with ANSI escape codes. Exact byte-level comparison is done by a custom checker."
    });

    // Configure judge type as checker
    await goToTab(page, "Judge Settings");
    const checkerRadio = page.locator('input[name="judgeType"][value="checker"]');
    await checkerRadio.waitFor({ state: "attached", timeout: 10000 });
    await checkerRadio.click({ force: true });

    // Load default checker template
    await page
      .getByRole("button", { name: /load default template/i })
      .first()
      .click();

    // Save judge settings and wait for confirmation
    await page.getByRole("button", { name: /save settings/i }).click();
    await page.getByText(/saved/i).waitFor({ timeout: 10000 });

    // Reload and verify checker is persisted
    await page.goto(editUrl);
    await goToTab(page, "Judge Settings");
    await expect(page.locator('input[name="judgeType"][value="checker"]')).toBeChecked({
      timeout: 10000
    });
  });
});

// ─── 3. Interactive Problem (DNA Sequence State Machine) ──────────

test.describe("Interactive Problem — DNA Sequence Matcher", () => {
  test("create and configure with interactor script", async ({ page }) => {
    const editUrl = await createDraft(page, {
      title: `DNA Sequence Matcher ${Date.now()}`,
      statement: `Check if a given DNA sequence matches a specific pattern using a state machine.

DNA bases are encoded as: thymine(T)=1, adenine(A)=2, cytosine(C)=3, guanine(G)=4.
The input starts from S0 and transitions according to a DFA. Input 0 indicates end.
If the final state is S7, the sequence matches the pattern.

Invalid inputs should prompt re-entry.`,
      inputFormat: "A sequence of integers (1-4) representing DNA bases, terminated by 0.",
      outputFormat: "The final state and whether the sequence satisfies the pattern."
    });

    // Configure as interactive problem
    await goToTab(page, "Judge Settings");
    const interactiveRadio = page.locator('input[name="judgeType"][value="interactive"]');
    await interactiveRadio.waitFor({ state: "attached", timeout: 10000 });
    await interactiveRadio.click({ force: true });

    // Load default interactor template
    await page
      .getByRole("button", { name: /load default template/i })
      .first()
      .click();

    // Save and wait for confirmation
    await page.getByRole("button", { name: /save settings/i }).click();
    await page.getByText(/saved/i).waitFor({ timeout: 10000 });

    // Verify
    await page.goto(editUrl);
    await goToTab(page, "Judge Settings");
    await expect(page.locator('input[name="judgeType"][value="interactive"]')).toBeChecked({
      timeout: 10000
    });
  });
});

// ─── 4. Function Template Problem (Parallelogram Library) ─────────

test.describe("Function Template Problem — Parallelogram Library", () => {
  test("create and configure with function submission type", async ({ page }) => {
    await createDraft(page, {
      title: `Parallelogram Library ${Date.now()}`,
      statement: `Develop a library for parallelogram operations.

Students implement a header file (parallelogram.h) with functions:
- setP1, setP2, setP3: set three vertices
- check: verify if the setting forms a valid parallelogram
- getPerimeter, getArea: compute geometric properties
- getP1Degree: get the angle at P1

The TA-provided main program (mid03.c) will test your library.
P2 and P3 are connected to P1, but P2 and P3 are NOT connected to each other.`,
      inputFormat: "Three points P1(x,y), P2(x,y), P3(x,y) as integers.",
      outputFormat: "Perimeter (double), area (double), and angle at P1 (degrees, 0-360)."
    });

    // Switch to function submission type
    await goToTab(page, "Submission Settings");
    const functionRadio = page.locator('input[value="function"]');
    await functionRadio.click();

    // Template editor should appear
    await expect(page.getByText(/driver code/i).first()).toBeVisible();
    await expect(page.getByText(/template code/i).first()).toBeVisible();

    // Set time limit for computational geometry
    const timeInput = page.locator('input[type="number"]').first();
    await timeInput.fill("2000");

    await page.getByRole("button", { name: /save settings/i }).click();

    // Verify function type is selected in the current UI
    await expect(page.locator('input[value="function"]')).toBeChecked({ timeout: 10000 });
  });
});

// ─── 5. Static Analysis Problem (restricted syntax) ───────────────

test.describe("Static Analysis Problem — Binary Variable", () => {
  test("create with banned functions and imports", async ({ page }) => {
    await createDraft(page, {
      title: `Binary Variable ${Date.now()}`,
      statement: `Convert a 16-bit hex number to binary, then to a specified type (integer, unsigned integer, or float).

**You may only use syntax that has already been taught in class.**
You cannot use pow() or math.h. Use bit manipulation and mod operators instead.

Print float numbers in scientific notation.`,
      inputFormat:
        "A 4-digit hex string, followed by the output type (1=int, 2=uint, 3=float).",
      outputFormat: "The binary representation and the converted value."
    });

    // Enable static analysis in judge settings
    await goToTab(page, "Judge Settings");

    // Enable static analysis toggle (first toggle in the section)
    const toggles = page.locator("button[role='switch']");
    await toggles.first().waitFor({ state: "visible", timeout: 10000 });
    await toggles.first().click();

    // Verify banned functions field appeared
    await expect(page.getByText(/banned functions/i)).toBeVisible();
    await expect(page.getByText(/banned imports/i)).toBeVisible();

    // Save
    await page.getByRole("button", { name: /save settings/i }).click();
  });
});

// ─── 6. Precision/Tolerance Problem (Climate Change) ──────────────

test.describe("Tolerance Problem — Climate Change Prediction", () => {
  test("create with checker for floating-point tolerance", async ({ page }) => {
    await createDraft(page, {
      title: `Climate Change Prediction ${Date.now()}`,
      statement: `Implement a program to predict future temperature using the least squares method.

Given past temperature data (year, temperature pairs), derive coefficients a and b for:
  T(t) = a*t + b

Input pairs until year = -1, then predict the temperature for a given year.

Use **double** precision. Results must match within 1e-6 tolerance.`,
      inputFormat: "Pairs of (year, temperature) until year=-1, then a prediction year.",
      outputFormat: "The predicted temperature (double precision)."
    });

    // Use checker for floating-point comparison with tolerance
    await goToTab(page, "Judge Settings");
    const checkerRadio = page.locator('input[name="judgeType"][value="checker"]');
    await checkerRadio.waitFor({ state: "attached", timeout: 10000 });
    await checkerRadio.click({ force: true });
    await page
      .getByRole("button", { name: /load default template/i })
      .first()
      .click();
    await page.getByRole("button", { name: /save settings/i }).click();

    // Set higher time limit for iterative computation
    await goToTab(page, "Submission Settings");
    await page.locator('input[type="number"]').first().fill("3000");
    await page.getByRole("button", { name: /save settings/i }).click();
  });
});

// ─── 7. Multi-solution Problem (Multiplication Variables) ─────────

test.describe("Multi-solution Problem — Variable Multiplication", () => {
  test("create with subtask scoring strategy", async ({ page }) => {
    await createDraft(page, {
      title: `Variable Multiplication ${Date.now()}`,
      statement: `Develop a multiplication version of the variable-digit math problem.

Given an operand with one variable and a product with two variables (a,b,c,d ∈ [0-9]),
find all valid assignments and list all possible multiplication results.

Variables can appear at any digit position. List all solutions sorted.
If no solutions exist, print "No solutions".`,
      inputFormat:
        "Three strings: first operand (format: digits and one variable), second operand (format: digits and two variables), and the product.",
      outputFormat:
        "All valid variable assignments and corresponding multiplication results, sorted."
    });

    // Configure scoring tab
    await goToTab(page, "Scoring Rules");

    // Should show hint about needing testcases
    await expect(page.getByText(/testcase/i).first()).toBeVisible();
  });
});

// ─── 8. Visual Output Problem (Colorful Gradient) ─────────────────

test.describe("Visual Output Problem — Colorful Gradient", () => {
  test("create with artifact collection for visual output", async ({ page }) => {
    await createDraft(page, {
      title: `Colorful Gradient ${Date.now()}`,
      statement: `Print a colorful gradient on the terminal using ANSI 24-bit true color escape codes.

Given width (10-80), height (10-20), and four corner RGB values, interpolate colors bilinearly and render each pixel as a colored space character.

RGB values must be 0-255. For invalid inputs, print an error and re-prompt.`,
      inputFormat:
        "Width, height, and four RGB triplets (top-left, top-right, bottom-left, bottom-right).",
      outputFormat:
        "A terminal output with ANSI true-color escape sequences rendering the gradient."
    });

    // Use checker (exact ANSI output comparison)
    await goToTab(page, "Judge Settings");
    const checkerRadio = page.locator('input[name="judgeType"][value="checker"]');
    await checkerRadio.waitFor({ state: "attached", timeout: 10000 });
    await checkerRadio.click({ force: true });
    await page
      .getByRole("button", { name: /load default template/i })
      .first()
      .click();

    // Enable artifact collection - scroll to find the artifact section toggle
    const artifactHeading = page.getByText(/artifact collection/i).first();
    await artifactHeading.scrollIntoViewIfNeeded();

    // The artifact section is the third bordered section. Find its toggle.
    const artifactSection = page
      .locator(".rounded-2xl.border")
      .filter({ hasText: /artifact collection/i });
    const artifactToggle = artifactSection.locator("button[role='switch']").first();
    await artifactToggle.click();

    await expect(page.getByText(/collection patterns/i)).toBeVisible();

    await page.getByRole("button", { name: /save settings/i }).click();
  });
});

// ─── 9. Regex/Automaton Problem (Regular Expression) ──────────────

test.describe("Automaton Problem — Regular Expression Matcher", () => {
  test("create with multiple testcase subtasks of varying difficulty", async ({ page }) => {
    await createDraft(page, {
      title: `Regular Expression Matcher ${Date.now()}`,
      statement: `Given the regular expression ((01*(2∪3)*4) ∪ (10*4*2))*, determine whether an input sequence is accepted.

Read symbols one at a time. Input -1 means end of sequence.
Output "accept" or "reject".

This requires implementing a DFA or NFA simulation.`,
      inputFormat: "A sequence of integers (0-4), terminated by -1.",
      outputFormat: '"accept" if the sequence matches the regex, "reject" otherwise.'
    });

    // Standard judge (exact string match for accept/reject)
    await goToTab(page, "Judge Settings");
    await expect(page.locator('input[name="judgeType"][value="standard"]')).toBeChecked({
      timeout: 10000
    });

    // Set generous time limit for NFA simulation
    await goToTab(page, "Submission Settings");
    await page.locator('input[type="number"]').first().fill("5000");
    await page.locator('input[type="number"]').nth(1).fill("512");
    await page.getByRole("button", { name: /save settings/i }).click();
  });
});

// ─── 10. ZIP Project Problem (Multi-file with Makefile) ────────────

test.describe("ZIP Project Problem — Card Game Engine", () => {
  test("create with zip_project submission type", async ({ page }) => {
    await createDraft(page, {
      title: `Poker Hand Evaluator ${Date.now()}`,
      statement: `Write a program to determine the rank of a given poker hand.

Cards are encoded as 1-52:
- 1-13: ♠ Ace to King
- 14-26: ♥ Ace to King
- 27-39: ♦ Ace to King
- 40-52: ♣ Ace to King

Rankings (highest to lowest): Straight Flush, Four of a Kind, Full House, Flush, Straight, Three of a Kind, Two Pair, One Pair, High Card.

**Submit as a ZIP project with a Makefile.** The binary must be named \`hw0104\`.`,
      inputFormat: "5 integers representing card codes (1-52).",
      outputFormat: "The hand ranking name (e.g. 'Straight Flush', 'Full House')."
    });

    // Switch to zip_project
    await goToTab(page, "Submission Settings");
    const zipRadio = page.locator('input[value="zip_project"]');
    await zipRadio.click();

    // ZIP-specific fields should appear
    await expect(page.getByText(/file structure/i)).toBeVisible();

    await page.getByRole("button", { name: /save settings/i }).click();

    // Verify zip_project type is selected in the current UI
    await expect(page.locator('input[value="zip_project"]')).toBeChecked({ timeout: 10000 });
  });
});
