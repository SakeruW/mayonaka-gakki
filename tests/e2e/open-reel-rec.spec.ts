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

test("switching REC off releases the microphone, and arming again reopens it", async ({ page }) => {
  // keep hold of every stream the page opens, to see whether its tracks are still live
  await page.addInitScript(() => {
    const md = navigator.mediaDevices, open = md.getUserMedia.bind(md), w = window as unknown as { streams: MediaStream[] };
    w.streams = [];
    md.getUserMedia = async (c) => { const s = await open(c); w.streams.push(s); return s; };
  });
  await page.goto("/#open-reel");
  const live = () => page.evaluate(() => (window as unknown as { streams: MediaStream[] }).streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").length);
  const rec = page.getByRole("button", { name: "録音" });
  expect(await live()).toBe(0);
  await rec.click();
  await expect.poll(live).toBe(1);
  await rec.click();
  await expect.poll(live).toBe(0);                      // the browser's mic indicator goes off
  await rec.click();
  await expect.poll(live).toBe(1);
  await page.getByRole("button", { name: "再生" }).click();
  await expect(page.locator(".open-reel .rec-led")).toHaveClass(/on/);
  await rec.click();
  await expect.poll(live).toBe(0);
  await expect(page.locator(".open-reel .rec-led")).not.toHaveClass(/on/);
});
