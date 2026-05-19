import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outDir = path.resolve("output/web-game/balance-sim");
fs.mkdirSync(outDir, { recursive: true });

const minRuns = Number(process.env.MIN_RUNS ?? 100);
const maxRuns = Number(process.env.MAX_RUNS ?? 200);

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
page.setDefaultTimeout(0);
page.setDefaultNavigationTimeout(0);

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push({ type: "console", text: msg.text() });
});
page.on("pageerror", (error) => errors.push({ type: "pageerror", text: String(error) }));

await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(500);

const results = [];
let firstClear = null;

for (let run = 1; run <= maxRuns; run += 1) {
  const result = await page.evaluate((runNumber) => {
    const api = window.mapleDefense;
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
    const gradeRank = {
      common: 0,
      rare: 1,
      ancient: 2,
      relic: 3,
      epic: 4,
      legendary: 5,
      unique: 6,
      mythic: 7,
      origin: 8,
    };

    api.start();
    api.setSpeed(4);

    let sawReward = false;
    let exchanges = 0;
    let ticks = 0;

    for (; ticks < 1100; ticks += 1) {
      let state = api.getState();
      if (state.mode === "ended") break;

      if (state.mode === "reward") {
        sawReward = true;
        api.claimReward("random");
        api.advanceFastForTest(250);
        continue;
      }

      if (state.round >= 90 && state.speed !== 1) api.setSpeed(1);
      if (state.round < 90 && state.speed !== 4) api.setSpeed(4);

      state = api.getState();
      const targetMonster = chooseTarget(state);
      if (targetMonster && state.focusTargetId !== targetMonster.id) api.focusTarget(targetMonster.id);
      if (!targetMonster && state.focusTargetId) api.focusTarget(null);

      castReadySkills(api);
      state = api.getState();

      summonByPlan(api, state, gradeRank, true);
      arrangeUnits(api, gradeRank);
      state = api.getState();

      const tech = chooseTech(state, gradePower);
      const targetLevel = targetUpgradeLevel(state.round, state.units, gradeRank);
      upgradeToward(api, tech, targetLevel);
      state = api.getState();

      if (state.round >= 95) {
        const changed = exchangeWeakHighGrade(api, state, tech);
        if (changed) exchanges += 1;
        state = api.getState();
      }

      summonByPlan(api, api.getState(), gradeRank, false);
      arrangeUnits(api, gradeRank);
      api.advanceFastForTest(state.round >= 96 ? 850 : state.round >= 90 ? 1000 : 1500);
    }

    const finalState = api.getState();
    return {
      run: runNumber,
      cleared: Boolean(finalState.result?.cleared),
      round: finalState.result?.round ?? finalState.round,
      score: finalState.score,
      kills: finalState.kills,
      bestGrade: finalState.result?.bestGrade ?? bestGradeName(finalState.units, gradeRank),
      bestUpgrade: finalState.result?.bestUpgrade ?? Math.max(...Object.values(finalState.upgrades).map((u) => u.level)),
      units: finalState.units.length,
      sawReward,
      exchanges,
      ticks,
      unitCounts: countUnits(finalState.units),
    };

    function chooseTarget(state) {
      const monsters = state.visibleMonsters ?? [];
      if (!monsters.length) return null;
      const boss = monsters.find((monster) => monster.boss);
      if (boss) return boss;
      if (state.round >= 96) {
        return [...monsters].sort((a, b) => b.hp - a.hp || b.progress - a.progress)[0];
      }
      if (state.round >= 90) {
        return [...monsters].sort((a, b) => b.progress - a.progress)[0];
      }
      return null;
    }

    function castReadySkills(apiRef) {
      const state = apiRef.getState();
      if (!state.visibleMonsters.length) return;
      for (const unit of state.units) {
        if (unit.gradeId !== "unique") continue;
        apiRef.selectUnit(unit.id);
        const selected = apiRef.getState().selectedUnit;
        if (selected?.skillReadyMs === 0) apiRef.castSelectedSkill();
      }
    }

    function chooseTech(state, power) {
      const scores = { ghost: 0, dragoon: 0, hydra: 1.5 };
      for (const unit of state.units) {
        const bonus = unit.kind === "hydra" ? 1.12 : unit.kind === "dragoon" ? 1.04 : 0.92;
        scores[unit.kind] += (power[unit.gradeId] ?? 1) * bonus;
      }
      return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    }

    function targetUpgradeLevel(round, units, rank) {
      const high = units.filter((unit) => rank[unit.gradeId] >= rank.legendary).length;
      if (round < 24) return high ? 10 : 6;
      if (round < 37) return 18;
      if (round < 58) return high ? 24 : 20;
      if (round < 79) return high >= 2 ? 34 : 26;
      if (round < 90) return 40;
      if (round < 96) return 45;
      return 52;
    }

    function upgradeToward(apiRef, kind, targetLevel) {
      if (!apiRef.getState().units.length) return;
      for (let i = 0; i < 20; i += 1) {
        const state = apiRef.getState();
        const upgrade = state.upgrades[kind];
        if (!upgrade || upgrade.level >= targetLevel || state.minerals < upgrade.cost) return;
        apiRef.upgrade(kind);
      }
    }

    function summonByPlan(apiRef, state, rank, beforeUpgrade) {
      const high = state.units.filter((unit) => rank[unit.gradeId] >= rank.legendary).length;
      const mythicPlus = state.units.filter((unit) => rank[unit.gradeId] >= rank.mythic).length;
      const desiredUnits = state.round < 13 ? 8 : state.round < 24 ? 18 : state.round < 58 ? 54 : state.round < 90 ? 82 : 96;
      const shouldKeepRolling =
        state.units.length < desiredUnits ||
        (!beforeUpgrade && state.round < 79 && high < 2) ||
        (state.round >= 79 && mythicPlus < 1 && high < 5);
      if (!shouldKeepRolling) return;
      for (let i = 0; i < (beforeUpgrade ? 5 : 12); i += 1) {
        const next = apiRef.getState();
        if (next.minerals < 10 || next.units.length >= desiredUnits) return;
        apiRef.summon();
      }
    }

    function arrangeUnits(apiRef, rank) {
      const state = apiRef.getState();
      const slots = makeSlots();
      const units = [...state.units].sort((a, b) => rank[b.gradeId] - rank[a.gradeId]);
      for (let i = 0; i < units.length && i < slots.length; i += 1) {
        const unit = units[i];
        const slot = slots[i];
        if (Math.abs(unit.x - slot.x) > 4 || Math.abs(unit.y - slot.y) > 4) {
          apiRef.debugMoveUnit(unit.id, slot.x, slot.y);
        }
      }
    }

    function makeSlots() {
      const slots = [];
      for (let x = 168; x <= 738; x += 38) slots.push({ x, y: 148 });
      for (let y = 184; y <= 488; y += 34) slots.push({ x: 760, y });
      for (let x = 738; x >= 168; x -= 38) slots.push({ x, y: 500 });
      for (let y = 488; y >= 184; y -= 34) slots.push({ x: 140, y });
      for (let y = 190; y <= 470; y += 40) {
        slots.push({ x: 360, y });
        slots.push({ x: 540, y });
      }
      return slots;
    }

    function exchangeWeakHighGrade(apiRef, state, tech) {
      const candidates = state.units
        .filter((unit) => (unit.gradeId === "legendary" || unit.gradeId === "mythic") && unit.kind !== tech)
        .sort((a, b) => (a.gradeId === "mythic" ? -1 : 1) - (b.gradeId === "mythic" ? -1 : 1));
      for (const unit of candidates) {
        apiRef.selectUnit(unit.id);
        const selected = apiRef.getState().selectedUnit;
        if (!selected?.exchangeCost) continue;
        if (apiRef.getState().minerals >= selected.exchangeCost + 30) {
          apiRef.exchangeSelected();
          return true;
        }
      }
      return false;
    }

    function bestGradeName(units, rank) {
      const names = {
        common: "일반",
        rare: "레어",
        ancient: "고대",
        relic: "유물",
        epic: "서사",
        legendary: "전설",
        unique: "에픽",
        mythic: "신화",
        origin: "태초",
      };
      const best = [...units].sort((a, b) => rank[b.gradeId] - rank[a.gradeId])[0];
      return best ? names[best.gradeId] : "일반";
    }

    function countUnits(units) {
      return units.reduce((acc, unit) => {
        const key = `${unit.kind}:${unit.gradeId}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});
    }
  }, run);

  results.push(result);
  if (result.cleared && !firstClear) firstClear = result;
  if (run >= minRuns && firstClear) break;
}

const clearCount = results.filter((result) => result.cleared).length;
const maxRound = Math.max(...results.map((result) => result.round));
const summary = {
  requested: { minRuns, maxRuns },
  runs: results.length,
  clearCount,
  firstClear,
  maxRound,
  averageRound: Number((results.reduce((sum, result) => sum + result.round, 0) / results.length).toFixed(2)),
  topRuns: [...results].sort((a, b) => Number(b.cleared) - Number(a.cleared) || b.round - a.round || b.score - a.score).slice(0, 12),
  errors,
};

fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
fs.writeFileSync(path.join(outDir, "runs.json"), JSON.stringify(results, null, 2), "utf8");
await page.screenshot({ path: path.join(outDir, "last-run.png"), fullPage: true });

await browser.close();

console.log(JSON.stringify(summary, null, 2));
