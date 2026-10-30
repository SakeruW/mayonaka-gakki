import type { Locator, Page } from "@playwright/test";

/** mean brightness 0..1 of what an element shows on screen (works for WebGL canvases too) */
export async function brightness(page: Page, el: Locator): Promise<number> {
  const png = (await el.screenshot()).toString("base64");
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const x = c.getContext("2d")!;
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return s / (d.length / 4) / 765;
  }, png);
}

/**
 * Listens to what reaches the speakers: everything goes out through one limiter, so tap it there and keep the peak in
 * window.peak. Plain JavaScript so the test compiler leaves it alone; add it with page.addInitScript and reload.
 */
export const LISTEN = `
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

/** the loudest the speakers have been since the last reset */
export const peak = (page: Page) => page.evaluate(() => (window as unknown as { peak: number }).peak);
export const resetPeak = (page: Page) => page.evaluate(() => { (window as unknown as { peak: number }).peak = 0; });

export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
