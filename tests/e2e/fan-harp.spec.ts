import { expect, test } from "@playwright/test";
import { brightness, collectErrors } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/#fan-harp");
  await expect(page.locator(".fan-harp .base > .vfd .top")).toContainText("rpm");   // the rig is running
});

const note = (page: import("@playwright/test").Page) => page.locator(".fan-harp .base > .vfd .note");
const top = (page: import("@playwright/test").Page) => page.locator(".fan-harp .base > .vfd .top");

test("the fan draws and spins without errors", async ({ page }) => {
  const errors = collectErrors(page);
  await page.waitForTimeout(500);
  expect(await brightness(page, page.locator(".fan-harp .stage"))).toBeGreaterThan(0.1);
  await expect(page.locator(".fan-harp .base > .vfd .top")).toContainText("rpm");
  expect(errors).toEqual([]);
});

test("a ring key sounds that ring", async ({ page }) => {
  await expect(note(page)).toHaveText("--");
  await page.keyboard.down("1");
  await expect(top(page)).toContainText("1輪目　24穴");
  await expect(note(page)).toHaveText("B♭3");             // 24 holes at 中, two semitones under C4
  await expect(note(page)).not.toHaveClass(/rest/);
  await page.keyboard.up("1");
  await expect(note(page)).toHaveText("--");
  await expect(note(page)).toHaveClass(/rest/);
});

test("dragging the pick onto the disc plays the ring under it", async ({ page }) => {
  const b = (await page.locator(".fan-harp .stage").boundingBox())!;
  const R = b.width / 2 * 0.8;
  await page.mouse.move(b.x + b.width / 2 + 0.6 * R, b.y + b.height / 2);
  await page.mouse.down();
  await expect(top(page)).toContainText("4輪目　32穴");
  await page.mouse.up();
  await expect(note(page)).toHaveText("--");
});

test("強 spins up to the full note", async ({ page }) => {
  await page.getByRole("button", { name: "強" }).click();
  await page.keyboard.down("1");
  await expect(note(page)).toHaveText("C4", { timeout: 10_000 });   // 24 × 654 / 60 = 261.6 Hz
  await page.keyboard.up("1");
});

test("the bulb switch silences the pick", async ({ page }) => {
  await page.keyboard.down("1");
  await expect(note(page)).toHaveText("B♭3");
  const power = page.getByRole("button", { name: "電球" });
  await expect(power).toHaveAttribute("aria-pressed", "true");
  await power.click();
  await expect(power).toHaveAttribute("aria-pressed", "false");
  await expect(note(page)).toHaveText("--");
  await page.keyboard.up("1");
});

test("switching discs rebuilds the rings (was a crash)", async ({ page }) => {
  const errors = collectErrors(page);
  await page.getByRole("button", { name: "円盤を替える" }).click();
  await page.getByRole("button", { name: "ハ調8輪" }).click();
  await page.keyboard.press("v");                                  // 強
  await page.keyboard.down("7");
  await expect(top(page)).toContainText("7輪目　40穴");
  await expect(note(page)).toHaveText("A4");                      // 40 × 654 / 60 = 436 Hz
  await page.keyboard.up("7");
  expect(errors).toEqual([]);
});

test("+ makes a disc from chosen notes; rings can be set, added and removed; it is kept", async ({ page }) => {
  const errors = collectErrors(page);
  await page.getByRole("button", { name: "円盤を替える" }).click();
  await page.getByRole("button", { name: "円盤を作る" }).click();
  await expect(page.getByRole("button", { name: "自作1" })).toHaveAttribute("aria-pressed", "true");
  const rows = page.locator(".fan-harp .scale li");
  await expect(rows).toHaveCount(8);
  await page.getByRole("combobox", { name: "1輪目の音" }).selectOption("A2");
  await page.getByRole("combobox", { name: "2輪目の音" }).selectOption("G3");
  await page.getByRole("button", { name: "8輪目を外す" }).click();
  await expect(rows).toHaveCount(7);
  await page.getByRole("button", { name: "輪を足す" }).click();
  await expect(rows).toHaveCount(8);
  await page.locator(".fan-harp h1, h1").first().click();         // close the tray; keys go to the fan again
  await page.keyboard.press("v");
  await page.keyboard.down("1");
  await expect(note(page)).toHaveText("A2");
  await page.keyboard.up("1");
  await page.keyboard.down("2");
  await expect(note(page)).toHaveText("G3");
  await page.keyboard.up("2");

  await page.reload();
  await page.getByRole("button", { name: "円盤を替える" }).click();
  await page.getByRole("button", { name: "自作1" }).click();
  await expect(page.getByRole("combobox", { name: "1輪目の音" })).toHaveValue("A2");
  await page.getByRole("button", { name: "この円盤を消す" }).click();
  await expect(page.getByRole("button", { name: "自作1" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "C4〜C5" })).toHaveAttribute("aria-pressed", "true");   // back to the disc it opens on
  expect(errors).toEqual([]);
});

