import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outDir = path.resolve("output/web-game/multi-drag");
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
for (let i = 0; i < 4; i += 1) await page.click("#summon-btn");
await page.waitForTimeout(100);

const canvasBox = await page.locator("canvas").boundingBox();
const scaleX = canvasBox.width / 900;
const scaleY = canvasBox.height / 640;

await dragGame(300, 230, 640, 430);
let selectedState = await getState();

const before = selectedState.state.units.slice(0, 2).map((unit) => ({ id: unit.id, x: unit.x, y: unit.y }));
const lead = selectedState.state.units.find((unit) => selectedState.state.selectedUnitIds.includes(unit.id));
await dragGame(lead.x, lead.y, lead.x + 120, lead.y + 72);
await page.evaluate(() => window.advanceTime?.(500));

const after = await getState();
await page.screenshot({ path: path.join(outDir, "multi-drag-result.png"), fullPage: true });
fs.writeFileSync(path.join(outDir, "before.json"), JSON.stringify(selectedState, null, 2), "utf8");
fs.writeFileSync(path.join(outDir, "after.json"), JSON.stringify(after, null, 2), "utf8");

const movedUnits = after.state.units.filter((unit) => {
  const old = selectedState.state.units.find((candidate) => candidate.id === unit.id);
  return old && selectedState.state.selectedUnitIds.includes(unit.id) && Math.hypot(unit.x - old.x, unit.y - old.y) > 40;
});
const ok = selectedState.state.selectedUnitIds.length >= 2 && movedUnits.length >= 2;
fs.writeFileSync(path.join(outDir, "multi-moved.txt"), String(ok), "utf8");

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

async function getState() {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text?.()));
}
