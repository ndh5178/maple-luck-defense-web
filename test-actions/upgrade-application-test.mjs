import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outDir = path.resolve("output/web-game/upgrade-application");
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
await page.evaluate(() => {
  const api = window.mapleDefense;
  api.setSpeed(1);
  api.debugSummon("hydra", "common");
});

const before = await state();
await page.click("#upgrade-hydra");
await page.waitForTimeout(120);
const after = await state();
const selectedText = await page.locator("#selected-unit").innerText();
const unitChipText = await page.locator(".unit-chip").first().innerText();
const hydraButtonText = await page.locator("#upgrade-hydra").innerText();
await page.screenshot({ path: path.join(outDir, "upgrade-application.png"), fullPage: true });

const levelOk = before.state.upgrades.hydra.level === 0 && after.state.upgrades.hydra.level === 1;
const mineralOk = before.state.minerals - after.state.minerals === before.state.upgrades.hydra.cost;
const damageOk = after.state.selectedUnit.damage > before.state.selectedUnit.damage;
const selectedUiOk = selectedText.includes("강화 Lv.1") && selectedText.includes(String(after.state.selectedUnit.damage));
const chipUiOk = unitChipText.includes("Lv.1");
const buttonUiOk = hydraButtonText.includes("Lv.1");

fs.writeFileSync(
  path.join(outDir, "result.json"),
  JSON.stringify(
    {
      levelOk,
      mineralOk,
      damageOk,
      selectedUiOk,
      chipUiOk,
      buttonUiOk,
      beforeDamage: before.state.selectedUnit.damage,
      afterDamage: after.state.selectedUnit.damage,
      selectedText,
      unitChipText,
      hydraButtonText,
    },
    null,
    2,
  ),
  "utf8",
);

if (!levelOk || !mineralOk || !damageOk || !selectedUiOk || !chipUiOk || !buttonUiOk) {
  throw new Error("Upgrade did not apply or render immediately");
}

if (errors.length) {
  fs.writeFileSync(path.join(outDir, "errors.json"), JSON.stringify(errors, null, 2), "utf8");
  throw new Error("Console or page errors were captured");
}

await browser.close();

async function state() {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text?.()));
}
