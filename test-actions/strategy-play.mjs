import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outDir = path.resolve("output/web-game/strategy");
fs.mkdirSync(outDir, { recursive: true });

const gradePower = {
  common: 1,
  rare: 1.65,
  ancient: 2.75,
  relic: 4.8,
  epic: 8.5,
  legendary: 15,
  unique: 28,
  mythic: 54,
  origin: 120,
};

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
const errors = [];
let sawReward = false;

page.on("console", (msg) => {
  if (msg.type() === "error") errors.push({ type: "console", text: msg.text() });
});
page.on("pageerror", (error) => errors.push({ type: "pageerror", text: String(error) }));

await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(500);
await page.click("#start-btn");

for (let i = 0; i < 260; i += 1) {
  const statePayload = await page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}").state);
  if (statePayload?.mode === "ended") break;

  const rewardOpen = await page.locator("#reward-modal:not(.hidden)").count();
  if (rewardOpen) {
    sawReward = true;
    await page.click('[data-reward-kind="random"]');
  } else {
    const bestKind = chooseBestKind(statePayload);
    await page.evaluate(
      ({ bestKind }) => {
        const state = JSON.parse(window.render_game_to_text?.() ?? "{}").state;
        const upgradeButton = document.querySelector(`#upgrade-${bestKind}:not(:disabled)`);
        const summonButton = document.querySelector("#summon-btn:not(:disabled)");
        if (state.units.length < 12 && summonButton) {
          summonButton.click();
          return;
        }
        if (upgradeButton) {
          upgradeButton.click();
          return;
        }
        if (state.minerals >= 20 && summonButton) summonButton.click();
      },
      { bestKind },
    );
  }

  await page.evaluate(() => window.advanceTime?.(900));
}

await page.screenshot({ path: path.join(outDir, "strategy-end.png"), fullPage: true });
const state = await page.evaluate(() => window.render_game_to_text?.());
fs.writeFileSync(path.join(outDir, "strategy-state.json"), state ?? "null", "utf8");
fs.writeFileSync(path.join(outDir, "saw-reward.txt"), String(sawReward), "utf8");

if (errors.length) {
  fs.writeFileSync(path.join(outDir, "errors.json"), JSON.stringify(errors, null, 2), "utf8");
}

await browser.close();

function chooseBestKind(state) {
  const scores = { ghost: 0, dragoon: 0, hydra: 0 };
  for (const unit of state?.units ?? []) {
    scores[unit.kind] += gradePower[unit.gradeId] ?? 1;
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}