test("the dimmer turns, shows its ring, and resets on double-click", async ({ page }) => {
  const knob = page.getByRole("slider", { name: "ディマー" });
  await knob.focus();
  await knob.press("ArrowRight");
  await expect(knob).toHaveAttribute("aria-valuenow", "10");
  await expect(page.locator(".fan-harp .dimmer .lit")).toHaveAttribute("d", /^M/);
  await knob.dblclick();
  await expect(knob).toHaveAttribute("aria-valuenow", "0");
});

test("no visible text beyond readouts and keys", async ({ page }) => {
  const visible = await page.locator(".fan-harp").evaluate((root) => {
    const skip = (el: Element | null) => !!el?.closest(".vfd, .key");
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent!.trim() && !skip(n.parentElement)) out.push(n.textContent!.trim());
    return out;
  });
  expect(visible).toEqual([]);
});

test("the disc tray opens, closes on a tap elsewhere, and its parts have no visible text", async ({ page }) => {
  const btn = page.getByRole("button", { name: "円盤を替える" });
  const tray = page.getByRole("region", { name: "円盤" });
  await expect(tray).toBeHidden();
  await btn.click();
  await expect(btn).toHaveAttribute("aria-expanded", "true");
  await expect(tray).toBeVisible();
  const stray = await tray.evaluate((root) => {
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent!.trim() && !n.parentElement?.closest(".vfd")) out.push(n.textContent!.trim());
    return out;
  });
  expect(stray).toEqual([]);
  await page.locator(".fan-harp .base > .vfd").click();
  await expect(tray).toBeHidden();
});

test("the tray reads the disc's scale and lights the ring that sounds", async ({ page }) => {
  await page.getByRole("button", { name: "円盤を替える" }).click();
  const scale = page.locator(".fan-harp .scale");
  await expect(scale.locator(".top")).toContainText("純正律");
  await expect(scale.locator(".top")).toContainText("強 654rpm");
  const rows = scale.locator("li");
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(0)).toContainText("24穴1/1C4±0¢261.6Hz");   // the disc at its 強 speed
  await expect(rows.nth(1)).toContainText("27穴9/8D4");
  await page.keyboard.down("5");
  await expect(rows.nth(4)).toHaveClass(/on/, { timeout: 10_000 });
  await page.keyboard.up("5");
  await page.getByRole("button", { name: "円盤を作る" }).click();
  await expect(scale.locator(".top")).not.toContainText("純正律");   // equal-tempered notes, fitted
});

test("on arrival the disc winds up from a standstill to 中", async ({ page }) => {
  await page.goto("/#crt-drums");
  await page.goto("/#fan-harp");
  const rpm = async () => Number((await page.locator(".fan-harp .base > .vfd .top").innerText()).match(/(\d+)rpm/)![1]);
  await page.waitForTimeout(400);
  const early = await rpm();
  expect(early).toBeLessThan(80);                       // creeping, not jumping
  await page.waitForTimeout(1200);
  const mid = await rpm();
  expect(mid).toBeGreaterThan(early);
  expect(mid).toBeLessThan(500);                        // still building
  await expect.poll(rpm, { timeout: 8000 }).toBeGreaterThan(565);   // 中 = 583 rpm
});
