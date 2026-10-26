import { expect, test } from "@playwright/test";
import { collectErrors } from "./helpers";

const PAGES = [
  { hash: "", title: "真夜中扇風琴" },          // the fan harp is the front page
  { hash: "#fan-harp", title: "真夜中扇風琴" },
  { hash: "#crt-drums", title: "真夜中ブラウン管" },
  { hash: "#open-reel", title: "真夜中オープンリール" },
  { hash: "#nope", title: "真夜中扇風琴" },
];

for (const { hash, title } of PAGES) {
  test(`${hash || "/"} renders without errors`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/" + hash);
    await expect(page).toHaveTitle(title);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    expect(errors).toEqual([]);
  });
}

test("the nav switches instruments and marks the current one", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "楽器" });
  await expect(nav.getByRole("link", { name: "真夜中扇風琴" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "真夜中ブラウン管" }).click();
  await expect(page).toHaveURL(/#crt-drums$/);
  await expect(nav.getByRole("link", { name: "真夜中ブラウン管" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("真夜中ブラウン管");
  await nav.getByRole("link", { name: "真夜中扇風琴" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("真夜中扇風琴");
});

test("the nav has no visible text", async ({ page }) => {
  await page.goto("/");
  expect((await page.getByRole("navigation", { name: "楽器" }).innerText()).trim()).toBe("");
});
