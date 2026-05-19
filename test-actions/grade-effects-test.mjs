import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outDir = path.resolve("output/web-game/grade-effects");
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

const specials = await page.evaluate(() => {
  const api = window.mapleDefense;
  api.setSpeed(1);
  api.debugSummon("ghost", "legendary");
  api.debugSummon("dragoon", "unique");
  api.debugSummon("hydra", "mythic");
  api.debugSummon("ghost", "origin");
  return api.getState().units.map((unit) => {
    api.selectUnit(unit.id);
    return api.getState().selectedUnit?.special;
  });
});

const placedState = JSON.parse(await page.evaluate(() => window.render_game_to_text?.()));
const canvasBox = await page.locator("canvas").boundingBox();
const scaleX = canvasBox.width / 900;
const scaleY = canvasBox.height / 640;
const targets = [
  { x: 230, y: 150 },
  { x: 330, y: 150 },
  { x: 430, y: 150 },
  { x: 530, y: 150 },
];

for (let i = 0; i < placedState.state.units.length; i += 1) {
  const unit = placedState.state.units[i];
  const target = targets[i];
  await page.mouse.move(canvasBox.x + unit.x * scaleX, canvasBox.y + unit.y * scaleY);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + target.x * scaleX, canvasBox.y + target.y * scaleY, { steps: 10 });
  await page.mouse.up();
}

await page.evaluate(() => window.advanceTime?.(1800));
await page.screenshot({ path: path.join(outDir, "grade-effects.png"), fullPage: true });

const textState = await page.evaluate(() => window.render_game_to_text?.());
fs.writeFileSync(path.join(outDir, "state.json"), textState ?? "null", "utf8");
fs.writeFileSync(path.join(outDir, "specials.json"), JSON.stringify(specials, null, 2), "utf8");

const parsed = JSON.parse(textState);
const requiredLabels = ["전설", "EMP", "신화", "태초"];
for (const label of requiredLabels) {
  if (!specials.some((special) => special?.includes(label))) {
    throw new Error(`Missing special label: ${label}`);
  }
}

if (parsed.state.units.length < 4) throw new Error("Expected forced high-grade units");
if (parsed.state.kills <= 0 && parsed.visibleMonsters.length === 0) {
  throw new Error("Expected combat to progress after advancing time");
}

if (errors.length) {
  fs.writeFileSync(path.join(outDir, "errors.json"), JSON.stringify(errors, null, 2), "utf8");
  throw new Error("Console or page errors were captured");
}

await browser.close();
