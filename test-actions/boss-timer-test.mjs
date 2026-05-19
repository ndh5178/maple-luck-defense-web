import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outDir = path.resolve("output/web-game/boss-timer");
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
  api.debugStartWave(24);
  window.advanceTime?.(200);
});

const atStart = await state();
await page.evaluate(() => window.mapleDefense.advanceFastForTest(319_000));
const nearEnd = await state();
await page.evaluate(() => window.mapleDefense.advanceFastForTest(1_200));
const afterTimeout = await state();

await page.screenshot({ path: path.join(outDir, "boss-timeout.png"), fullPage: true });
fs.writeFileSync(path.join(outDir, "at-start.json"), JSON.stringify(atStart, null, 2), "utf8");
fs.writeFileSync(path.join(outDir, "near-end.json"), JSON.stringify(nearEnd, null, 2), "utf8");
fs.writeFileSync(path.join(outDir, "after-timeout.json"), JSON.stringify(afterTimeout, null, 2), "utf8");

const startsAtLimit = atStart.state.bossTimeLimitMs === 320_000 && atStart.state.bossTimeLeftMs <= 320_000;
const countsDown = nearEnd.state.bossTimeLeftMs > 0 && nearEnd.state.bossTimeLeftMs < 2_000;
const timeoutEndsRun = afterTimeout.state.mode === "ended" && afterTimeout.state.result?.cleared === false;
const reasonOk = afterTimeout.state.result?.defeatReason?.includes("제한시간 초과");
const timerTextOk = (await page.locator("#timer-value").innerText()) === "--";

fs.writeFileSync(
  path.join(outDir, "result.json"),
  JSON.stringify({ startsAtLimit, countsDown, timeoutEndsRun, reasonOk, timerTextOk }, null, 2),
  "utf8",
);

if (!startsAtLimit || !countsDown || !timeoutEndsRun || !reasonOk || !timerTextOk) {
  throw new Error("Boss timer did not count down or end the run correctly");
}

if (errors.length) {
  fs.writeFileSync(path.join(outDir, "errors.json"), JSON.stringify(errors, null, 2), "utf8");
  throw new Error("Console or page errors were captured");
}

await browser.close();

async function state() {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text?.()));
}
