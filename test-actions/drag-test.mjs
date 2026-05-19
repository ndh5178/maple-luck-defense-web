import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outDir = path.resolve("output/web-game/drag");
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
await page.click("#summon-btn");
await page.waitForTimeout(100);

const before = await getState();
const unit = before.state.units[0];
const canvasBox = await page.locator("canvas").boundingBox();
const scaleX = canvasBox.width / 900;
const scaleY = canvasBox.height / 640;
const from = {
  x: canvasBox.x + unit.x * scaleX,
  y: canvasBox.y + unit.y * scaleY,
};
const targetGame = { x: 720, y: 455 };
const to = {
  x: canvasBox.x + targetGame.x * scaleX,
  y: canvasBox.y + targetGame.y * scaleY,
};

await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.mouse.move(to.x, to.y, { steps: 12 });
await page.mouse.up();
await page.evaluate(() => window.advanceTime?.(500));

const after = await getState();
await page.screenshot({ path: path.join(outDir, "drag-result.png"), fullPage: true });
fs.writeFileSync(path.join(outDir, "before.json"), JSON.stringify(before, null, 2), "utf8");
fs.writeFileSync(path.join(outDir, "after.json"), JSON.stringify(after, null, 2), "utf8");

const moved = Math.hypot(after.state.units[0].x - unit.x, after.state.units[0].y - unit.y) > 120;
fs.writeFileSync(path.join(outDir, "moved.txt"), String(moved), "utf8");

if (errors.length) {
  fs.writeFileSync(path.join(outDir, "errors.json"), JSON.stringify(errors, null, 2), "utf8");
}

await browser.close();

async function getState() {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text?.()));
}
