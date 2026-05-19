import Phaser from "phaser";
import "./style.css";
import { eventBus, on } from "./core/events";
import { GameScene, type GameApi, type GameResultPayload, type GameStatePayload } from "./game/GameScene";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

let gameApi: GameApi | null = null;
let latestState: GameStatePayload | null = null;
let latestResult: GameResultPayload | null = null;
let lastUnitListKey = "__unset__";

const qs = <T extends HTMLElement>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
};

const elements = {
  round: qs<HTMLElement>("#round-value"),
  minerals: qs<HTMLElement>("#mineral-value"),
  kills: qs<HTMLElement>("#kills-value"),
  monsters: qs<HTMLElement>("#monster-value"),
  timer: qs<HTMLElement>("#timer-value"),
  timerHud: qs<HTMLElement>("#timer-hud"),
  score: qs<HTMLElement>("#score-value"),
  guide: qs<HTMLButtonElement>("#guide-btn"),
  guideModal: qs<HTMLElement>("#guide-modal"),
  closeGuide: qs<HTMLButtonElement>("#close-guide-btn"),
  start: qs<HTMLButtonElement>("#start-btn"),
  summon: qs<HTMLButtonElement>("#summon-btn"),
  sell: qs<HTMLButtonElement>("#sell-btn"),
  focusTarget: qs<HTMLButtonElement>("#focus-target-btn"),
  clearTarget: qs<HTMLButtonElement>("#clear-target-btn"),
  skill: qs<HTMLButtonElement>("#skill-btn"),
  exchange: qs<HTMLButtonElement>("#exchange-btn"),
  selected: qs<HTMLElement>("#selected-unit"),
  unitList: qs<HTMLElement>("#unit-list"),
  rollLog: qs<HTMLElement>("#roll-log"),
  toastLog: qs<HTMLElement>("#toast-log"),
  rewardModal: qs<HTMLElement>("#reward-modal"),
  rewardTitle: qs<HTMLElement>("#reward-title"),
  rewardDesc: qs<HTMLElement>("#reward-desc"),
  resultModal: qs<HTMLElement>("#result-modal"),
  resultTitle: qs<HTMLElement>("#result-title"),
  resultSummary: qs<HTMLElement>("#result-summary"),
  nickname: qs<HTMLInputElement>("#nickname-input"),
  saveScore: qs<HTMLButtonElement>("#save-score-btn"),
  saveStatus: qs<HTMLElement>("#save-status"),
  restart: qs<HTMLButtonElement>("#restart-btn"),
  leaderboard: qs<HTMLElement>("#leaderboard"),
  refreshScores: qs<HTMLButtonElement>("#refresh-scores"),
  upgradeGhost: qs<HTMLButtonElement>("#upgrade-ghost"),
  upgradeDragoon: qs<HTMLButtonElement>("#upgrade-dragoon"),
  upgradeHydra: qs<HTMLButtonElement>("#upgrade-hydra"),
};

const phaserGame = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  width: 900,
  height: 640,
  backgroundColor: "#101923",
  render: {
    antialias: false,
    pixelArt: true,
    preserveDrawingBuffer: true,
  },
  audio: {
    noAudio: true,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [GameScene],
});

void phaserGame;

on<GameApi>("scene-ready", (api) => {
  gameApi = api;
  (window as any).mapleDefense = api;
  (window as any).render_game_to_text = () => api.renderText();
  (window as any).advanceTime = (ms: number) => api.advanceForTest(ms);
  renderState(api.getState());
  void loadScores();
});

on<GameStatePayload>("state", (state) => renderState(state));

on<{ message: string; tone: "normal" | "warn" | "rare" }>("log", ({ message, tone }) => {
  appendLog(message, tone);
  showToast(message, tone);
});

on<{ source: string; grade: string; remaining: number; randomUpgradeChance: number }>(
  "reward",
  (reward) => showReward(reward),
);

on<null>("reward-hide", () => elements.rewardModal.classList.add("hidden"));
on<null>("result-hide", () => elements.resultModal.classList.add("hidden"));

on<GameResultPayload>("result", (result) => {
  latestResult = result;
  showResult(result);
});

