import { expect, test } from "@playwright/test";
import { brightness, collectErrors } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/#crt-drums");
  await expect(page.locator(".crt-drums .vfd .note")).toHaveText("--");
});

test("all six screens power on", async ({ page }) => {
  const errors = collectErrors(page);
  const screens = page.locator(".crt-drums .screen");
  await expect(screens).toHaveCount(6);
  await page.waitForTimeout(1600);   // the rasters open one after another
  for (let i = 0; i < 6; i++) expect(await brightness(page, screens.nth(i)), `screen ${i + 1}`).toBeGreaterThan(0.06);
  expect(errors).toEqual([]);
});

test("screens come back after leaving and re-entering", async ({ page }) => {
  const errors = collectErrors(page);
  for (let i = 0; i < 3; i++) {
    await page.getByRole("link", { name: "未来の扇風琴" }).click();
    await page.getByRole("link", { name: "未来のブラウン管" }).click();
  }
  await page.waitForTimeout(1600);
  expect(await brightness(page, page.locator(".crt-drums .screen").last())).toBeGreaterThan(0.06);
  expect(errors).toEqual([]);
});

test("touching a set sounds it and the VFD follows", async ({ page }) => {
  const vfd = page.locator(".crt-drums .vfd");
  await expect(vfd.locator(".note")).toHaveText("--");
  const tv = page.locator(".crt-drums .tv").first();
  const box = (await tv.locator(".screen").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(tv).toHaveClass(/\blit\b/);
  await expect(vfd.locator(".note")).toHaveText("D5");          // 9 stripes on NTSC
  await expect(vfd.locator(".top")).toHaveText("1台目縞9本");          // what is sounding | its stripes
  await expect(vfd.locator(".note")).not.toHaveClass(/rest/);
  await page.mouse.up();
  await expect(tv).not.toHaveClass(/\blit\b/);
  await expect(vfd.locator(".note")).toHaveClass(/rest/);
});

test("▲▼ change the stripes, the OSD and the note", async ({ page }) => {
  const tv = page.locator(".crt-drums .tv").nth(3);   // 4 stripes, C4
  await tv.getByRole("button", { name: "4台目 縞を増やす" }).click();
  await expect(tv.locator(".osd")).toHaveText("5本");
  await expect(tv.locator(".osd")).toHaveClass(/show/);
  await expect(page.locator(".crt-drums .vfd .top")).toHaveText("4台目縞5本");
  await expect(page.locator(".crt-drums .vfd .note")).toHaveText("E4");
});

test("text mode shows the letter and keeps each set's pitch", async ({ page }) => {
  const key = page.getByRole("button", { name: "強", exact: true });
  await expect(key).toHaveText("強");
  await key.click();
  await expect(key).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".crt-drums input")).toHaveCount(0);   // the letter is fixed, nothing to type
  await page.locator("body").press("w");
  await expect(page.locator(".crt-drums .vfd .top")).toHaveText("2台目「強」");
  await expect(page.locator(".crt-drums .vfd .note")).toHaveText("B5");   // 15 stripes
});

test("knobs turn, show their ring, and reset on double-click", async ({ page }) => {
  const knob = page.getByRole("slider", { name: "音程" });
  await knob.focus();
  await knob.press("ArrowRight");
  await expect(knob).toHaveAttribute("aria-valuenow", "10");
  await expect(page.locator(".crt-drums .vhold .lit")).toHaveAttribute("d", /^M/);
  await knob.dblclick();
  await expect(knob).toHaveAttribute("aria-valuenow", "0");
});

test("the 50 | 60 rocker switches the field rate, and the pitch follows", async ({ page }) => {
  const rocker = page.getByRole("button", { name: "フィールド周波数" });
  await expect(rocker).toHaveText("5060");
  await expect(rocker).toHaveAttribute("aria-pressed", "false");   // the 60 half down
  await rocker.click();
  await expect(rocker).toHaveAttribute("aria-pressed", "true");    // the 50 half down
  await page.keyboard.down("q");
  await expect(page.locator(".crt-drums .vfd .note")).toHaveText("B4");   // 9 stripes at 50 Hz: 488 Hz
  await page.keyboard.up("q");
});

test("no visible text beyond readouts and key faces", async ({ page }) => {
  const visible = await page.locator(".crt-drums").evaluate((root) => {
    const skip = (el: Element | null) => !!el?.closest(".vfd, .osd, .rocker, .key");
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent!.trim() && !skip(n.parentElement)) out.push(n.textContent!.trim());
    return out;
  });
  expect(visible).toEqual([]);
});
