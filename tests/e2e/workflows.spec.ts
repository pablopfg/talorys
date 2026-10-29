import { expect, type Page, test } from "@playwright/test";

const PASSWORD = process.env.TALORYS_DEV_PASSWORD || "dev-Owner-violeta-trem-81";
const CSRF = { "x-talorys-request": "1" };

async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("Owner password").fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("What would you like to do today?")).toBeVisible();
}

test.describe("Workflows", () => {
  test.afterEach(async ({ page }) => {
    await page.request.patch("/api/workflows/site_monitor", { headers: CSRF, data: { enabled: false, config: { urls: [] } } });
  });

  test("sets up the site monitor and turns it on and off @mobile", async ({ page }) => {
    await login(page);
    await page.locator(`a[href="/workflows"]:visible`).first().click();
    await expect(page.getByRole("heading", { name: "Workflows" })).toBeVisible();
    await expect(page.getByText("Site monitor", { exact: true })).toBeVisible();
    await expect(page.getByText("Feed news", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Edit Site monitor" }).click();
    await page.getByLabel("Sites to check").fill("https://example.com/health");
    await page.getByRole("dialog").getByRole("switch", { name: "Workflow on" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Workflow saved")).toBeVisible();

    const toggle = page.getByRole("switch", { name: "Turn off Site monitor" });
    await expect(toggle).toBeChecked();
    await expect(page.getByText(/Next:/)).toBeVisible();
    await toggle.click();
    await expect(page.getByRole("switch", { name: "Turn on Site monitor" })).not.toBeChecked();
  });
});
