import { expect, type Page, test } from "@playwright/test";

const PASSWORD = process.env.TALORYS_DEV_PASSWORD || "dev-Owner-violeta-trem-81";
const CSRF = { "x-talorys-request": "1" };

async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("Owner password").fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("What would you like to do today?")).toBeVisible();
}

const BOTH = ["push", "telegram"];
const DEFAULTS = {
  routes: { reminder: BOTH, digest: BOTH, routine: BOTH, task: BOTH, system: BOTH, security: BOTH, event: BOTH },
  limits: { perHour: 6, perDay: 30 },
  fullText: [],
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
    expect((await (await page.request.get("/api/alerts")).json()).preferences.routes.digest).toEqual(["telegram"]);

    await page.locator("#alerts-per-hour").fill("12");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await (await page.request.get("/api/alerts")).json()).preferences.limits.perHour).toBe(12);

    // The reminder above went through the alert center.
    await expect(page.getByRole("heading", { name: "Recent deliveries" })).toBeVisible();
    await expect(page.getByText(/no device or chat linked/).first()).toBeVisible();
    await expect(page.getByText("Not sent").first()).toBeVisible();

    await page.request.delete(`/api/automations/${automation.id}`, { headers: CSRF });
  });

  test("shows e-mail as a channel that is not set up, with security always on", async ({ page }) => {
    await login(page);
    await page.goto("/settings?tab=Alerts");
    // The e2e deploy has no send_email binding.
    await expect(page.getByText(/Not set up on this deployment. With Cloudflare Email Routing/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send a test e-mail" })).toHaveCount(0);
    const security = page.getByRole("switch", { name: "Send Security alerts by E-mail" });
    await expect(security).toHaveAttribute("aria-checked", "true");
    await expect(security).toBeDisabled();
    const reminders = page.getByRole("switch", { name: "Send Reminders alerts by E-mail" });
    await expect(reminders).toHaveAttribute("aria-checked", "false");
    await reminders.click();
    await expect(reminders).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => (await (await page.request.get("/api/alerts")).json()).preferences.routes.reminder).toContain("email");
    await reminders.click();
    await expect.poll(async () => (await (await page.request.get("/api/alerts")).json()).preferences.routes.reminder).not.toContain("email");
  });

  test("sets the daily summary time and turns the watchers off and on", async ({ page }) => {
    await login(page);
    await page.goto("/settings?tab=Alerts");
    await expect(page.getByText("Daily summary", { exact: true })).toBeVisible();
    const time = page.getByLabel("Daily summary time");
    await expect(time).toHaveValue("07:30");
    await time.fill("06:45");
    await time.blur();
    await expect.poll(async () => (await (await page.request.get("/api/alerts")).json()).preferences.digest).toEqual({ enabled: true, time: "06:45" });
    const summary = page.getByRole("switch", { name: "Send the daily summary" });
    await summary.click();
    await expect(summary).toHaveAttribute("aria-checked", "false");
    await expect(time).toBeDisabled();
    const watchers = page.getByRole("switch", { name: "Turn the watchers on" });
    await expect(watchers).toHaveAttribute("aria-checked", "true");
    await watchers.click();
    await expect.poll(async () => (await (await page.request.get("/api/alerts")).json()).preferences).toMatchObject({
      digest: { enabled: false, time: "06:45" },
      watchers: false,
    });
  });

  test("shows the Telegram card and saves which categories send their full text", async ({ page }) => {
    await login(page);
    await page.goto("/settings?tab=Alerts");
    // The e2e deploy has no TELEGRAM_BOT_TOKEN.
    await expect(page.getByRole("heading", { name: "Telegram" })).toBeVisible();
    await expect(page.getByText("Not set up", { exact: true })).toBeVisible();
    await expect(page.getByText(/Telegram is not set up on this deployment/)).toBeVisible();
    const tg = page.getByRole("switch", { name: "Send Reminders alerts by Telegram" });
    await expect(tg).toHaveAttribute("aria-checked", "true");
    const full = page.getByRole("switch", { name: "Send the full text of Reminders alerts to Telegram and e-mail" });
    await expect(full).toHaveAttribute("aria-checked", "false");
    await full.click();
    await expect(full).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => (await (await page.request.get("/api/alerts")).json()).preferences.fullText).toEqual(["reminder"]);
    // Turning a route off keeps the full-text choice.
    await tg.click();
    await expect(tg).toHaveAttribute("aria-checked", "false");
    await expect.poll(async () => (await (await page.request.get("/api/alerts")).json()).preferences).toMatchObject({ routes: { reminder: ["push"] }, fullText: ["reminder"] });
  });

  test("corrects a notification's priority and shows what Axis learned", async ({ page }) => {
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
    // Critical is kept for security alerts.
    await expect(item.getByRole("combobox", { name: "Change priority" }).locator("option")).toHaveText(["Low", "Normal", "High"]);
    await item.getByRole("combobox", { name: "Change priority" }).selectOption("high");
    await expect(page.getByText("Priority changed")).toBeVisible();
    await expect(item.locator("span").filter({ hasText: /^High$/ })).toBeVisible();
    await expect(item.getByText("You changed this priority; Axis learns from it")).toBeVisible();
    await page.keyboard.press("Escape");

    // The correction moved this routine's kind one level up.
    await page.goto("/settings?tab=Alerts");
    await expect(page.getByRole("heading", { name: "What Axis learned" })).toBeVisible();
    const learned = page.getByRole("listitem").filter({ hasText: "E2E priority" });
    await expect(learned.getByText(/1 level louder/)).toBeVisible();
    await learned.getByRole("combobox", { name: "Priority for E2E priority" }).selectOption("low");
    await expect(learned.getByText(/Fixed at Low/)).toBeVisible();
    await learned.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByText("Reset. Axis learns this kind again from zero.")).toBeVisible();
    await expect(learned).toHaveCount(0);
    await page.request.delete(`/api/automations/${automation.id}`, { headers: CSRF });
  });

  test("schedules an insistent reminder with high priority", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Automations" }).first().click();
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByLabel("Reminder message").fill("e2e insistent pill");
    await expect(page.getByLabel("Alert priority")).toHaveValue("normal");
    await page.getByLabel("Alert priority").selectOption("high");
    await expect(page.getByText("Insists until you confirm")).toBeVisible();
    await page.getByLabel("Repeat").selectOption("daily");
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    const row = page.getByRole("listitem").filter({ hasText: "e2e insistent pill" });
    await expect(row.getByText("Insistent", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Edit e2e insistent pill/ }).click();
    await expect(page.getByLabel("Alert priority")).toHaveValue("high");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: /Delete e2e insistent pill/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("e2e insistent pill")).toHaveCount(0);
  });

  test("starts a sentinel from the morning template, quiet unless something needs you", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Automations" }).first().click();
    await page.getByRole("button", { name: "New", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "AI routine" }).click();
    const quiet = dialog.getByRole("switch", { name: "Only notify me when something needs me" });
    await expect(quiet).toHaveAttribute("aria-checked", "false");
    await dialog.getByRole("button", { name: "Morning check" }).click();
    await expect(quiet).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Name")).toHaveValue("Morning check");
    await expect(page.getByLabel("Prompt")).toHaveValue(/Tell me only what needs me today/);
    await expect(page.getByLabel("Repeat")).toHaveValue("daily");
    await dialog.getByRole("button", { name: "Create" }).click();
    const row = page.getByRole("listitem").filter({ hasText: "Morning check" });
    await expect(row.getByText("Only when needed", { exact: true })).toBeVisible();
    const { automations } = await (await page.request.get("/api/automations")).json();
    const created = automations.find((a: { name: string }) => a.name === "Morning check");
    expect(created).toMatchObject({ kind: "agent_prompt", sentinel: true, schedule: { type: "daily", time: "07:00" } });
    await page.request.delete(`/api/automations/${created.id}`, { headers: CSRF });
  });
});
