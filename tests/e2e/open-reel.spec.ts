import { expect, test, type Page } from "@playwright/test";
import { brightness, collectErrors } from "./helpers";

const speed = (page: Page) => page.locator(".open-reel .vfd .note");
export const speedValue = async (page: Page) => Number((await speed(page).innerText()).replace("−", "-").replace("×", ""));

/** the deck in deck units: 10 across */
async function deck(page: Page) {
  const box = (await page.locator(".open-reel .deck").boundingBox())!;
  const U = box.width / 10;
  return { at: (x: number, y: number) => [box.x + x * U, box.y + y * U] as const, U };
}

const HINGE = { x: 6.85, y: 9.1 };
/** a point on the lever's arc, `r` along it, at swing `phi` below the horizontal */
const onArc = (phi: number, r = 1.9) => ({ x: HINGE.x + r * Math.cos(phi), y: HINGE.y + r * Math.sin(phi) });

/** take hold of the lever at rest and swing it from 0.87 by `dphi` per step, report the extreme speed seen */
export async function rock(page: Page, dphi: number, steps = 10, from = 0.87) {
  const d = await deck(page);
  let phi = from;
  await page.mouse.move(...d.at(onArc(phi).x, onArc(phi).y));
  await page.mouse.down();
  let extreme = 0;
  for (let i = 0; i < steps; i++) {
    phi += dphi; const p = onArc(phi);
    await page.mouse.move(...d.at(p.x, p.y));
    const v = await speedValue(page);
    extreme = Math.abs(v) > Math.abs(extreme) ? v : extreme;
  }
  return { extreme, phi };
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

test("swinging the lever drags the tape across the head and back; holding it still stops the tape", async ({ page }) => {
  const errors = collectErrors(page);
  const up = await rock(page, -0.05);                          // swinging up draws tape out: forward
  expect(up.extreme).toBeGreaterThan(0.3);
  await page.waitForTimeout(400);
  await expect(speed(page)).toHaveText("0.00×");               // held still
  const d = await deck(page);
  let back = 0, phi = up.phi;
  for (let i = 0; i < 16; i++) { phi += 0.05; const p = onArc(phi); await page.mouse.move(...d.at(p.x, p.y)); back = Math.min(back, await speedValue(page)); }
  expect(back).toBeLessThan(-0.3);                             // swinging down lets it back in: backwards
  await page.mouse.up();
  await expect(speed(page)).toHaveText("0.00×", { timeout: 2000 });
  await expect(page.locator(".open-reel .vfd .row")).not.toContainText("0:00.0");   // the head read along the tape
  expect(errors).toEqual([]);
});

test("holding ↑ → or ↓ ← swings the lever from the keyboard", async ({ page }) => {
  await page.keyboard.down("ArrowRight");
  await expect.poll(() => speedValue(page)).toBeGreaterThan(0.3);
  await page.keyboard.up("ArrowRight");
  await expect(speed(page)).toHaveText("0.00×", { timeout: 2000 });
  await page.keyboard.down("ArrowLeft");
  await expect.poll(() => speedValue(page)).toBeLessThan(-0.3);
  await page.keyboard.up("ArrowLeft");
});

test("turning the reel by hand still scratches the tape", async ({ page }) => {
  const d = await deck(page), r = 1.7;
  const at = (a: number) => d.at(3.4 + r * Math.cos(a), 3.05 + r * Math.sin(a));
  await page.mouse.move(...at(0));
  await page.mouse.down();
  let seen = 0;
  for (let i = 1; i <= 24; i++) { await page.mouse.move(...at(i * 0.12)); if (i % 6 === 0) seen = Math.max(seen, await speedValue(page)); }
  expect(seen).toBeGreaterThan(0.2);                           // clockwise feeds the tape down to the heads
  await page.mouse.up();
});

test("tapping the tape knocks a burst past the head, then it settles", async ({ page }) => {
  const errors = collectErrors(page);
  await page.mouse.click(...(await deck(page)).at(6.08, 6.0));
  await expect.poll(() => speedValue(page), { timeout: 500 }).toBeGreaterThan(0.3);
  await expect(speed(page)).toHaveText("0.00×", { timeout: 2000 });
  expect(errors).toEqual([]);
});

test("pulling the tape by hand drags it past the heads both ways", async ({ page }) => {
  const d = await deck(page);
  let [x, y] = d.at(6.08, 5.95);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(450);
  let fwd = 0;
  for (let i = 0; i < 12; i++) { y += 0.2 * d.U; await page.mouse.move(x + 0.4 * d.U, y); fwd = Math.max(fwd, await speedValue(page)); }
  expect(fwd).toBeGreaterThan(0.2);                             // pulled down: forward
  let back = 0;
  for (let i = 0; i < 12; i++) { y -= 0.2 * d.U; await page.mouse.move(x + 0.4 * d.U, y); back = Math.min(back, await speedValue(page)); }
  expect(back).toBeLessThan(-0.2);
  await page.mouse.up();
});

test("the tape still plays where AudioWorklet isn't allowed (plain-http pages)", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(BaseAudioContext.prototype, "audioWorklet", { get: () => undefined }); });
  const errors = collectErrors(page);
  await page.goto("/#open-reel");
  await page.mouse.click(...(await deck(page)).at(6.08, 6.0));   // wake the audio
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
