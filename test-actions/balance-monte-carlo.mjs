import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve("output/web-game/balance-monte-carlo");
fs.mkdirSync(outDir, { recursive: true });

const minRuns = Number(process.env.MIN_RUNS ?? 100);
const maxRuns = Number(process.env.MAX_RUNS ?? 200);

const grades = [
  ["common", "일반", 50, 1],
  ["rare", "레어", 33.1, 1.65],
  ["ancient", "고대", 10.2, 2.75],
  ["relic", "유물", 5.1, 4.8],
  ["epic", "서사", 0.8, 8.5],
  ["legendary", "전설", 0.5, 15],
  ["unique", "에픽", 0.2, 28],
  ["mythic", "신화", 0.08, 54],
  ["origin", "태초", 0.019, 120],
].map(([id, name, probability, power], rank) => ({ id, name, probability, power, rank }));

const gradeById = Object.fromEntries(grades.map((grade) => [grade.id, grade]));
const units = {
  ghost: { baseDamage: 15, attackMs: 760, size: { small: 1, medium: 0.5, large: 0.25 } },
  dragoon: { baseDamage: 27, attackMs: 1060, size: { small: 0.5, medium: 0.75, large: 1 } },
  hydra: { baseDamage: 12, attackMs: 560, size: { small: 1, medium: 1, large: 1 } },
};
const kinds = Object.keys(units);

const bosses = {
  24: { label: "크림슨 발록", size: "small", hp: 21000, reward: { mineral: 50, grade: "relic", count: 1 } },
  30: { label: "파파픽시", size: "small", hp: 32000 },
  37: { label: "피아누스", size: "medium", hp: 62000, reward: { mineral: 50, grade: "epic", count: 1 } },
  45: { label: "알리샤르", size: "large", hp: 115000 },
  58: { label: "파풀라투스", size: "small", hp: 190000, reward: { mineral: 50, grade: "epic", count: 1 } },
  66: { label: "데비즌", size: "large", hp: 360000 },
  79: { label: "자쿰", size: "medium", hp: 760000, reward: { mineral: 70, grade: "legendary", count: 1 } },
  90: { label: "혼테일", size: "large", hp: 1850000, reward: { mineral: 100, grade: "legendary", count: 1 } },
  95: { label: "핑크빈", size: "medium", hp: 3100000, reward: { mineral: 150, grade: "legendary", count: 1 } },
  96: { label: "타락한 시간의 신관", size: "small", hp: 1550000, reward: { mineral: 100, grade: "relic", count: 1 } },
  97: { label: "타락한 시간의 수호대장", size: "large", hp: 1900000, reward: { mineral: 100, grade: "relic", count: 2 } },
  98: { label: "변형된 슬라임", size: "medium", hp: 2300000, reward: { mineral: 100, grade: "epic", count: 1 } },
  99: { label: "에이션트 다크골렘", size: "medium", hp: 2650000, reward: { mineral: 100, grade: "epic", count: 2 } },
  100: { label: "정식기사A", size: "small", hp: 3400000, reward: { mineral: 100, grade: "legendary", count: 1 } },
  101: { label: "시그너스", size: "medium", hp: 5200000 },
};
const sizeCycle = ["small", "medium", "large", "medium"];

const results = [];
let firstClear = null;
for (let run = 1; run <= maxRuns; run += 1) {
  const result = playRun(run);
  results.push(result);
  if (result.cleared && !firstClear) firstClear = result;
  if (run >= minRuns && firstClear) break;
}

const summary = {
  requested: { minRuns, maxRuns },
  runs: results.length,
  clearCount: results.filter((result) => result.cleared).length,
  firstClear,
  maxRound: Math.max(...results.map((result) => result.round)),
  averageRound: Number((results.reduce((sum, result) => sum + result.round, 0) / results.length).toFixed(2)),
  topRuns: [...results].sort((a, b) => Number(b.cleared) - Number(a.cleared) || b.round - a.round || b.score - a.score).slice(0, 12),
};

fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
fs.writeFileSync(path.join(outDir, "runs.json"), JSON.stringify(results, null, 2), "utf8");
console.log(JSON.stringify(summary, null, 2));