elements.start.addEventListener("click", () => gameApi?.start());
elements.summon.addEventListener("click", () => gameApi?.summon());
elements.sell.addEventListener("click", () => gameApi?.sellSelected());
elements.focusTarget.addEventListener("click", () => gameApi?.focusTarget("front"));
elements.clearTarget.addEventListener("click", () => gameApi?.focusTarget(null));
elements.skill.addEventListener("click", () => gameApi?.castSelectedSkill());
elements.exchange.addEventListener("click", () => gameApi?.exchangeSelected());
elements.restart.addEventListener("click", () => {
  elements.resultModal.classList.add("hidden");
  elements.saveStatus.textContent = "";
  gameApi?.restart();
});
elements.refreshScores.addEventListener("click", () => void loadScores());
elements.upgradeGhost.addEventListener("click", () => handleUpgradeClick("ghost", elements.upgradeGhost));
elements.upgradeDragoon.addEventListener("click", () => handleUpgradeClick("dragoon", elements.upgradeDragoon));
elements.upgradeHydra.addEventListener("click", () => handleUpgradeClick("hydra", elements.upgradeHydra));
elements.guide.addEventListener("click", () => openGuide());
elements.closeGuide.addEventListener("click", () => closeGuide());
elements.guideModal.addEventListener("click", (event) => {
  if (event.target === elements.guideModal) closeGuide();
});

document.querySelectorAll<HTMLButtonElement>(".speed-btn").forEach((button) => {
  button.addEventListener("click", () => gameApi?.setSpeed(Number(button.dataset.speed)));
});

document.querySelectorAll<HTMLButtonElement>("[data-reward-kind]").forEach((button) => {
  button.addEventListener("click", () => {
    const kind = button.dataset.rewardKind as "ghost" | "dragoon" | "hydra" | "random";
    gameApi?.claimReward(kind);
  });
});

elements.saveScore.addEventListener("click", () => void saveScore());

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.guideModal.classList.contains("hidden")) {
    event.preventDefault();
    closeGuide();
    return;
  }
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === "d") {
    event.preventDefault();
    gameApi?.summon();
  }
  if (key === "f") {
    event.preventDefault();
    gameApi?.sellSelected();
  }
  if (key === "q") {
    event.preventDefault();
    handleUpgradeClick("ghost", elements.upgradeGhost);
  }
  if (key === "w") {
    event.preventDefault();
    handleUpgradeClick("dragoon", elements.upgradeDragoon);
  }
  if (key === "e") {
    event.preventDefault();
    handleUpgradeClick("hydra", elements.upgradeHydra);
  }
});

function openGuide(): void {
  elements.guideModal.classList.remove("hidden");
  elements.closeGuide.focus();
}

function closeGuide(): void {
  elements.guideModal.classList.add("hidden");
  elements.guide.focus();
}

function renderState(state: GameStatePayload): void {
  latestState = state;
  elements.round.textContent = String(state.round);
  elements.minerals.textContent = String(state.minerals);
  elements.kills.textContent = String(state.kills);
  elements.monsters.textContent = String(state.monsters);
  const bossTimeLeftSec = state.bossTimeLeftMs === null ? null : Math.ceil(state.bossTimeLeftMs / 1000);
  elements.timer.textContent = bossTimeLeftSec === null ? "--" : formatTime(bossTimeLeftSec);
  elements.timerHud.classList.toggle("timer-warning", bossTimeLeftSec !== null && bossTimeLeftSec <= 30);
  elements.score.textContent = state.score.toLocaleString("ko-KR");

  elements.start.textContent = state.mode === "idle" ? "게임 시작" : "처음부터 재시작";
  elements.summon.disabled = state.mode !== "playing" || state.minerals < 10;
  const selectedUnits = state.units.filter((unit) => state.selectedUnitIds.includes(unit.id));
  const sellableSelected = selectedUnits.filter((unit) => unit.sellValue !== null);
  elements.sell.disabled = selectedUnits.length === 0 || sellableSelected.length === 0;
  elements.sell.textContent = selectedUnits.length > 1 ? `선택 판매 ${sellableSelected.length}기` : "판매";
  elements.focusTarget.disabled = state.mode !== "playing" || state.monsters === 0;
  elements.clearTarget.disabled = !state.focusTargetId;
  elements.skill.disabled =
    !state.selectedUnit || state.selectedUnit.skillReadyMs > 0 || !state.selectedUnit.special.includes("에픽:");
  elements.exchange.disabled =
    !state.selectedUnit ||
    state.selectedUnit.exchangeCost === null ||
    state.minerals < state.selectedUnit.exchangeCost;
  elements.exchange.textContent =
    state.selectedUnit?.exchangeCost === null || !state.selectedUnit
      ? "교환 도박"
      : `교환 ${state.selectedUnit.exchangeCost}M`;

  document.querySelectorAll<HTMLButtonElement>(".speed-btn").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.speed) === state.speed);
  });

  renderUpgradeButton(elements.upgradeGhost, state, "ghost");
  renderUpgradeButton(elements.upgradeDragoon, state, "dragoon");
  renderUpgradeButton(elements.upgradeHydra, state, "hydra");
  renderSelectedUnit(state);
  renderUnitList(state);
}

function renderUpgradeButton(
  button: HTMLButtonElement,
  state: GameStatePayload,
  kind: "ghost" | "dragoon" | "hydra",
): void {
  const upgrade = state.upgrades[kind];
  button.innerHTML = `<strong>${upgrade.name} Lv.${upgrade.level}</strong><span>${upgrade.cost}M</span>`;
  button.disabled = (state.mode !== "playing" && state.mode !== "reward") || state.minerals < upgrade.cost;
}

