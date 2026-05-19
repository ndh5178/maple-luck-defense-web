import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outDir = path.resolve("output/web-game/upgrade-rapid-click");
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

const box = await page.locator("#upgrade-hydra").boundingBox();
const x = box.x + box.width / 2;
const y = box.y + box.height / 2;

for (let i = 0; i < 20; i += 1) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}
await page.waitForTimeout(120);

const state = await page.evaluate(() => window.mapleDefense.getState());
const buttonText = await page.locator("#upgrade-hydra").innerText();
const logText = await page.locator("#roll-log").innerText();
await page.screenshot({ path: path.join(outDir, "upgrade-rapid-click.png"), fullPage: true });

const exactSpendOk = state.minerals === 4;
const levelOk = state.upgrades.hydra.level === 4;
const nextCostOk = state.upgrades.hydra.cost === 14;
const noWrongRaceOk = state.upgrades.ghost.level === 0 && state.upgrades.dragoon.level === 0;
const noNegativeOk = state.minerals >= 0;
const uiOk = buttonText.includes("Lv.4") && buttonText.includes("14M");
const logOk = logText.includes("Lv.4") && !logText.includes("부족");

fs.writeFileSync(
  path.join(outDir, "result.json"),
  JSON.stringify(
    {
      exactSpendOk,
      levelOk,
      nextCostOk,
      noWrongRaceOk,
      noNegativeOk,
      uiOk,
      logOk,
      minerals: state.minerals,
      hydra: state.upgrades.hydra,
      buttonText,
      logText,
    },
    null,
    2,
  ),
  "utf8",
);

if (!exactSpendOk || !levelOk || !nextCostOk || !noWrongRaceOk || !noNegativeOk || !uiOk || !logOk) {
  throw new Error("Rapid upgrade clicks produced an inconsistent state");
}

if (errors.length) {
  fs.writeFileSync(path.join(outDir, "errors.json"), JSON.stringify(errors, null, 2), "utf8");
  throw new Error("Console or page errors were captured");
}

await browser.close();
