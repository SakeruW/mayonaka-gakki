import { expect, test, type Page } from "@playwright/test";
import { brightness, collectErrors } from "./helpers";

const speed = (page: Page) => page.locator(".open-reel .vfd .note");
export const speedValue = async (page: Page) => Number((await speed(page).innerText()).replace("−", "-").replace("×", ""));

/** the deck in deck units: 16 across */
async function deck(page: Page) {
  const box = (await page.locator(".open-reel .deck").boundingBox())!;
  const U = box.width / 16;
  return { at: (x: number, y: number) => [box.x + x * U, box.y + y * U] as const, U };
}

/** take hold of the lever halfway up, rock it `steps` times by `dx` deck units, report the extreme speed seen */
export async function rock(page: Page, dx: number, steps = 10, hold = true) {
  const d = await deck(page);
  let [x, y] = d.at(13, 10.1);
  await page.mouse.move(x, y);
  await page.mouse.down();
  let extreme = 0;
  for (let i = 0; i < steps; i++) {
    x += dx * d.U; await page.mouse.move(x, y);
    const v = await speedValue(page);
    extreme = Math.abs(v) > Math.abs(extreme) ? v : extreme;
  }
  if (!hold) await page.mouse.up();
  return extreme;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/#open-reel");
  await expect(speed(page)).toHaveText("0.00×");
});

test("the deck draws without errors and sits still until a hand moves the tape", async ({ page }) => {
  const errors = collectErrors(page);
  await page.waitForTimeout(500);
  expect(await brightness(page, page.locator(".open-reel .deck"))).toBeGreaterThan(0.08);
  await expect(speed(page)).toHaveText("0.00×");
  expect(errors).toEqual([]);
});

test("rocking the lever drags the tape across the head and back; holding it still stops the tape", async ({ page }) => {
  const errors = collectErrors(page);
  expect(await rock(page, 0.12)).toBeGreaterThan(0.3);        // rightward: forward
  await page.waitForTimeout(400);
  await expect(speed(page)).toHaveText("0.00×");               // held still
  const [x, y] = (await deck(page)).at(13, 10.1);
  let back = 0;
  for (let i = 0; i < 10; i++) { await page.mouse.move(x + 1.2 * (await deck(page)).U - i * 0.24 * (await deck(page)).U, y); back = Math.min(back, await speedValue(page)); }
  expect(back).toBeLessThan(-0.3);                             // leftward: backwards
  await page.mouse.up();
  await expect(speed(page)).toHaveText("0.00×", { timeout: 2000 });
  await expect(page.locator(".open-reel .vfd .row")).not.toContainText("0:00.0");   // the head read along the tape
  expect(errors).toEqual([]);
});

test("holding ← or → rocks the lever from the keyboard", async ({ page }) => {
  await page.keyboard.down("ArrowRight");
  await expect.poll(() => speedValue(page)).toBeGreaterThan(0.3);
  await page.keyboard.up("ArrowRight");
  await expect(speed(page)).toHaveText("0.00×", { timeout: 2000 });
  await page.keyboard.down("ArrowLeft");
  await expect.poll(() => speedValue(page)).toBeLessThan(-0.3);
  await page.keyboard.up("ArrowLeft");
});

test("turning the reel by hand still scratches the tape", async ({ page }) => {
  const d = await deck(page), r = 2.4;
  const at = (a: number) => d.at(4.05 + r * Math.cos(a), 4.1 + r * Math.sin(a));
  await page.mouse.move(...at(0));
  await page.mouse.down();
  let seen = 0;
  for (let i = 1; i <= 24; i++) { await page.mouse.move(...at(-i * 0.12)); if (i % 6 === 0) seen = Math.max(seen, await speedValue(page)); }
  expect(seen).toBeGreaterThan(0.2);                           // anticlockwise feeds the tape forward
  await page.mouse.up();
});

test("tapping the tape knocks a burst past the head, then it settles", async ({ page }) => {
  const errors = collectErrors(page);
  await page.mouse.click(...(await deck(page)).at(3.5, 8.95));
  await expect.poll(() => speedValue(page), { timeout: 500 }).toBeGreaterThan(0.3);
  await expect(speed(page)).toHaveText("0.00×", { timeout: 2000 });
  expect(errors).toEqual([]);
});

test("pulling the tape by hand drags it across the head both ways", async ({ page }) => {
  const d = await deck(page);
  let [x, y] = d.at(3, 8.95);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(450);
  let fwd = 0;
  for (let i = 0; i < 12; i++) { x += 0.25 * d.U; await page.mouse.move(x, y + 0.4 * d.U); fwd = Math.max(fwd, await speedValue(page)); }
  expect(fwd).toBeGreaterThan(0.2);
  let back = 0;
  for (let i = 0; i < 12; i++) { x -= 0.25 * d.U; await page.mouse.move(x, y + 0.4 * d.U); back = Math.min(back, await speedValue(page)); }
  expect(back).toBeLessThan(-0.2);
  await page.mouse.up();
});

test("the tape still plays where AudioWorklet isn't allowed (plain-http pages)", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(BaseAudioContext.prototype, "audioWorklet", { get: () => undefined }); });
  const errors = collectErrors(page);
  await page.goto("/#open-reel");
  await page.mouse.click(...(await deck(page)).at(3.5, 8.95));   // wake the audio
  await page.waitForTimeout(300);
  await page.keyboard.down("ArrowRight");
  await expect.poll(() => speedValue(page)).toBeGreaterThan(0.3);
  await page.keyboard.up("ArrowRight");
  await expect(page.locator(".open-reel .vfd .row")).not.toContainText("0:00.0");   // the main-thread head read the tape
  expect(errors).toEqual([]);
});

test("no visible text beyond the readouts", async ({ page }) => {
  const visible = await page.locator(".open-reel").evaluate((root) => {
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent!.trim() && !n.parentElement?.closest(".vfd")) out.push(n.textContent!.trim());
    return out;
  });
  expect(visible).toEqual([]);
});
