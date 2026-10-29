import { expect, type Page, test } from "@playwright/test";
import { totpCode, totpStep } from "../../packages/shared/src/totp";

const PASSWORD = process.env.TALORYS_DEV_PASSWORD || "dev-Owner-violeta-trem-81";

async function enterPassword(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("Owner password").fill(PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
}

test("two-step sign-in: turn on with the QR code, sign in with a recovery code, turn off", async ({ page }) => {
  await enterPassword(page);
  await expect(page.getByText("What would you like to do today?")).toBeVisible();
  // Off: the reminder shows outside Settings.
  await expect(page.getByText("Two-step sign-in is off. Turn it on")).toBeVisible();

  await page.goto("/settings?tab=Security");
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  const secret = (await page.locator("code").filter({ hasText: /^[A-Z2-7 ]{20,}$/ }).innerText()).replace(/\s/g, "");
  await page.getByLabel("Code from the app").fill("000000");
  await page.getByRole("button", { name: "Turn on", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Incorrect code");
  await page.getByLabel("Code from the app").fill(await totpCode(secret, totpStep()));
  await page.getByRole("button", { name: "Turn on", exact: true }).click();

  const codes = (await page.locator("ul li").filter({ hasText: /^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/ }).allInnerTexts()).map((c) => c.trim());
  expect(codes).toHaveLength(10);
  await page.getByRole("button", { name: "I saved the codes" }).click();
  await expect(page.getByText("Two-step sign-in is on", { exact: true })).toBeVisible();
  await expect(page.getByText("10 recovery codes left")).toBeVisible();

  // The password alone no longer opens the app.
  await page.getByRole("button", { name: "Lock this device" }).click();
  await enterPassword(page);
  await expect(page.getByLabel("Authenticator code")).toBeVisible();
  await page.getByRole("button", { name: "Use a recovery code" }).click();
  await page.getByLabel("Recovery code").fill("AAAA-AAAA-AAAA-AAAA");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("alert")).toContainText("Incorrect code");
  await page.getByLabel("Recovery code").fill(codes[0]!.toLowerCase());
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("What would you like to do today?")).toBeVisible();

  // A used recovery code is gone; another one turns it off. (No wrong code here: it would count
  // against the sign-in rate limit the other specs share.)
  await page.goto("/settings?tab=Security");
  await expect(page.getByText("9 recovery codes left")).toBeVisible();
  await page.getByRole("button", { name: "Turn off", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Turn off two-step sign-in?" });
  await dialog.getByLabel("Authenticator code").fill(codes[1]!);
  await dialog.getByRole("button", { name: "Turn off" }).click();
  // Off again: the card offers setup. (Not the heading text: the toast says the same words.)
  await expect(page.getByRole("button", { name: "Turn on two-step sign-in" })).toBeVisible();
});
