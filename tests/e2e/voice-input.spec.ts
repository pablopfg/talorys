import { expect, test } from "@playwright/test";

// Chromium's fake microphone plays a tone, so a real clip reaches the (mock) transcriber.
test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
});

test("dictating puts the transcription in the composer for review @mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Owner password").fill(process.env.TALORYS_DEV_PASSWORD || "dev-Owner-violeta-trem-81");
  await page.getByRole("button", { name: "Unlock" }).click();
  const box = page.getByRole("textbox", { name: "Message", exact: true });
  await box.fill("Remind me:");

  await page.getByRole("button", { name: "Dictate a message" }).click();
  await expect(box).toHaveAttribute("placeholder", "Listening… tap ✓ when you finish");
  await expect(page.getByRole("button", { name: "Send message" })).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Finish and transcribe" }).click();

  // Joined to what was typed, and not sent until the owner sends it.
  await expect(box).toHaveValue(/^Remind me: Demo transcription of \d+ s of audio\.$/);
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();

  await page.getByRole("button", { name: "Dictate a message" }).click();
  await page.getByRole("button", { name: "Discard recording" }).click();
  await expect(page.getByRole("button", { name: "Dictate a message" })).toBeVisible();
  await expect(box).toHaveValue(/^Remind me: Demo transcription of \d+ s of audio\.$/);
});
