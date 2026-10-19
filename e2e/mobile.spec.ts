import { expect, test } from "@playwright/test";

const PAGES = ["/", "/browse", "/login", "/signup", "/rules", "/security", "/report", "/copyright"];

for (const path of PAGES) {
  test(`${path} fits a phone screen without horizontal scrolling`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole("main")).toBeVisible();
    // Streamed pages answer 200 even when a section throws, so check for the error boundary too.
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });
}
