import { expect, test } from "@playwright/test";
import { brightness, collectErrors } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/#crt-drums");
  await expect(page.locator(".crt-drums .vfd .top")).toContainText("Hz");
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
    await page.getByRole("link", { name: "真夜中扇風琴" }).click();
    await page.getByRole("link", { name: "真夜中ブラウン管" }).click();
  }
  await page.waitForTimeout(1600);
  expect(await brightness(page, page.locator(".crt-drums .screen").last())).toBeGreaterThan(0.06);
  expect(errors).toEqual([]);
});

test("touching a set sounds it and the VFD follows", async ({ page }) => {
  const vfd = page.locator(".crt-drums .vfd");
  await expect(vfd.locator(".note")).toHaveText("12:00");
  const tv = page.locator(".crt-drums .tv").first();
  const box = (await tv.locator(".screen").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(tv).toHaveClass(/\blit\b/);
  await expect(vfd.locator(".note")).toHaveText("E4");          // 5 stripes on NTSC
  await expect(vfd.locator(".top")).toContainText("1台目　縞5本");
  await expect(vfd.locator(".note")).not.toHaveClass(/rest/);
  await page.mouse.up();
  await expect(tv).not.toHaveClass(/\blit\b/);
  await expect(vfd.locator(".note")).toHaveClass(/rest/);
});

test("▲▼ change the stripes, the OSD and the note", async ({ page }) => {
  const tv = page.locator(".crt-drums .tv").nth(3);   // 2 stripes, C3
  await tv.getByRole("button", { name: "4台目 縞を増やす" }).click();
  await expect(tv.locator(".osd")).toHaveText("3本");
  await expect(tv.locator(".osd")).toHaveClass(/show/);
  await expect(page.locator(".crt-drums .vfd .top")).toContainText("4台目　縞3本");
  await expect(page.locator(".crt-drums .vfd .note")).toHaveText("G3");
});

test("text mode shows the letter and keeps each set's pitch", async ({ page }) => {
  await page.getByRole("button", { name: "文字" }).click();
  await expect(page.getByRole("textbox", { name: "画面の文字" })).toBeVisible();
  await page.locator("body").press("w");
  await expect(page.locator(".crt-drums .vfd .top")).toContainText("2台目　「強」");
  await expect(page.locator(".crt-drums .vfd .note")).toHaveText("G4");   // 6 stripes
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

test("60i/50i rocker switches the field rate", async ({ page }) => {
  const rocker = page.getByRole("button", { name: "フィールド周波数" });
  await expect(rocker).toHaveText("60i");
  await rocker.click();
  await expect(rocker).toHaveText("50i");
  await expect(page.locator(".crt-drums .vfd .top")).toContainText("50.00Hz");
});

test("no visible text beyond the title, readouts and the screen-text input", async ({ page }) => {
  const visible = await page.locator(".crt-drums").evaluate((root) => {
    const skip = (el: Element | null) => !!el?.closest(".vfd, .osd, .rocker, .key");
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent!.trim() && !skip(n.parentElement)) out.push(n.textContent!.trim());
    return out;
  });
  expect(visible).toEqual([]);
});