function handleUpgradeClick(kind: "ghost" | "dragoon" | "hydra", button: HTMLButtonElement): void {
  const state = latestState;
  const upgrade = state?.upgrades[kind];
  if (!gameApi || !state || !upgrade) return;
  if ((state.mode !== "playing" && state.mode !== "reward") || state.minerals < upgrade.cost) return;
  button.disabled = true;
  gameApi.upgrade(kind);
}

function renderSelectedUnit(state: GameStatePayload): void {
  const selectedUnits = state.units.filter((unit) => state.selectedUnitIds.includes(unit.id));
  if (selectedUnits.length > 1) {
    const sellable = selectedUnits.filter((unit) => unit.sellValue !== null);
    const sellTotal = sellable.reduce((sum, unit) => sum + (unit.sellValue ?? 0), 0);
    const upgradeText = [...new Set(selectedUnits.map((unit) => unit.kind))]
      .map((kind) => `${state.upgrades[kind].name} Lv.${state.upgrades[kind].level}`)
      .join(" · ");
    const raceCounts = selectedUnits.reduce(
      (acc, unit) => {
        acc[unit.race] = (acc[unit.race] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    elements.selected.className = "selected-unit";
    elements.selected.innerHTML = `
      <strong>${selectedUnits.length}기 선택됨</strong><br />
      <span>${Object.entries(raceCounts)
        .map(([race, count]) => `${race} ${count}`)
        .join(" · ")}</span><br />
      <span>${upgradeText}</span><br />
      <span>판매 가능 ${sellable.length}기 · 회수 ${sellTotal}M</span><br />
      <span>대표 유닛: ${state.selectedUnit ? `${state.selectedUnit.grade} ${state.selectedUnit.name}` : "없음"}</span>
    `;
    return;
  }

  if (!state.selectedUnit) {
    elements.selected.className = "selected-unit empty";
    elements.selected.textContent = "선택된 유닛 없음";
    return;
  }
  elements.selected.className = "selected-unit";
  const selectedListUnit = state.units.find((unit) => unit.id === state.selectedUnit?.id);
  const selectedUpgradeLevel = selectedListUnit ? state.upgrades[selectedListUnit.kind].level : 0;
  const sellText =
    state.selectedUnit.sellValue === null ? "판매 불가" : `판매 ${state.selectedUnit.sellValue}M`;
  const skillText = state.selectedUnit.skillReadyMs > 0
    ? `스킬 대기 ${Math.ceil(state.selectedUnit.skillReadyMs / 1000)}초`
    : state.selectedUnit.special.includes("에픽:")
      ? "스킬 사용 가능"
      : "수동 스킬 없음";
  const exchangeText = state.selectedUnit.exchangeCost === null
    ? "교환 불가"
    : `교환 ${state.selectedUnit.exchangeCost}M · 성공 ${Math.round(state.selectedUnit.exchangeChance! * 100)}%`;
  const targetText = state.focusTarget
    ? `점사: ${state.focusTarget.label} · ${state.focusTarget.size} · ${state.focusTarget.hp.toLocaleString("ko-KR")}/${state.focusTarget.maxHp.toLocaleString("ko-KR")}`
    : "점사 타겟 없음";
  elements.selected.innerHTML = `
    <strong>${state.selectedUnit.grade} ${state.selectedUnit.name}</strong><br />
    <span>${state.selectedUnit.race} · 강화 Lv.${selectedUpgradeLevel} · 공격력 ${state.selectedUnit.damage.toLocaleString("ko-KR")} · 사거리 ${state.selectedUnit.range}</span><br />
    <span>${state.selectedUnit.special}</span><br />
    <span>${skillText}</span><br />
    <span>${exchangeText}</span><br />
    <span>${targetText}</span><br />
    <span>${sellText}</span>
  `;
}

function renderUnitList(state: GameStatePayload): void {
  const upgradeKey = Object.entries(state.upgrades)
    .map(([kind, upgrade]) => `${kind}:${upgrade.level}`)
    .join(",");
  const key = `${state.selectedUnitId ?? ""}|${upgradeKey}|${state.units
    .map((unit) => `${unit.id}:${unit.gradeId}:${state.selectedUnitIds.includes(unit.id) ? "1" : "0"}`)
    .join(",")}`;
  if (key === lastUnitListKey) return;
  lastUnitListKey = key;
  elements.unitList.innerHTML = "";
  if (state.units.length === 0) {
    elements.unitList.textContent = "소환된 유닛 없음";
    return;
  }
  for (const unit of state.units) {
    const button = document.createElement("button");
    button.className = `unit-chip ${state.selectedUnitIds.includes(unit.id) ? "selected" : ""}`;
    button.innerHTML = `<strong style="color:${unit.gradeColor}">${unit.grade} ${unit.name}</strong><span>${unit.race} · Lv.${state.upgrades[unit.kind].level}</span>`;
    button.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        event.preventDefault();
        gameApi?.toggleUnitSelection(unit.id);
        return;
      }
      gameApi?.selectUnit(unit.id);
    });
    elements.unitList.appendChild(button);
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

function appendLog(message: string, tone: "normal" | "warn" | "rare"): void {
  const line = document.createElement("div");
  line.className = `log-line ${tone}`;
  line.textContent = message;
  elements.rollLog.appendChild(line);
  while (elements.rollLog.children.length > 36) {
    elements.rollLog.removeChild(elements.rollLog.firstElementChild as Element);
  }
  elements.rollLog.scrollTop = elements.rollLog.scrollHeight;
}

function showToast(message: string, tone: "normal" | "warn" | "rare"): void {
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  if (tone === "warn") toast.style.borderLeftColor = "#f87171";
  if (tone === "rare") toast.style.borderLeftColor = "#fbbf24";
  elements.toastLog.appendChild(toast);
  while (elements.toastLog.children.length > 5) {
    elements.toastLog.removeChild(elements.toastLog.firstElementChild as Element);
  }
  setTimeout(() => toast.remove(), 2400);
}

function showReward(reward: {
  source: string;
  grade: string;
  remaining: number;
  randomUpgradeChance: number;
}): void {
  elements.rewardTitle.textContent = `${reward.source} 보상`;
  elements.rewardDesc.textContent = `${reward.grade} 선택권 ${reward.remaining}개 남음 · 랜덤은 20% 확률로 한 단계 상승`;
  elements.rewardModal.classList.remove("hidden");
}

function showResult(result: GameResultPayload): void {
  elements.resultTitle.textContent = result.cleared ? "101R CLEAR" : "도전 종료";
  elements.resultSummary.innerHTML = `
    <div>최고 라운드<b>${result.cleared ? "101R CLEAR" : `${result.round}R`}</b></div>
    <div>종료 사유<b>${result.cleared ? "클리어" : result.defeatReason ?? "도전 실패"}</b></div>
    <div>점수<b>${result.score.toLocaleString("ko-KR")}</b></div>
    <div>킬 수<b>${result.kills.toLocaleString("ko-KR")}</b></div>
    <div>최고 등급<b>${result.bestGrade}</b></div>
    <div>최고 강화<b>Lv.${result.bestUpgrade}</b></div>
    <div>플레이 시간<b>${formatTime(result.playTimeSec)}</b></div>
  `;
  elements.nickname.value = "";
  elements.saveStatus.textContent = "";
  elements.resultModal.classList.remove("hidden");
}

async function saveScore(): Promise<void> {
  if (!latestResult) return;
  const nickname = elements.nickname.value.trim();
  if (!nickname) {
    elements.saveStatus.textContent = "닉네임을 입력하세요.";
    return;
  }
  elements.saveScore.disabled = true;
  elements.saveStatus.textContent = "저장 중";
  try {
    const response = await fetch(`${API_BASE}/api/scores`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname, ...latestResult }),
    });
    if (!response.ok) throw new Error(await response.text());
    const result = (await response.json()) as { saved?: boolean };
    elements.saveStatus.textContent = result.saved === false ? "기존 최고 기록 유지" : "최고 기록 저장 완료";
    await loadScores();
  } catch (error) {
    elements.saveStatus.textContent = "서버 연결 실패";
    console.error(error);
  } finally {
    elements.saveScore.disabled = false;
  }
}

async function loadScores(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/api/scores`);
    if (!response.ok) throw new Error(await response.text());
    const records = (await response.json()) as Array<{
      nickname: string;
      round: number;
      cleared: boolean;
      score: number;
    }>;
    if (records.length === 0) {
      elements.leaderboard.textContent = "아직 저장된 기록 없음";
      return;
    }
    elements.leaderboard.innerHTML = "";
    records.slice(0, 10).forEach((record, index) => {
      const row = document.createElement("div");
      row.className = `rank-row ${record.cleared ? "clear" : ""}`;
      row.innerHTML = `
        <span>${index + 1}</span>
        <strong>${escapeHtml(record.nickname)}</strong>
        <span>${record.cleared ? "101R CLEAR" : `${record.round}R`}</span>
      `;
      elements.leaderboard.appendChild(row);
    });
  } catch {
    elements.leaderboard.textContent = "기록 서버를 실행하면 표시됩니다.";
  }
}

function formatTime(totalSec: number): string {
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.addEventListener("beforeunload", () => {
  eventBus.dispatchEvent(new Event("shutdown"));
});
