import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outDir = path.resolve("output/web-game/autoplay");
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

for (let i = 0; i < 180; i += 1) {
  await page.evaluate(() => {
    const reward = document.querySelector('[data-reward-kind="random"]');
    if (reward && !document.querySelector("#reward-modal.hidden")) {
      reward.click();
      return;
    }

    for (let j = 0; j < 8; j += 1) {
      const summon = document.querySelector("#summon-btn:not(:disabled)");
      if (!summon) break;
      summon.click();
    }

    const upgrades = ["#upgrade-hydra", "#upgrade-ghost", "#upgrade-dragoon"];
    for (const selector of upgrades) {
      const button = document.querySelector(`${selector}:not(:disabled)`);
      if (button) {
        button.click();
        break;
      }
    }
  });

  await page.evaluate(() => window.advanceTime?.(1000));
  const mode = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}")?.state?.mode);
  if (mode === "ended") break;
}

await page.screenshot({ path: path.join(outDir, "autoplay-end.png"), fullPage: true });
const state = await page.evaluate(() => window.render_game_to_text?.());
fs.writeFileSync(path.join(outDir, "autoplay-state.json"), state ?? "null", "utf8");

if (errors.length) {
  fs.writeFileSync(path.join(outDir, "errors.json"), JSON.stringify(errors, null, 2), "utf8");
}

await browser.close();
