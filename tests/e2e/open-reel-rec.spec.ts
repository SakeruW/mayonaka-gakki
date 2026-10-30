import { expect, test, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// a fake microphone that Chromium supplies without asking
test.use({
  permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

/** swing the lever all the way down first, then hold it swinging up: a full half-second of tape forward */
async function pushLever(page: Page) {
  await page.keyboard.down("ArrowDown"); await page.waitForTimeout(700); await page.keyboard.up("ArrowDown");
  await page.waitForTimeout(400);                       // the tape settles
  await page.keyboard.down("ArrowRight");
}
async function letGo(page: Page) { await page.keyboard.up("ArrowRight"); }

test("REC records from the mic while the lever pushes the tape forward: the REC lamp lights only then", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/#open-reel");
  const rec = page.getByRole("button", { name: "録音" }), led = page.locator(".open-reel .rec-led");
  await rec.click();
  await expect(rec).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(500);                       // the mic opens
  await expect(led).not.toHaveClass(/on/);
  await pushLever(page);
  await expect(led).toHaveClass(/on/);
  await letGo(page);
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
  await page.waitForTimeout(300);
  await pushLever(page);
  await expect(page.locator(".open-reel .rec-led")).toHaveClass(/on/);
  await rec.click();
  await expect.poll(live).toBe(0);
  await expect(page.locator(".open-reel .rec-led")).not.toHaveClass(/on/);
  await letGo(page);
});

test("a refused mic pops REC back up and flickers the lamp, and playback still works after", async ({ page }) => {
  // the browser says no, as an iPhone does when the page can't record
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await page.goto("/#open-reel");
  const rec = page.getByRole("button", { name: "録音" }), led = page.locator(".open-reel .rec-led");
  await rec.click();
  await expect(rec).toHaveAttribute("aria-pressed", "false");
  await expect(led).toHaveClass(/refused/);
  await pushLever(page);
  await expect(led).not.toHaveClass(/on/);
  await expect(page.locator(".open-reel .vfd .note")).not.toHaveText("0:00.0");   // the tape still plays
  await letGo(page);
});
