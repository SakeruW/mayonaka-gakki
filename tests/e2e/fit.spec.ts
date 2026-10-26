import { expect, test } from "@playwright/test";

// Safari's visible area with its toolbars showing, the tightest case on each phone
const PHONES = [
  { name: "iPhone 15 / 15 Pro", width: 393, height: 659 },
  { name: "iPhone 18 Pro", width: 402, height: 681 },
  { name: "iPhone 18 Pro Max", width: 440, height: 763 },
];
const PAGES = [
  { hash: "#fan-harp", controls: [".fan-harp .stage", ".fan-harp .base > .vfd", ".fan-harp .keys", ".fan-harp .dimmer .knob", ".fan-harp .power", ".fan-harp .tray-btn"] },
  { hash: "#open-reel", controls: [".open-reel .deck", ".open-reel .vfd", ".open-reel .vu", ".open-reel .transport", ".open-reel .pitch .knob", ".open-reel .rocker"] },
  { hash: "#crt-drums", controls: [".crt-drums .rack", ".crt-drums .vfd", ".crt-drums .keys", ".crt-drums .vhold .knob", ".crt-drums .drive .knob", ".crt-drums .rocker"] },
];

test.use({ isMobile: true, hasTouch: true });

for (const phone of PHONES) {
  for (const { hash, controls } of PAGES) {
    test(`${hash} fits one screen on ${phone.name}`, async ({ page }) => {
      await page.setViewportSize({ width: phone.width, height: phone.height });
      await page.goto("/" + hash);
      await page.waitForTimeout(300);
      const { sw, sh } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }));
      expect(sh, "page height").toBeLessThanOrEqual(phone.height);
      expect(sw, "page width").toBeLessThanOrEqual(phone.width);
      for (const sel of controls) {
        const b = (await page.locator(sel).boundingBox())!;
        expect(b, sel).not.toBeNull();
        expect(b.y + b.height, `${sel} bottom`).toBeLessThanOrEqual(phone.height);
        expect(b.x + b.width, `${sel} right`).toBeLessThanOrEqual(phone.width);
        expect(b.x, `${sel} left`).toBeGreaterThanOrEqual(0);
      }
    });
  }
}

test("CRT 強 mode still fits on iPhone 15", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 659 });
  await page.goto("/#crt-drums");
  await page.getByRole("button", { name: "強", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(659);
});

test("the fan's disc tray opens over the fan and stays on screen", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 659 });
  await page.goto("/#fan-harp");
  await page.getByRole("button", { name: "円盤を替える" }).click();
  const tray = (await page.getByRole("region", { name: "円盤" }).boundingBox())!;
  expect(tray.y).toBeGreaterThanOrEqual(0);
  expect(tray.x + tray.width).toBeLessThanOrEqual(393);
});
