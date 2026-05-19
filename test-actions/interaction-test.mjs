import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outDir = path.resolve("output/web-game/interaction");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
const errors = [];

page.on("console", (msg) => {
  if (msg.type() === "error") errors.push({ type: "console", text: msg.text() });
});
page.on("pageerror", (error) => errors.push({ type: "pageerror", text: String(error) }));

await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(500);

await page.click("#start-btn");
for (let i = 0; i < 5; i += 1) await page.click("#summon-btn");
await clickIfEnabled("#upgrade-hydra");
await clickIfEnabled("#upgrade-ghost");
await page.evaluate(() => window.advanceTime?.(6000));
await page.screenshot({ path: path.join(outDir, "after-actions.png"), fullPage: true });
const actionState = await page.evaluate(() => window.render_game_to_text?.());
fs.writeFileSync(path.join(outDir, "after-actions-state.json"), actionState ?? "null", "utf8");

await page.click(".unit-chip");
await page.click("#sell-btn");
await page.evaluate(() => window.advanceTime?.(1000));
const sellState = await page.evaluate(() => window.render_game_to_text?.());
fs.writeFileSync(path.join(outDir, "after-sell-state.json"), sellState ?? "null", "utf8");

await page.click("#start-btn");
await page.evaluate(() => window.advanceTime?.(90000));
await page.screenshot({ path: path.join(outDir, "result.png"), fullPage: true });
const resultState = await page.evaluate(() => window.render_game_to_text?.());
fs.writeFileSync(path.join(outDir, "result-state.json"), resultState ?? "null", "utf8");

const resultVisible = await page.locator("#result-modal:not(.hidden)").count();
if (resultVisible) {
  await page.fill("#nickname-input", "테스터");
  await page.click("#save-score-btn");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, "saved-score.png"), fullPage: true });
  const leaderboard = await page.locator("#leaderboard").innerText();
  fs.writeFileSync(path.join(outDir, "leaderboard.txt"), leaderboard, "utf8");
}

if (errors.length) {
  fs.writeFileSync(path.join(outDir, "errors.json"), JSON.stringify(errors, null, 2), "utf8");
}

await browser.close();

async function clickIfEnabled(selector) {
  const enabled = await page.locator(`${selector}:not(:disabled)`).count();
  if (enabled) await page.click(selector);
}
