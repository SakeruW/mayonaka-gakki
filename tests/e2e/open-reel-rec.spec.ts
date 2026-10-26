import { expect, test } from "@playwright/test";
import { collectErrors } from "./helpers";

// a fake microphone that Chromium supplies without asking
test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

test("REC with PLAY records from the mic: the REC lamp lights only while tape is moving", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/#open-reel");
  const rec = page.getByRole("button", { name: "録音" }), led = page.locator(".open-reel .rec-led");
  await rec.click();
  await expect(rec).toHaveAttribute("aria-pressed", "true");
  await expect(led).not.toHaveClass(/on/);
  await page.getByRole("button", { name: "再生" }).click();
  await expect(led).toHaveClass(/on/);
  await page.getByRole("button", { name: "停止" }).click();
  await expect(led).not.toHaveClass(/on/);
  await rec.click();
  await expect(rec).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});
