import { expect, test, type Page } from "@playwright/test";
import { brightness, collectErrors } from "./helpers";

const speed = (page: Page) => page.locator(".open-reel .vfd .note");
const speedValue = async (page: Page) => Number((await speed(page).innerText()).replace("−", "-").replace("×", ""));

test.beforeEach(async ({ page }) => {
  await page.goto("/#open-reel");
  await expect(speed(page)).toHaveText("0.00×");
});

test("the deck draws without errors", async ({ page }) => {
  const errors = collectErrors(page);
  await page.waitForTimeout(300);
  expect(await brightness(page, page.locator(".open-reel .deck"))).toBeGreaterThan(0.08);
  expect(errors).toEqual([]);
});

test("play runs the tape at 1×, stop brakes it to a standstill", async ({ page }) => {
  const errors = collectErrors(page);
  const play = page.getByRole("button", { name: "再生" });
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(speed(page)).toHaveText("1.00×");
  await expect(speed(page)).not.toHaveClass(/rest/);
  await expect(page.locator(".open-reel .vfd .row")).not.toContainText("0:00.0");   // the head is moving along the tape
  await page.getByRole("button", { name: "停止" }).click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(speed(page)).toHaveText("0.00×", { timeout: 2000 });
  await expect(speed(page)).toHaveClass(/rest/);
  expect(errors).toEqual([]);
});

test("38 cm/s plays an octave up", async ({ page }) => {
  const rocker = page.getByRole("button", { name: "テープ速度" });
  await expect(rocker).toHaveText("19");
  await rocker.click();
  await expect(rocker).toHaveText("38");
  await page.getByRole("button", { name: "再生" }).click();
  await expect(speed(page)).toHaveText("2.00×");
  await expect(page.locator(".open-reel .vfd .top")).toContainText("38cm/s");
  await expect(page.locator(".open-reel .vfd .row")).toContainText("+1200¢");
});

test("fast wind runs forward and back", async ({ page }) => {
  await page.getByRole("button", { name: "早送り" }).click();
  await expect.poll(() => speedValue(page)).toBeGreaterThan(6);
  await page.getByRole("button", { name: "巻き戻し" }).click();
  await expect.poll(() => speedValue(page)).toBeLessThan(-6);
});

test("turning a reel by hand scratches the tape, and holding it still stops it", async ({ page }) => {
  const box = (await page.locator(".open-reel .deck").boundingBox())!;
  const U = box.width / 16, cx = box.x + 4.05 * U, cy = box.y + 4.1 * U, r = 2.4 * U;
  const at = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  await page.mouse.move(...at(0));
  await page.mouse.down();
  let seen = 0;
  for (let i = 1; i <= 24; i++) {                       // anticlockwise on screen pulls the tape forward
    await page.mouse.move(...at(-i * 0.12));
    if (i % 6 === 0) seen = Math.max(seen, await speedValue(page));
  }
  expect(seen).toBeGreaterThan(0.2);
  await page.waitForTimeout(400);                        // a hand held still
  await expect(speed(page)).toHaveText("0.00×");
  for (let i = 1; i <= 12; i++) await page.mouse.move(...at(-24 * 0.12 + i * 0.12));   // and back the other way
  await expect.poll(() => speedValue(page)).toBeLessThan(0);
  await page.mouse.up();
});

test("tapping the tape knocks a burst past the head, then it settles", async ({ page }) => {
  const errors = collectErrors(page);
  const box = (await page.locator(".open-reel .deck").boundingBox())!;
  const U = box.width / 16;
  await page.mouse.click(box.x + 3.5 * U, box.y + 8.95 * U);
  await expect.poll(() => speedValue(page), { timeout: 500 }).toBeGreaterThan(0.3);
  await expect(speed(page)).toHaveText("0.00×", { timeout: 2000 });
  expect(errors).toEqual([]);
});

test("the pitch knob bends play speed and resets on double-click", async ({ page }) => {
  const knob = page.getByRole("slider", { name: "ピッチ" });
  await page.getByRole("button", { name: "再生" }).click();
  await knob.focus();
  for (let i = 0; i < 10; i++) await knob.press("ArrowRight");   // +100 cents
  await expect(knob).toHaveAttribute("aria-valuenow", "100");
  await expect(speed(page)).toHaveText("1.06×");
  await knob.dblclick();
  await expect(knob).toHaveAttribute("aria-valuenow", "0");
  await expect(speed(page)).toHaveText("1.00×");
});

test("no visible text beyond readouts and the speed switch", async ({ page }) => {
  const visible = await page.locator(".open-reel").evaluate((root) => {
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent!.trim() && !n.parentElement?.closest(".vfd, .rocker")) out.push(n.textContent!.trim());
    return out;
  });
  expect(visible).toEqual([]);
});

test("pulling the tape drags it across the head both ways, and holding it still stops it", async ({ page }) => {
  const box = (await page.locator(".open-reel .deck").boundingBox())!;
  const U = box.width / 16, y = box.y + 8.95 * U;
  let x = box.x + 5 * U;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(450);                       // the knock from touching it dies away
  let fwd = 0;
  for (let i = 0; i < 16; i++) { x += 0.25 * U; await page.mouse.move(x, y + 0.4 * U); if (i % 4 === 3) fwd = Math.max(fwd, await speedValue(page)); }
  expect(fwd).toBeGreaterThan(0.2);                     // rightward is forward
  await page.waitForTimeout(400);
  await expect(speed(page)).toHaveText("0.00×");
  let back = 0;
  for (let i = 0; i < 16; i++) { x -= 0.25 * U; await page.mouse.move(x, y + 0.4 * U); if (i % 4 === 3) back = Math.min(back, await speedValue(page)); }
  expect(back).toBeLessThan(-0.2);
  await page.mouse.up();
});

test("the tape still plays where AudioWorklet isn't allowed (plain-http pages)", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(BaseAudioContext.prototype, "audioWorklet", { get: () => undefined }); });
  const errors = collectErrors(page);
  await page.goto("/#open-reel");
  await page.getByRole("button", { name: "再生" }).click();
  await expect(page.getByRole("button", { name: "再生" })).toHaveAttribute("aria-pressed", "true");
  await expect(speed(page)).toHaveText("1.00×");
  await expect(page.locator(".open-reel .vfd .row")).not.toContainText("0:00.0");   // the main-thread head is reading the tape
  expect(errors).toEqual([]);
});
