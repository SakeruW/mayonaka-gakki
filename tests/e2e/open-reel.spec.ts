import { expect, test, type Page } from "@playwright/test";
import { brightness, collectErrors } from "./helpers";

/** the tape's state word (停止, 再生, 逆再生, 録音), top left of its display */
const state = (page: Page) => page.locator(".open-reel .vfd .top span").first();
/** the tape's speed, signed by its direction: the top right says how fast, the top left which way */
export const speedValue = async (page: Page) => {
  const [word, fast] = await page.locator(".open-reel .vfd .top span").allInnerTexts();
  const v = Number(fast.replace("倍", ""));
  return word === "逆再生" ? -v : v;
};
const position = (page: Page) => page.locator(".open-reel .vfd .note");

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
  await expect(state(page)).toHaveText("停止");
});

test("the deck draws without errors and sits still until a hand moves the tape", async ({ page }) => {
  const errors = collectErrors(page);
  await page.waitForTimeout(500);
  expect(await brightness(page, page.locator(".open-reel .deck"))).toBeGreaterThan(0.08);
  await expect(state(page)).toHaveText("停止");
  expect(errors).toEqual([]);
});

test("swinging the lever drags the tape across the head and back; holding it still stops the tape", async ({ page }) => {
  const errors = collectErrors(page);
  const up = await rock(page, -0.05);                          // swinging up draws tape out: forward
  expect(up.extreme).toBeGreaterThanOrEqual(0.1);                 // the display shows tenths: any reading forward
  await expect(position(page)).not.toHaveText("0:00.0");          // the tape moved on past the head
  await page.waitForTimeout(400);
  await expect(state(page)).toHaveText("停止");               // held still
  const d = await deck(page);
  let back = 0, phi = up.phi;
  for (let i = 0; i < 16; i++) { phi += 0.05; const p = onArc(phi); await page.mouse.move(...d.at(p.x, p.y)); back = Math.min(back, await speedValue(page)); }
  expect(back).toBeLessThanOrEqual(-0.1);                      // swinging down lets it back in: backwards
  await page.mouse.up();
  await expect(state(page)).toHaveText("停止", { timeout: 2000 });   // the head read along the tape
  expect(errors).toEqual([]);
});

test("holding ↑ → or ↓ ← swings the lever from the keyboard", async ({ page }) => {
  await page.keyboard.down("ArrowRight");
  await expect.poll(() => speedValue(page)).toBeGreaterThan(0.3);
  await page.keyboard.up("ArrowRight");
  await expect(state(page)).toHaveText("停止", { timeout: 2000 });
  await page.keyboard.down("ArrowLeft");
  await expect.poll(() => speedValue(page)).toBeLessThan(-0.3);
  await page.keyboard.up("ArrowLeft");
});

test("the tape still plays where AudioWorklet isn't allowed (plain-http pages)", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(BaseAudioContext.prototype, "audioWorklet", { get: () => undefined }); });
  const errors = collectErrors(page);
  await page.reload();                                           // injected scripts only run on a real load
  await expect(state(page)).toHaveText("停止");
  await page.keyboard.down("ArrowRight");
  await expect.poll(() => speedValue(page)).toBeGreaterThan(0.3);
  await page.keyboard.up("ArrowRight");
  await expect(position(page)).not.toHaveText("0:00.0");   // the main-thread head read the tape
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

test("once the lever is let go the tape falls silent: the VU needle comes back to rest", async ({ page }) => {
  const needle = page.locator(".open-reel .needle");
  const deg = async () => Number((await needle.evaluate((e) => e.style.transform)).match(/-?[\d.]+/)![0]);
  await page.keyboard.down("ArrowDown"); await page.waitForTimeout(700); await page.keyboard.up("ArrowDown");
  await page.keyboard.down("ArrowUp"); await page.waitForTimeout(450); await page.keyboard.up("ArrowUp");
  await expect.poll(deg, { timeout: 4000 }).toBeLessThan(-46);   // -48 is silence
});

/** listens to what the deck sends to the speakers; plain JavaScript so the test compiler leaves it alone */
const LISTEN = `
  window.peak = 0;
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode && this instanceof DynamicsCompressorNode) {
      const a = this.context.createAnalyser(), d = new Float32Array(2048);
      a.fftSize = 2048; connect.call(this, a);
      setInterval(() => { a.getFloatTimeDomainData(d); for (const v of d) window.peak = Math.max(window.peak, Math.abs(v)); }, 20);
    }
    return connect.call(this, dest, ...rest);
  };`;

for (const head of ["worklet", "main-thread"] as const) {
  test(`sound reaches the speakers while the lever swings (${head} head)`, async ({ page }) => {
    if (head === "main-thread") await page.addInitScript(() => { Object.defineProperty(BaseAudioContext.prototype, "audioWorklet", { get: () => undefined }); });
    await page.addInitScript(LISTEN);
    await page.reload();                                         // injected scripts only run on a real load
    await expect(state(page)).toHaveText("停止");
    const peak = () => page.evaluate(() => (window as unknown as { peak: number }).peak);
    await page.keyboard.down("ArrowDown"); await page.waitForTimeout(700); await page.keyboard.up("ArrowDown");   // swung down: the tape plays back
    await page.waitForTimeout(500);
    await page.evaluate(() => { (window as unknown as { peak: number }).peak = 0; });
    await page.waitForTimeout(400);
    expect(await peak()).toBeLessThan(0.01);                    // nothing while the tape is still
    await page.keyboard.down("ArrowUp"); await page.waitForTimeout(450); await page.keyboard.up("ArrowUp");
    expect(await peak()).toBeGreaterThan(0.1);                   // the loop, dragged past the head
  });
}