function playRun(run) {
  const state = {
    minerals: 50,
    units: [],
    upgrades: { ghost: 0, dragoon: 0, hydra: 0 },
    kills: 0,
    score: 0,
    killBank: 0,
    backlogHp: 0,
    exchanges: 0,
    rewards: 0,
  };

  for (let round = 1; round <= 101; round += 1) {
    runStrategy(state, round);
    const wave = waveSpec(round);
    const dps = totalDps(state, wave.size, wave.boss);
    if (wave.boss && dps <= 0) return finish(state, run, false, round);
    const windowSec = wave.boss
      ? Math.max(bossWindow(round), wave.hp / Math.max(1, dps) + 1)
      : wave.count * (wave.spawnMs / 1000) + 44;
    const waveHp = wave.hp * wave.count;
    const availableDamage = dps * windowSec;
    const targetHp = state.backlogHp + waveHp;
    const remaining = Math.max(0, targetHp - availableDamage);
    const killedHp = targetHp - remaining;
    const killed = Math.min(wave.count + Math.floor(state.backlogHp / Math.max(1, wave.hp)), Math.floor(killedHp / Math.max(1, wave.hp)));

    state.kills += killed;
    state.score += killed * (wave.boss ? 2500 + round * 120 : 10 + round * 2);
    state.killBank += killed;
    if (state.killBank >= 10) {
      const payouts = Math.floor(state.killBank / 10);
      state.killBank -= payouts * 10;
      state.minerals += payouts * 12;
    }

    if (wave.boss && remaining > 0) {
      return finish(state, run, false, round);
    }

    state.backlogHp = wave.boss ? 0 : remaining;
    const backlogCount = state.backlogHp / Math.max(1, wave.hp);
    if (backlogCount >= 200) return finish(state, run, false, round);

    if (wave.reward) grantReward(state, wave.reward);
    if (round === 101) return finish(state, run, true, 101);
  }
  return finish(state, run, true, 101);
}

function runStrategy(state, round) {
  const tech = chooseTech(state);
  const targetLevel = targetUpgradeLevel(round, state);
  const desired = desiredUnits(round, state);

  while (state.units.length < desired && state.minerals >= 10) summon(state);
  while (state.upgrades[tech] < targetLevel && state.minerals >= upgradeCost(tech, state.upgrades[tech])) {
    state.minerals -= upgradeCost(tech, state.upgrades[tech]);
    state.upgrades[tech] += 1;
  }
  while (state.units.length < desired + 8 && state.minerals >= 10 && shouldKeepRolling(state, round)) summon(state);

  if (round >= 95) exchangeWeakHighGrade(state, tech);
}

function summon(state, forcedKind = randomKind(), forcedGrade = rollGrade().id) {
  if (!forcedGrade) state.minerals -= 10;
  else if (arguments.length < 3) state.minerals -= 10;
  state.units.push({ kind: forcedKind, gradeId: forcedGrade });
}

function grantReward(state, reward) {
  state.minerals += reward.mineral;
  for (let i = 0; i < reward.count; i += 1) {
    const grade = Math.random() < 0.2 ? nextGrade(reward.grade) : reward.grade;
    summon(state, randomKind(), grade);
    state.rewards += 1;
  }
}

function exchangeWeakHighGrade(state, tech) {
  let changed = true;
  while (changed) {
    changed = false;
    const candidate = state.units.find((unit) => (unit.gradeId === "legendary" || unit.gradeId === "mythic") && unit.kind !== tech);
    if (!candidate) return;
    const option = candidate.gradeId === "mythic" ? { cost: 250, chance: 0.5 } : { cost: 100, chance: 0.66 };
    if (state.minerals < option.cost + 30) return;
    state.minerals -= option.cost;
    state.exchanges += 1;
    if (Math.random() < option.chance) {
      candidate.kind = tech;
    } else {
      state.units.splice(state.units.indexOf(candidate), 1);
    }
    changed = true;
  }
}

function totalDps(state, size, boss) {
  return state.units.reduce((sum, unit) => {
    const spec = units[unit.kind];
    const grade = gradeById[unit.gradeId];
    const profile = profileFor(unit);
    const modifier = profile.ignoreSizePenalty ? 1 : spec.size[size];
    const damage = spec.baseDamage * grade.power * (1 + state.upgrades[unit.kind] * 0.34) * profile.damageMultiplier * modifier;
    const attacksPerSec = 1000 / Math.max(90, spec.attackMs * profile.cooldownMultiplier);
    const splash = boss ? 1 : profile.groupMultiplier;
    return sum + damage * attacksPerSec * splash;
  }, 0);
}

