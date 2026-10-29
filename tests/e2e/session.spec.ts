import { expect, type Page, test } from "@playwright/test";

const PASSWORD = process.env.TALORYS_DEV_PASSWORD || "talorys-dev-password";
const MIN = 60_000;

async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("Owner password").fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("What would you like to do today?")).toBeVisible();
}

test.describe("automatic sign-out (D9: 15 min without use)", () => {
  test("warns two minutes before, and Stay signed in keeps the session", async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.clock.fastForward(12 * MIN);
    await expect(page.getByRole("dialog", { name: "Still there?" })).toHaveCount(0);
    await page.clock.fastForward(1.5 * MIN);
    const dialog = page.getByRole("dialog", { name: "Still there?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("because it isn't being used");
    await dialog.getByRole("button", { name: "Stay signed in" }).click();
    await expect(dialog).toBeHidden();
    await page.clock.fastForward(10 * MIN);
    await expect(page.getByText("What would you like to do today?")).toBeVisible();
  });

  test("ends the session after 15 minutes without use and says why", async ({ page }) => {
    await page.clock.install();
    await login(page);
    await page.clock.fastForward(15 * MIN + 5_000);
    await expect(page.getByPlaceholder("Owner password")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("ended because it wasn't used");
    // The server agrees: the old cookie no longer opens the app.
    await page.reload();
    await expect(page.getByPlaceholder("Owner password")).toBeVisible();
  });

  test("signing out in one tab signs out the others", async ({ context }) => {
    const first = await context.newPage();
    await login(first);
    const second = await context.newPage();
    await second.goto("/");
    await expect(second.getByText("What would you like to do today?")).toBeVisible();
    await first.goto("/settings?tab=Security");
    await first.getByRole("button", { name: "Lock this device" }).click();
    await expect(second.getByPlaceholder("Owner password")).toBeVisible();
  });
});
