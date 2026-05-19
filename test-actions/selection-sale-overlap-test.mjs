import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outDir = path.resolve("output/web-game/selection-sale-overlap");
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
  api.debugSummon("ghost", "common");
  api.debugSummon("dragoon", "common");
  api.debugSummon("hydra", "common");
});

await page.click(".unit-chip:nth-child(1)");
await page.click(".unit-chip:nth-child(2)", { modifiers: ["Control"] });
await page.click(".unit-chip:nth-child(3)", { modifiers: ["Control"] });
const selectedBeforeSale = await state();

await page.keyboard.press("f");
await page.waitForTimeout(120);
const afterSale = await state();

await page.keyboard.press("d");
await page.waitForTimeout(120);
const afterShortcutSummon = await state();

await page.click("#start-btn");
await page.evaluate(() => {
  const api = window.mapleDefense;
  api.debugSummon("ghost", "common");
  api.debugSummon("dragoon", "common");
  const units = api.getState().units;
  api.debugMoveUnit(units[0].id, 420, 330);
  api.debugMoveUnit(units[1].id, 560, 330);
});
const placed = await state();
const canvasBox = await page.locator("canvas").boundingBox();
const scaleX = canvasBox.width / 900;
const scaleY = canvasBox.height / 640;
const anchor = placed.state.units[0];
const mover = placed.state.units[1];
await dragGame(mover.x, mover.y, 420, 330);
await page.waitForTimeout(120);
const afterOverlapDrag = await state();

await page.screenshot({ path: path.join(outDir, "selection-sale-overlap.png"), fullPage: true });
fs.writeFileSync(path.join(outDir, "selected-before-sale.json"), JSON.stringify(selectedBeforeSale, null, 2), "utf8");
fs.writeFileSync(path.join(outDir, "after-sale.json"), JSON.stringify(afterSale, null, 2), "utf8");
fs.writeFileSync(path.join(outDir, "after-shortcut-summon.json"), JSON.stringify(afterShortcutSummon, null, 2), "utf8");
fs.writeFileSync(path.join(outDir, "after-overlap-drag.json"), JSON.stringify(afterOverlapDrag, null, 2), "utf8");

const selectedCountOk = selectedBeforeSale.state.selectedUnitIds.length === 3;
const saleOk = afterSale.state.units.length === 0 && afterSale.state.minerals === 59;
const summonShortcutOk = afterShortcutSummon.state.units.length === 1 && afterShortcutSummon.state.minerals === 49;
const u1 = afterOverlapDrag.state.units.find((unit) => unit.id === anchor.id);
const u2 = afterOverlapDrag.state.units.find((unit) => unit.id === mover.id);
const distance = Math.hypot(u1.x - u2.x, u1.y - u2.y);
const overlapBlockedOk = distance >= 43.5;
fs.writeFileSync(
  path.join(outDir, "result.json"),
  JSON.stringify({ selectedCountOk, saleOk, summonShortcutOk, overlapBlockedOk, distance }, null, 2),
  "utf8",
);

if (!selectedCountOk || !saleOk || !summonShortcutOk || !overlapBlockedOk) {
  throw new Error("Selection, sale shortcut, summon shortcut, or overlap prevention failed");
}

if (errors.length) {
  fs.writeFileSync(path.join(outDir, "errors.json"), JSON.stringify(errors, null, 2), "utf8");
  throw new Error("Console or page errors were captured");
}

await browser.close();

async function dragGame(x1, y1, x2, y2) {
  await page.mouse.move(canvasBox.x + x1 * scaleX, canvasBox.y + y1 * scaleY);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + x2 * scaleX, canvasBox.y + y2 * scaleY, { steps: 12 });
  await page.mouse.up();
}

async function state() {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text?.()));
}
