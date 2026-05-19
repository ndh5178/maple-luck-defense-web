import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outDir = path.resolve("output/web-game/upgrade-hotkey");
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
await page.evaluate(() => window.mapleDefense.setSpeed(1));

const before = await state();
await page.keyboard.press("q");
await page.keyboard.press("w");
await page.keyboard.press("e");
await page.waitForTimeout(120);
const after = await state();

const ghostText = await page.locator("#upgrade-ghost").innerText();
const dragoonText = await page.locator("#upgrade-dragoon").innerText();
const hydraText = await page.locator("#upgrade-hydra").innerText();
await page.screenshot({ path: path.join(outDir, "upgrade-hotkey.png"), fullPage: true });

const levelsOk =
  after.state.upgrades.ghost.level === 1 &&
  after.state.upgrades.dragoon.level === 1 &&
  after.state.upgrades.hydra.level === 1;
const mineralOk =
  before.state.minerals - after.state.minerals ===
  before.state.upgrades.ghost.cost + before.state.upgrades.dragoon.cost + before.state.upgrades.hydra.cost;
const uiOk = ghostText.includes("Lv.1") && dragoonText.includes("Lv.1") && hydraText.includes("Lv.1");

fs.writeFileSync(
  path.join(outDir, "result.json"),
  JSON.stringify(
    {
      levelsOk,
      mineralOk,
      uiOk,
      beforeMinerals: before.state.minerals,
      afterMinerals: after.state.minerals,
      upgrades: after.state.upgrades,
      ghostText,
      dragoonText,
      hydraText,
    },
    null,
    2,
  ),
  "utf8",
);

if (!levelsOk || !mineralOk || !uiOk) {
  throw new Error("Q/W/E upgrade hotkeys did not apply correctly");
}

if (errors.length) {
  fs.writeFileSync(path.join(outDir, "errors.json"), JSON.stringify(errors, null, 2), "utf8");
  throw new Error("Console or page errors were captured");
}

await browser.close();

async function state() {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text?.()));
}
