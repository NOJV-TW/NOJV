import { type Page } from "@playwright/test";

export async function screenshotPage(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: true });
}
