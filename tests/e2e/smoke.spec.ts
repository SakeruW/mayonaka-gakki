import { expect, test } from "@playwright/test";

const PAGES = [
  { hash: "", title: "真夜中楽器" },
  { hash: "#fan-harp", title: "真夜中扇風琴" },
  { hash: "#crt-drums", title: "真夜中ブラウン管" },
  { hash: "#open-reel", title: "真夜中オープンリール" },
];

for (const { hash, title } of PAGES) {
  test(`${hash || "lobby"} renders without errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto("/" + hash);
    await expect(page).toHaveTitle(title);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    expect(errors).toEqual([]);
  });
}

test("lobby machines lead to each instrument and back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "真夜中ブラウン管" }).click();
  await expect(page).toHaveURL(/#crt-drums$/);
  await page.getByRole("link", { name: "ロビーへ戻る" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("真夜中楽器");
});
