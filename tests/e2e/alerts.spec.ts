import { expect, type Page, test } from "@playwright/test";

const PASSWORD = process.env.TALORYS_DEV_PASSWORD || "dev-Owner-violeta-trem-81";
const CSRF = { "x-talorys-request": "1" };

async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("Owner password").fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("What would you like to do today?")).toBeVisible();
}

const DEFAULTS = {
  routes: { reminder: ["push"], digest: ["push"], routine: ["push"], task: ["push"], system: ["push"], security: ["push"], event: ["push"] },
  limits: { perHour: 6, perDay: 30 },
};

test.describe("Alerts", () => {
  test.afterEach(async ({ page }) => {
    await page.request.put("/api/alerts/preferences", { headers: CSRF, data: DEFAULTS });
  });

  test("routes categories, saves limits and shows what happened to each alert", async ({ page }) => {
    await login(page);
    expect((await page.request.put("/api/alerts/preferences", { headers: CSRF, data: DEFAULTS })).status()).toBe(200);
    // No device registered: the delivery is recorded as not sent, with the reason.
    for (const d of (await (await page.request.get("/api/push")).json()).devices) await page.request.delete(`/api/push/subscriptions/${d.id}`, { headers: CSRF });
    const created = await page.request.post("/api/automations", {
      headers: CSRF,
      data: { name: "E2E alert reminder", kind: "reminder", message: "Drink water", schedule: { type: "daily", time: "09:00" }, enabled: false },
    });
    expect(created.status()).toBe(201);
    const { automation } = await created.json();
    expect((await page.request.post(`/api/automations/${automation.id}/run`, { headers: CSRF })).status()).toBe(200);

    await page.goto("/settings?tab=Alerts");
    await expect(page.getByRole("heading", { name: "Where alerts go" })).toBeVisible();
    const digest = page.getByRole("switch", { name: "Send Digests alerts by Push" });
    await expect(digest).toHaveAttribute("aria-checked", "true");
    await digest.click();
    await expect(page.getByText("Alert preferences saved")).toBeVisible();
    await expect(digest).toHaveAttribute("aria-checked", "false");
    expect((await (await page.request.get("/api/alerts")).json()).preferences.routes.digest).toEqual([]);

    await page.locator("#alerts-per-hour").fill("12");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await (await page.request.get("/api/alerts")).json()).preferences.limits.perHour).toBe(12);

    // The reminder above went through the alert center.
    await expect(page.getByRole("heading", { name: "Recent deliveries" })).toBeVisible();
    await expect(page.getByText(/no device registered/).first()).toBeVisible();
    await expect(page.getByText("Not sent").first()).toBeVisible();

    await page.request.delete(`/api/automations/${automation.id}`, { headers: CSRF });
  });

  test("changes a notification's priority from the notification center", async ({ page }) => {
    await login(page);
    const created = await page.request.post("/api/automations", {
      headers: CSRF,
      data: { name: "E2E priority", kind: "reminder", message: "Priority check", schedule: { type: "daily", time: "09:00" }, enabled: false },
    });
    const { automation } = await created.json();
    await page.request.post(`/api/automations/${automation.id}/run`, { headers: CSRF });
    await page.reload();
    await page.getByRole("button", { name: /Notifications/ }).first().click();
    const item = page.getByRole("listitem").filter({ hasText: "Priority check" }).first();
    await expect(item).toBeVisible();
    await item.getByRole("combobox", { name: "Change priority" }).selectOption("critical");
    await expect(page.getByText("Priority changed")).toBeVisible();
    await expect(item.locator("span").filter({ hasText: /^Critical$/ })).toBeVisible();
    await page.request.delete(`/api/automations/${automation.id}`, { headers: CSRF });
  });
});