function profileFor(unit) {
  if (unit.gradeId === "relic") return { cooldownMultiplier: 0.82, damageMultiplier: 1, ignoreSizePenalty: false, groupMultiplier: 1 };
  if (unit.gradeId === "epic") return { cooldownMultiplier: 0.74, damageMultiplier: 1.06, ignoreSizePenalty: false, groupMultiplier: 1 };
  if (unit.gradeId === "legendary") return { cooldownMultiplier: 0.68, damageMultiplier: 1.08, ignoreSizePenalty: false, groupMultiplier: 1.28 };
  if (unit.gradeId === "unique") return { cooldownMultiplier: 0.6, damageMultiplier: 1.14, ignoreSizePenalty: false, groupMultiplier: unit.kind === "dragoon" ? 1.44 : 1.35 };
  if (unit.gradeId === "mythic") return { cooldownMultiplier: 0.42, damageMultiplier: 1.18, ignoreSizePenalty: true, groupMultiplier: 1.95 };
  if (unit.gradeId === "origin") return { cooldownMultiplier: 0.32, damageMultiplier: 1.28, ignoreSizePenalty: true, groupMultiplier: 3.8 };
  return { cooldownMultiplier: 1, damageMultiplier: 1, ignoreSizePenalty: false, groupMultiplier: 1 };
}

function chooseTech(state) {
  const scores = { ghost: 0, dragoon: 0, hydra: 2 };
  for (const unit of state.units) {
    const grade = gradeById[unit.gradeId];
    scores[unit.kind] += grade.power * (unit.kind === "hydra" ? 1.12 : unit.kind === "dragoon" ? 1.04 : 0.92);
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

function targetUpgradeLevel(round, state) {
  const high = state.units.filter((unit) => gradeById[unit.gradeId].rank >= gradeById.legendary.rank).length;
  if (round < 24) return high ? 10 : 7;
  if (round < 37) return 18;
  if (round < 58) return high ? 25 : 20;
  if (round < 79) return high >= 2 ? 34 : 28;
  if (round < 90) return 41;
  if (round < 96) return 46;
  return 53;
}

function desiredUnits(round, state) {
  const high = state.units.filter((unit) => gradeById[unit.gradeId].rank >= gradeById.legendary.rank).length;
  if (round < 13) return 8;
  if (round < 24) return high ? 18 : 24;
  if (round < 58) return 58;
  if (round < 90) return 88;
  return 104;
}

function shouldKeepRolling(state, round) {
  const high = state.units.filter((unit) => gradeById[unit.gradeId].rank >= gradeById.legendary.rank).length;
  const mythicPlus = state.units.filter((unit) => gradeById[unit.gradeId].rank >= gradeById.mythic.rank).length;
  return (round < 79 && high < 2) || (round >= 79 && mythicPlus < 1 && high < 6);
}

function upgradeCost(kind, level) {
  const base = kind === "hydra" ? 10 : 12;
  const lateTax = Math.max(0, level - 25) * 1.2;
  return Math.floor(base + level * 1.15 + lateTax);
}

function waveSpec(round) {
  const boss = bosses[round];
  if (boss) {
    return { round, count: 1, hp: boss.hp, size: boss.size, boss: true, reward: boss.reward, spawnMs: 120 };
  }
  return {
    round,
    count: Math.min(70, 12 + Math.floor(round * 1.12)),
    hp: regularHp(round),
    size: sizeCycle[round % sizeCycle.length],
    boss: false,
    spawnMs: Math.max(225, 810 - round * 5),
  };
}

function regularHp(round) {
  const phaseBoost = round >= 90 ? 1.32 : round >= 79 ? 1.18 : round >= 58 ? 1.12 : round >= 37 ? 1.06 : 1;
  return Math.floor((20 + round * 7.25) * Math.pow(1.075, round) * phaseBoost);
}

function bossWindow(round) {
  if (round >= 96) return 150;
  if (round >= 79) return 135;
  if (round >= 37) return 120;
  return 95;
}

function rollGrade() {
  const total = grades.reduce((sum, grade) => sum + grade.probability, 0);
  let ticket = Math.random() * total;
  for (const grade of grades) {
    ticket -= grade.probability;
    if (ticket <= 0) return grade;
  }
  return grades[0];
}

function nextGrade(id) {
  return grades[Math.min(gradeById[id].rank + 1, grades.length - 1)].id;
}

function randomKind() {
  return kinds[Math.floor(Math.random() * kinds.length)];
}

function finish(state, run, cleared, round) {
  const best = [...state.units].sort((a, b) => gradeById[b.gradeId].rank - gradeById[a.gradeId].rank)[0];
  return {
    run,
    cleared,
    round,
    score: Math.floor(state.score + (cleared ? 100000 : 0)),
    kills: state.kills,
    bestGrade: best ? gradeById[best.gradeId].name : "일반",
    bestUpgrade: Math.max(state.upgrades.ghost, state.upgrades.dragoon, state.upgrades.hydra),
    units: state.units.length,
    minerals: Math.floor(state.minerals),
    exchanges: state.exchanges,
    rewards: state.rewards,
    unitCounts: state.units.reduce((acc, unit) => {
      const key = `${unit.kind}:${unit.gradeId}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };
}
