import Phaser from "phaser";
import { emit } from "../core/events";
import { GRADE_BY_ID, GRADES, gradeRank, nextGrade, rollGrade } from "../data/grades";
import { DAMAGE_MODIFIER, SIZE_LABEL, UNITS, randomUnitKind } from "../data/units";
import { getWaveSpec, isFinalWave } from "../data/waves";
import type { BossReward, GradeId, MonsterSize, UnitKind, WaveSpec } from "../data/types";

type Mode = "idle" | "playing" | "reward" | "ended";

type Point = { x: number; y: number };

type UnitInstance = {
  id: string;
  kind: UnitKind;
  gradeId: GradeId;
  x: number;
  y: number;
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite;
  ring: Phaser.GameObjects.Arc;
  nextAttackAt: number;
  skillReadyAt: number;
};

type DragGroupState = {
  anchorId: string;
  pointerOffsetX: number;
  pointerOffsetY: number;
  offsets: Array<{ unit: UnitInstance; dx: number; dy: number }>;
};

type CombatProfile = {
  rangeMultiplier: number;
  cooldownMultiplier: number;
  damageMultiplier: number;
  splashRadius: number;
  splashRatio: number;
  ignoreSizePenalty: boolean;
  magic?: "lockdown" | "emp" | "ensnare";
  label: string;
};

type RareSummonEffectConfig = {
  title: string;
  duration: number;
  overlayAlpha: number;
  shake: number;
  ringCount: number;
  sparkCount: number;
  radius: number;
  beamWidth: number;
  auraMs: number;
};

type MonsterInstance = {
  id: string;
  wave: number;
  label: string;
  size: MonsterSize;
  hp: number;
  maxHp: number;
  speed: number;
  isBoss: boolean;
  segment: number;
  segmentDistance: number;
  traveled: number;
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite;
  hpFill: Phaser.GameObjects.Rectangle;
  lockedUntil: number;
  ensnaredUntil: number;
  empUntil: number;
};

type RewardState = {
  reward: BossReward;
  remaining: number;
  source: string;
};

export type GameResultPayload = {
  cleared: boolean;
  round: number;
  score: number;
  kills: number;
  bestGrade: string;
  bestUpgrade: number;
  playTimeSec: number;
  defeatReason?: string;
};

export type GameStatePayload = {
  mode: Mode;
  round: number;
  minerals: number;
  kills: number;
  monsters: number;
  score: number;
  speed: number;
  maxMonsters: number;
  currentWaveLabel: string;
  bossTimeLeftMs: number | null;
  bossTimeLimitMs: number | null;
  upgrades: Record<UnitKind, { level: number; cost: number; name: string }>;
  units: Array<{
    id: string;
    kind: UnitKind;
    name: string;
    race: string;
    grade: string;
    gradeId: GradeId;
    gradeColor: string;
    sellValue: number | null;
    x: number;
    y: number;
  }>;
  selectedUnitId: string | null;
  selectedUnitIds: string[];
  selectedUnit?: {
    id: string;
    name: string;
    race: string;
    grade: string;
    damage: number;
    range: number;
    special: string;
    skillReadyMs: number;
    exchangeCost: number | null;
    exchangeChance: number | null;
    sellValue: number | null;
  };
  focusTargetId: string | null;
  focusTarget?: {
    id: string;
    label: string;
    size: string;
    hp: number;
    maxHp: number;
    boss: boolean;
  };
  visibleMonsters: Array<{
    id: string;
    label: string;
    size: string;
    hp: number;
    boss: boolean;
    x: number;
    y: number;
    progress: number;
  }>;
  reward?: {
    source: string;
    grade: string;
    remaining: number;
    randomUpgradeChance: number;
  };
  result?: GameResultPayload;
};

export type GameApi = {
  start: () => void;
  restart: () => void;
  summon: () => void;
  sellSelected: () => void;
  upgrade: (kind: UnitKind) => void;
  setSpeed: (speed: number) => void;
  selectUnit: (id: string) => void;
  toggleUnitSelection: (id: string) => void;
  focusTarget: (id: string | "front" | null) => void;
  castSelectedSkill: () => boolean;
  exchangeSelected: () => boolean;
  claimReward: (kind: UnitKind | "random") => void;
  debugSummon: (kind: UnitKind, grade: GradeId) => boolean;
  debugMoveUnit: (id: string, x: number, y: number) => boolean;
  debugStartWave: (wave: number) => boolean;
  getState: () => GameStatePayload;
  renderText: () => string;
  advanceForTest: (ms: number) => void;
  advanceFastForTest: (ms: number) => void;
};

const MAX_MONSTERS = 200;
const FINAL_WAVE = 101;
const SUMMON_COST = 10;
const INITIAL_MINERALS = 50;
const BOSS_ROUND_LIMIT_MS = 320_000;
const CANVAS_W = 900;
const CANVAS_H = 640;
const BUILD_BOUNDS = { x: 122, y: 142, width: 656, height: 362 };
const UNIT_MIN_DISTANCE = 44;

export class GameScene extends Phaser.Scene {
  private mode: Mode = "idle";
  private path: Point[] = [];
  private pathLengths: number[] = [];
  private pathTotal = 0;
  private units: UnitInstance[] = [];
  private monsters: MonsterInstance[] = [];
  private selectedUnitId: string | null = null;
  private selectedUnitIds = new Set<string>();
  private dragGroup: DragGroupState | null = null;
  private focusTargetId: string | null = null;
  private upgrades: Record<UnitKind, number> = { ghost: 0, dragoon: 0, hydra: 0 };
  private currentWave!: WaveSpec;
  private spawnedInWave = 0;
  private spawnAccumulator = 0;
  private nextWaveAt = 0;
  private bossDeadlineAt: number | null = null;
  private virtualTime = 0;
  private startVirtualTime = 0;
  private lastStateEmit = 0;
  private minerals = INITIAL_MINERALS;
  private kills = 0;
  private score = 0;
  private speedMultiplier = 4;
  private unitSerial = 0;
  private monsterSerial = 0;
  private killPayoutBank = 0;
  private bestGradeId: GradeId = "common";
  private pendingReward: RewardState | null = null;
  private result: GameResultPayload | undefined;
  private defeatReason: string | undefined;
  private staticLayer?: Phaser.GameObjects.Layer;
  private focusTargetRing?: Phaser.GameObjects.Arc;
  private selectionBox?: Phaser.GameObjects.Rectangle;
  private selectionStart?: Point;

  constructor() {
    super("GameScene");
  }

  create(): void {
    this.createTextures();
    this.buildPath();
    this.drawField();
    this.input.on("dragstart", (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject) => {
      const unit = this.units.find((item) => item.container === gameObject);
      if (unit) this.startUnitDrag(unit, pointer);
    });
    this.input.on(
      "drag",
      (
        _pointer: Phaser.Input.Pointer,
        gameObject: Phaser.GameObjects.GameObject,
        dragX: number,
        dragY: number,
      ) => {
        const unit = this.units.find((item) => item.container === gameObject);
        if (unit) this.dragUnitGroup(unit, dragX, dragY);
      },
    );
    this.input.on("dragend", (_pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.GameObject) => {
      const unit = this.units.find((item) => item.container === gameObject);
      if (unit) {
        this.dragGroup = null;
        this.emitState(true);
      }
    });
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer, targets: Phaser.GameObjects.GameObject[]) => {
      if (targets.length === 0 && this.mode === "playing") this.startSelectionBox(pointer);
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => this.updateSelectionBox(pointer));
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => this.finishSelectionBox(pointer));
    this.currentWave = getWaveSpec(1);

    const api: GameApi = {
      start: () => this.startRun(),
      restart: () => this.startRun(),
      summon: () => this.summonUnit(),
      sellSelected: () => this.sellSelected(),
      upgrade: (kind) => this.upgrade(kind),
      setSpeed: (speed) => this.setSpeed(speed),
      selectUnit: (id) => this.selectUnit(id),
      toggleUnitSelection: (id) => this.toggleUnitSelection(id),
      focusTarget: (id) => this.focusTarget(id),
      castSelectedSkill: () => this.castSelectedSkill(),
      exchangeSelected: () => this.exchangeSelected(),
      claimReward: (kind) => this.claimReward(kind),
      debugSummon: (kind, grade) => this.summonUnit(kind, grade),
      debugMoveUnit: (id, x, y) => this.moveUnitById(id, x, y),
      debugStartWave: (wave) => this.debugStartWave(wave),
      getState: () => this.getStatePayload(),
      renderText: () => this.renderText(),
      advanceForTest: (ms) => this.advanceForTest(ms),
      advanceFastForTest: (ms) => this.advanceFastForTest(ms),
    };

    emit("scene-ready", api);
    this.emitState(true);
  }

  update(_time: number, delta: number): void {
    this.runFrame(delta);
  }

  startRun(): void {
    this.clearDynamicObjects();
    this.mode = "playing";
    this.currentWave = getWaveSpec(1);
    this.spawnedInWave = 0;
    this.spawnAccumulator = 0;
    this.nextWaveAt = 0;
    this.bossDeadlineAt = null;
    this.virtualTime = 0;
    this.startVirtualTime = 0;
    this.lastStateEmit = 0;
    this.minerals = INITIAL_MINERALS;
    this.kills = 0;
    this.score = 0;
    this.killPayoutBank = 0;
    this.upgrades = { ghost: 0, dragoon: 0, hydra: 0 };
    this.bestGradeId = "common";
    this.pendingReward = null;
    this.result = undefined;
    this.defeatReason = undefined;
    this.selectedUnitId = null;
    this.selectedUnitIds.clear();
    this.dragGroup = null;
    this.focusTargetId = null;
    this.updateFocusTargetMarker();
    this.log("1라운드 시작. 4배속으로 바로 달립니다.", "normal");
    emit("result-hide", null);
    emit("reward-hide", null);
    this.emitState(true);
  }

  summonUnit(forcedKind?: UnitKind, forcedGrade?: GradeId): boolean {
    if (this.mode !== "playing" && this.mode !== "reward") return false;
    if (!forcedGrade && this.minerals < SUMMON_COST) {
      this.log("미네랄이 부족합니다.", "warn");
      return false;
    }

    const position = this.nextOpenUnitPosition();
    if (!position) {
      this.log("유닛 배치 공간이 가득 찼습니다.", "warn");
      return false;
    }

    if (!forcedGrade) this.minerals -= SUMMON_COST;
    const kind = forcedKind ?? randomUnitKind();
    const grade = forcedGrade ? GRADE_BY_ID[forcedGrade] : rollGrade();
    const spec = UNITS[kind];
    const id = `u${++this.unitSerial}`;

    const shadow = this.add.ellipse(0, 16, 42, 15, 0x000000, 0.28);
    const ring = this.add
      .circle(0, 10, 20, 0x020617, 0.7)
      .setStrokeStyle(2, grade.color, 0.94);
    const body = this.add.sprite(0, -8, `unit-${kind}`).setScale(1.08);
    const badge = this.add
      .text(0, 23, grade.shortName, {
        color: grade.cssColor,
        fontSize: "12px",
        fontFamily: "monospace",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const container = this.add.container(position.x, position.y, [shadow, ring, body, badge]);
    container.setDepth(20);
    container.setSize(76, 86);
    container.setInteractive(new Phaser.Geom.Rectangle(0, 0, 76, 86), Phaser.Geom.Rectangle.Contains);
    container.on("pointerdown", (pointer: Phaser.Input.Pointer) => this.handleUnitPointerDown(id, pointer));
    this.input.setDraggable(container);

    const unit: UnitInstance = {
      id,
      kind,
      gradeId: grade.id,
      x: position.x,
      y: position.y,
      container,
      body,
      ring,
      nextAttackAt: this.virtualTime + Phaser.Math.Between(80, spec.attackMs),
      skillReadyAt: 0,
    };

    container.on("dragstart", (pointer: Phaser.Input.Pointer) => this.startUnitDrag(unit, pointer));
    container.on("drag", (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      this.dragUnitGroup(unit, dragX, dragY);
    });
    container.on("dragend", () => {
      this.dragGroup = null;
      this.emitState(true);
    });

    this.units.push(unit);
    this.selectUnit(id);

    if (gradeRank(grade.id) > gradeRank(this.bestGradeId)) {
      this.bestGradeId = grade.id;
    }

    const line = `${grade.name} ${spec.name} 소환`;
    this.log(line, gradeRank(grade.id) >= gradeRank("legendary") ? "rare" : "normal");
    if (gradeRank(grade.id) >= gradeRank("legendary")) {
      this.playRareSummonEffect(unit);
    }
    this.emitState(true);
    return true;
  }

  private handleUnitPointerDown(id: string, pointer: Phaser.Input.Pointer): void {
    if (this.isShiftDown(pointer)) {
      this.toggleUnitSelection(id);
    } else if (!this.selectedUnitIds.has(id)) {
      this.selectUnit(id);
    }
  }

  sellSelected(): void {
    const selected = this.units.filter((unit) => this.selectedUnitIds.has(unit.id));
    if (selected.length === 0) {
      this.log("판매할 유닛을 선택하세요.", "warn");
      return;
    }

    const sellable = selected.filter((unit) => GRADE_BY_ID[unit.gradeId].sellValue !== null);
    if (sellable.length === 0) {
      this.log("선택한 유닛은 판매할 수 없습니다.", "warn");
      return;
    }

    let total = 0;
    const soldIds = new Set<string>();
    for (const unit of sellable) {
      const value = GRADE_BY_ID[unit.gradeId].sellValue ?? 0;
      total += value;
      soldIds.add(unit.id);
      unit.container.destroy(true);
    }

    this.units = this.units.filter((unit) => !soldIds.has(unit.id));
    this.minerals += total;
    for (const id of soldIds) this.selectedUnitIds.delete(id);
    if (this.selectedUnitId && soldIds.has(this.selectedUnitId)) {
      this.selectedUnitId = [...this.selectedUnitIds][0] ?? null;
    }

    const skipped = selected.length - sellable.length;
    const skipText = skipped > 0 ? `, 판매 불가 ${skipped}기 제외` : "";
    this.log(`${sellable.length}기 판매 +${total}M${skipText}`, "normal");
    this.refreshUnitSelectionVisuals();
    this.emitState(true);
  }

  upgrade(kind: UnitKind): void {
    if (this.mode !== "playing" && this.mode !== "reward") return;
    const cost = this.upgradeCost(kind);
    if (this.minerals < cost) {
      this.log(`${UNITS[kind].name} 강화 미네랄 부족`, "warn");
      return;
    }
    this.minerals -= cost;
    this.upgrades[kind] += 1;
    this.log(`${UNITS[kind].name} 강화 Lv.${this.upgrades[kind]} 달성`, "normal");
    this.emitState(true);
  }

  setSpeed(speed: number): void {
    if (![1, 2, 4].includes(speed)) return;
    this.speedMultiplier = speed;
    this.log(`${speed}배속으로 변경`, "normal");
    this.emitState(true);
  }

  selectUnit(id: string): void {
    this.selectedUnitId = id;
    this.selectedUnitIds.clear();
    this.selectedUnitIds.add(id);
    this.refreshUnitSelectionVisuals();
    this.emitState(true);
  }

  toggleUnitSelection(id: string): void {
    if (!this.units.some((unit) => unit.id === id)) return;
    if (this.selectedUnitIds.has(id)) {
      this.selectedUnitIds.delete(id);
      if (this.selectedUnitId === id) this.selectedUnitId = [...this.selectedUnitIds][0] ?? null;
    } else {
      this.selectedUnitIds.add(id);
      this.selectedUnitId = id;
    }
    this.refreshUnitSelectionVisuals();
    this.emitState(true);
  }

  private selectUnits(ids: string[]): void {
    this.selectedUnitIds = new Set(ids);
    this.selectedUnitId = ids[ids.length - 1] ?? null;
    this.refreshUnitSelectionVisuals();
    this.emitState(true);
  }

  private refreshUnitSelectionVisuals(): void {
    for (const unit of this.units) {
      const selected = this.selectedUnitIds.has(unit.id);
      const primary = unit.id === this.selectedUnitId;
      const grade = GRADE_BY_ID[unit.gradeId];
      unit.ring.setStrokeStyle(selected ? (primary ? 4 : 3) : 2, selected ? 0xfbbf24 : grade.color, 0.95);
      unit.container.setDepth(selected ? 32 : 20);
    }
  }

  focusTarget(id: string | "front" | null): void {
    if (id === null) {
      this.focusTargetId = null;
      this.updateFocusTargetMarker();
      this.log("점사 타겟 해제", "normal");
      this.emitState(true);
      return;
    }

    const target = id === "front" ? this.bestManualTarget() : this.monsters.find((monster) => monster.id === id);
    if (!target) {
      this.log("점사할 몬스터가 없습니다.", "warn");
      return;
    }

    this.focusTargetId = target.id;
    this.updateFocusTargetMarker();
    this.log(`${target.label} 점사 고정`, target.isBoss ? "rare" : "normal");
    this.emitState(true);
  }

  castSelectedSkill(): boolean {
    const unit = this.units.find((item) => item.id === this.selectedUnitId);
    if (!unit) {
      this.log("스킬을 사용할 에픽 유닛을 선택하세요.", "warn");
      return false;
    }

    const profile = this.combatProfile(unit);
    if (!profile.magic) {
      this.log("선택 유닛은 수동 마법이 없습니다.", "warn");
      return false;
    }
    if (unit.skillReadyAt > this.virtualTime) {
      this.log(`스킬 재사용 대기 ${Math.ceil((unit.skillReadyAt - this.virtualTime) / 1000)}초`, "warn");
      return false;
    }

    const target = this.focusedTargetInRange(unit) ?? this.findTarget(unit);
    if (!target) {
      this.log("스킬 사거리 안의 타겟이 없습니다.", "warn");
      return false;
    }

    unit.skillReadyAt = this.virtualTime + 8000;
    this.applyMagic(unit, target, profile, true);
    this.drawShot(unit.kind, unit.x, unit.y - 8, target.container.x, target.container.y - 4, GRADE_BY_ID[unit.gradeId].color);
    this.log(`${UNITS[unit.kind].name} ${profile.label} 수동 발동`, "rare");
    this.emitState(true);
    return true;
  }

  exchangeSelected(): boolean {
    const unit = this.units.find((item) => item.id === this.selectedUnitId);
    if (!unit) {
      this.log("교환할 전설/신화 유닛을 선택하세요.", "warn");
      return false;
    }

    const option = this.exchangeOption(unit.gradeId);
    if (!option) {
      this.log("전설과 신화만 교환 도박이 가능합니다.", "warn");
      return false;
    }
    if (this.minerals < option.cost) {
      this.log(`교환 도박 미네랄 부족 (${option.cost}M 필요)`, "warn");
      return false;
    }

    this.minerals -= option.cost;
    const oldName = `${GRADE_BY_ID[unit.gradeId].name} ${UNITS[unit.kind].name}`;
    if (Math.random() >= option.chance) {
      this.removeUnit(unit);
      this.log(`${oldName} 교환 실패. 유닛이 사라졌습니다.`, "warn");
      this.emitState(true);
      return false;
    }

    let newKind = randomUnitKind();
    for (let i = 0; i < 6 && newKind === unit.kind; i += 1) newKind = randomUnitKind();
    unit.kind = newKind;
    unit.body.setTexture(`unit-${newKind}`);
    unit.nextAttackAt = this.virtualTime + 120;
    unit.skillReadyAt = 0;
    this.log(`${oldName} 교환 성공 -> ${GRADE_BY_ID[unit.gradeId].name} ${UNITS[newKind].name}`, "rare");
    this.emitState(true);
    return true;
  }

  private moveUnit(unit: UnitInstance, x: number, y: number, ignoreIds?: Set<string>): void {
    const point = this.findOpenUnitPositionNear({ x, y }, ignoreIds ?? new Set([unit.id])) ?? { x: unit.x, y: unit.y };
    this.setUnitPosition(unit, point);
  }

  private setUnitPosition(unit: UnitInstance, point: Point): void {
    unit.x = point.x;
    unit.y = point.y;
    unit.container.setPosition(point.x, point.y);
    unit.container.setDepth(unit.id === this.selectedUnitId ? 32 : 20);
  }

  private startUnitDrag(unit: UnitInstance, pointer: Phaser.Input.Pointer): void {
    if (!this.selectedUnitIds.has(unit.id)) this.selectUnit(unit.id);
    const selected = this.units.filter((item) => this.selectedUnitIds.has(item.id));
    this.dragGroup = {
      anchorId: unit.id,
      pointerOffsetX: unit.x - pointer.worldX,
      pointerOffsetY: unit.y - pointer.worldY,
      offsets: selected.map((item) => ({ unit: item, dx: item.x - unit.x, dy: item.y - unit.y })),
    };
  }

  private dragUnitGroup(unit: UnitInstance, dragX: number, dragY: number): void {
    if (!this.dragGroup || this.dragGroup.anchorId !== unit.id) {
      this.moveUnit(unit, dragX, dragY);
      return;
    }

    const desiredAnchor = { x: dragX, y: dragY };
    const correctedAnchor = this.findFreeGroupAnchor(desiredAnchor, this.dragGroup.offsets);
    if (!correctedAnchor) return;
    for (const item of this.dragGroup.offsets) {
      this.setUnitPosition(item.unit, { x: correctedAnchor.x + item.dx, y: correctedAnchor.y + item.dy });
    }
  }

  private findFreeGroupAnchor(anchor: Point, offsets: DragGroupState["offsets"]): Point | null {
    const base = this.clampGroupAnchor(anchor, offsets);
    if (this.canPlaceGroupAt(base, offsets)) return base;

    const seen = new Set<string>();
    for (let radius = 6; radius <= UNIT_MIN_DISTANCE * 3; radius += 6) {
      const steps = Math.max(12, Math.ceil(radius / 3));
      for (let i = 0; i < steps; i += 1) {
        const angle = (Math.PI * 2 * i) / steps;
        const candidate = this.clampGroupAnchor(
          { x: base.x + Math.cos(angle) * radius, y: base.y + Math.sin(angle) * radius },
          offsets,
        );
        const key = `${Math.round(candidate.x)}:${Math.round(candidate.y)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (this.canPlaceGroupAt(candidate, offsets)) return candidate;
      }
    }

    return null;
  }

  private canPlaceGroupAt(anchor: Point, offsets: DragGroupState["offsets"]): boolean {
    const movingIds = new Set(offsets.map((item) => item.unit.id));
    const points = offsets.map((item) => ({
      id: item.unit.id,
      x: anchor.x + item.dx,
      y: anchor.y + item.dy,
    }));

    for (const point of points) {
      if (!this.pointInBuildArea(point.x, point.y)) return false;
    }

    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        if (Phaser.Math.Distance.Between(points[i].x, points[i].y, points[j].x, points[j].y) < UNIT_MIN_DISTANCE) {
          return false;
        }
      }
    }

    return this.units.every((unit) => {
      if (movingIds.has(unit.id)) return true;
      return points.every((point) => Phaser.Math.Distance.Between(unit.x, unit.y, point.x, point.y) >= UNIT_MIN_DISTANCE);
    });
  }

  private clampGroupAnchor(anchor: Point, offsets: DragGroupState["offsets"]): Point {
    if (offsets.length <= 1) return this.clampToBuildArea(anchor);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const item of offsets) {
      minX = Math.min(minX, item.dx);
      maxX = Math.max(maxX, item.dx);
      minY = Math.min(minY, item.dy);
      maxY = Math.max(maxY, item.dy);
    }

    return {
      x: Phaser.Math.Clamp(anchor.x, BUILD_BOUNDS.x - minX, BUILD_BOUNDS.x + BUILD_BOUNDS.width - maxX),
      y: Phaser.Math.Clamp(anchor.y, BUILD_BOUNDS.y - minY, BUILD_BOUNDS.y + BUILD_BOUNDS.height - maxY),
    };
  }

  private startSelectionBox(pointer: Phaser.Input.Pointer): void {
    if (!this.pointInBuildArea(pointer.worldX, pointer.worldY)) {
      if (!this.isShiftDown(pointer)) this.selectUnits([]);
      return;
    }
    this.selectionStart = { x: pointer.worldX, y: pointer.worldY };
    this.selectionBox?.destroy();
    this.selectionBox = this.add
      .rectangle(pointer.worldX, pointer.worldY, 1, 1, 0x38bdf8, 0.08)
      .setStrokeStyle(1, 0x7dd3fc, 0.82)
      .setOrigin(0, 0)
      .setDepth(120);
  }

  private updateSelectionBox(pointer: Phaser.Input.Pointer): void {
    if (!this.selectionStart || !this.selectionBox) return;
    const x = Math.min(this.selectionStart.x, pointer.worldX);
    const y = Math.min(this.selectionStart.y, pointer.worldY);
    const width = Math.abs(pointer.worldX - this.selectionStart.x);
    const height = Math.abs(pointer.worldY - this.selectionStart.y);
    this.selectionBox.setPosition(x, y).setSize(width, height);
    this.selectionBox.displayWidth = width;
    this.selectionBox.displayHeight = height;
  }

  private finishSelectionBox(pointer: Phaser.Input.Pointer): void {
    if (!this.selectionStart) return;
    const start = this.selectionStart;
    this.selectionStart = undefined;
    this.selectionBox?.destroy();
    this.selectionBox = undefined;

    const x = Math.min(start.x, pointer.worldX);
    const y = Math.min(start.y, pointer.worldY);
    const width = Math.abs(pointer.worldX - start.x);
    const height = Math.abs(pointer.worldY - start.y);
    if (width < 8 && height < 8) {
      if (!this.isShiftDown(pointer)) this.selectUnits([]);
      return;
    }

    const rect = new Phaser.Geom.Rectangle(x, y, width, height);
    const ids = this.units
      .filter((unit) => Phaser.Geom.Rectangle.Contains(rect, unit.x, unit.y))
      .map((unit) => unit.id);
    const merged = this.isShiftDown(pointer) ? [...new Set([...this.selectedUnitIds, ...ids])] : ids;
    this.selectUnits(merged);
  }

  private isShiftDown(pointer: Phaser.Input.Pointer): boolean {
    return Boolean(pointer.event && "shiftKey" in pointer.event && pointer.event.shiftKey);
  }

  private pointInBuildArea(x: number, y: number): boolean {
    return (
      x >= BUILD_BOUNDS.x &&
      x <= BUILD_BOUNDS.x + BUILD_BOUNDS.width &&
      y >= BUILD_BOUNDS.y &&
      y <= BUILD_BOUNDS.y + BUILD_BOUNDS.height
    );
  }

  private bossTimeLeftMs(): number | null {
    if (this.mode !== "playing" || !this.currentWave?.isBoss || this.bossDeadlineAt === null) return null;
    return Math.max(0, Math.ceil(this.bossDeadlineAt - this.virtualTime));
  }

  private moveUnitById(id: string, x: number, y: number): boolean {
    const unit = this.units.find((item) => item.id === id);
    if (!unit) return false;
    this.setUnitPosition(unit, this.clampToBuildArea({ x, y }));
    return true;
  }

  private debugStartWave(wave: number): boolean {
    if (wave < 1 || wave > FINAL_WAVE) return false;
    for (const monster of this.monsters) monster.container.destroy(true);
    this.monsters = [];
    this.focusTargetId = null;
    this.updateFocusTargetMarker();
    this.pendingReward = null;
    emit("reward-hide", null);
    this.mode = "playing";
    this.enterWave(wave);
    this.log(`${this.currentWave.label} 테스트 시작`, this.currentWave.isBoss ? "rare" : "normal");
    this.emitState(true);
    return true;
  }

  private removeUnit(unit: UnitInstance): void {
    const index = this.units.indexOf(unit);
    if (index >= 0) this.units.splice(index, 1);
    if (this.selectedUnitId === unit.id) this.selectedUnitId = null;
    this.selectedUnitIds.delete(unit.id);
    this.refreshUnitSelectionVisuals();
    unit.container.destroy(true);
  }

  private exchangeOption(gradeId: GradeId): { cost: number; chance: number } | null {
    if (gradeId === "legendary") return { cost: 100, chance: 0.66 };
    if (gradeId === "mythic") return { cost: 250, chance: 0.5 };
    return null;
  }

  claimReward(kind: UnitKind | "random"): void {
    if (!this.pendingReward) return;
    const reward = this.pendingReward.reward;
    let unitKind: UnitKind;
    let gradeId = reward.grade;

    if (kind === "random") {
      unitKind = randomUnitKind();
      if (Math.random() < reward.randomUpgradeChance) {
        gradeId = nextGrade(reward.grade).id;
        this.log("랜덤 보상 대성공! 한 단계 높은 등급이 지급됩니다.", "rare");
      }
    } else {
      unitKind = kind;
    }

    const added = this.summonUnit(unitKind, gradeId);
    if (!added) return;

    this.pendingReward.remaining -= 1;
    if (this.pendingReward.remaining <= 0) {
      const finishedWave = this.currentWave.wave;
      this.pendingReward = null;
      emit("reward-hide", null);
      if (isFinalWave(finishedWave)) {
        this.endRun(true);
      } else {
        this.mode = "playing";
        this.startNextWave();
      }
    } else {
      this.emitReward();
    }
    this.emitState(true);
  }

  getStatePayload(): GameStatePayload {
    const selected = this.units.find((unit) => unit.id === this.selectedUnitId);
    const focused = this.focusTargetId
      ? this.monsters.find((monster) => monster.id === this.focusTargetId)
      : undefined;
    const result = this.result;
    const selectedExchange = selected ? this.exchangeOption(selected.gradeId) : null;
    return {
      mode: this.mode,
      round: this.currentWave?.wave ?? 1,
      minerals: this.minerals,
      kills: this.kills,
      monsters: this.monsters.length,
      score: this.score,
      speed: this.speedMultiplier,
      maxMonsters: MAX_MONSTERS,
      currentWaveLabel: this.currentWave?.label ?? "대기",
      bossTimeLeftMs: this.bossTimeLeftMs(),
      bossTimeLimitMs: this.currentWave?.isBoss ? BOSS_ROUND_LIMIT_MS : null,
      upgrades: {
        ghost: { level: this.upgrades.ghost, cost: this.upgradeCost("ghost"), name: UNITS.ghost.name },
        dragoon: {
          level: this.upgrades.dragoon,
          cost: this.upgradeCost("dragoon"),
          name: UNITS.dragoon.name,
        },
        hydra: { level: this.upgrades.hydra, cost: this.upgradeCost("hydra"), name: UNITS.hydra.name },
      },
      units: this.units.map((unit) => {
        const spec = UNITS[unit.kind];
        const grade = GRADE_BY_ID[unit.gradeId];
        return {
          id: unit.id,
          kind: unit.kind,
          name: spec.name,
          race: spec.raceName,
          grade: grade.name,
          gradeId: grade.id,
          gradeColor: grade.cssColor,
          sellValue: grade.sellValue,
          x: Math.round(unit.x),
          y: Math.round(unit.y),
        };
      }),
      selectedUnitId: this.selectedUnitId,
      selectedUnitIds: [...this.selectedUnitIds],
      selectedUnit: selected
        ? {
            id: selected.id,
            name: UNITS[selected.kind].name,
            race: UNITS[selected.kind].raceName,
            grade: GRADE_BY_ID[selected.gradeId].name,
            damage: Math.floor(this.unitDamage(selected)),
            range: Math.floor(this.unitRange(selected)),
            special: this.combatProfile(selected).label,
            skillReadyMs: Math.max(0, Math.ceil(selected.skillReadyAt - this.virtualTime)),
            exchangeCost: selectedExchange?.cost ?? null,
            exchangeChance: selectedExchange?.chance ?? null,
            sellValue: GRADE_BY_ID[selected.gradeId].sellValue,
          }
        : undefined,
      focusTargetId: this.focusTargetId,
      focusTarget: focused
        ? {
            id: focused.id,
            label: focused.label,
            size: SIZE_LABEL[focused.size],
            hp: Math.ceil(focused.hp),
            maxHp: focused.maxHp,
            boss: focused.isBoss,
          }
        : undefined,
      visibleMonsters: this.monsters.slice(0, 24).map((monster) => ({
        id: monster.id,
        label: monster.label,
        size: SIZE_LABEL[monster.size],
        hp: Math.ceil(monster.hp),
        boss: monster.isBoss,
        x: Math.round(monster.container.x),
        y: Math.round(monster.container.y),
        progress: Math.round(monster.traveled),
      })),
      reward: this.pendingReward
        ? {
            source: this.pendingReward.source,
            grade: GRADE_BY_ID[this.pendingReward.reward.grade].name,
            remaining: this.pendingReward.remaining,
            randomUpgradeChance: this.pendingReward.reward.randomUpgradeChance,
          }
        : undefined,
      result,
    };
  }

  renderText(): string {
    const unitCounts = this.units.reduce(
      (acc, unit) => {
        const key = `${unit.kind}:${unit.gradeId}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const monsters = this.monsters.slice(0, 12).map((monster) => ({
      id: monster.id,
      wave: monster.wave,
      boss: monster.isBoss,
      size: SIZE_LABEL[monster.size],
      hp: Math.ceil(monster.hp),
      x: Math.round(monster.container.x),
      y: Math.round(monster.container.y),
      progress: Math.round(monster.traveled),
    }));
    return JSON.stringify({
      coordinateSystem: "Phaser canvas 900x640, origin top-left, x right, y down",
      state: this.getStatePayload(),
      unitCounts,
      visibleMonsters: monsters,
    });
  }

  advanceForTest(ms: number): void {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    const delta = ms / steps;
    for (let i = 0; i < steps; i += 1) this.runFrame(delta);
    this.emitState(true);
  }

  advanceFastForTest(ms: number): void {
    const steps = Math.max(1, Math.round(ms / 120));
    const delta = ms / steps;
    for (let i = 0; i < steps; i += 1) this.runFrame(delta);
    this.emitState(true);
  }

  private runFrame(delta: number): void {
    if (this.mode !== "playing") return;
    const scaledDelta = delta * this.speedMultiplier;
    this.virtualTime += scaledDelta;
    this.spawnWaveMonsters(scaledDelta);
    this.updateMonsters(scaledDelta / 1000);
    this.updateUnits();
    this.checkWaveProgress();
    this.checkDefeat();
    if (this.virtualTime - this.lastStateEmit > 250) this.emitState();
  }

  private spawnWaveMonsters(deltaMs: number): void {
    if (this.spawnedInWave >= this.currentWave.count) return;
    this.spawnAccumulator += deltaMs;
    while (
      this.spawnedInWave < this.currentWave.count &&
      this.spawnAccumulator >= this.currentWave.spawnMs
    ) {
      this.spawnAccumulator -= this.currentWave.spawnMs;
      this.spawnMonster(this.currentWave);
      this.spawnedInWave += 1;
      if (this.spawnedInWave >= this.currentWave.count) {
        this.nextWaveAt = this.virtualTime + (this.currentWave.isBoss ? 0 : 1400);
      }
    }
  }

  private updateMonsters(dtSec: number): void {
    for (const monster of this.monsters) {
      this.updateMonsterStatusVisual(monster);
      let travel = monster.speed * this.monsterSpeedFactor(monster) * dtSec;
      monster.traveled += travel;
      while (travel > 0) {
        const segmentLength = this.pathLengths[monster.segment];
        const remaining = segmentLength - monster.segmentDistance;
        const step = Math.min(remaining, travel);
        monster.segmentDistance += step;
        travel -= step;
      if (monster.segmentDistance >= segmentLength - 0.001) {
        monster.segment = (monster.segment + 1) % this.path.length;
        monster.segmentDistance = 0;
      }
    }
    const position = this.positionOnSegment(monster.segment, monster.segmentDistance);
    monster.container.setPosition(position.x, position.y);
    monster.container.setDepth(40);
  }
    this.updateFocusTargetMarker();
  }

  private updateUnits(): void {
    for (const unit of this.units) {
      if (unit.nextAttackAt > this.virtualTime) continue;
      const target = this.findTarget(unit);
      if (!target) continue;

      const profile = this.combatProfile(unit);
      unit.nextAttackAt = this.virtualTime + this.attackCooldown(unit);
      const damage = this.unitDamage(unit) * profile.damageMultiplier * this.sizeModifier(unit, target, profile);
      this.hitMonster(unit, target, damage, profile);
    }
  }

  private checkWaveProgress(): void {
    if (this.spawnedInWave < this.currentWave.count) return;
    if (this.currentWave.isBoss) return;
    if (this.nextWaveAt > 0 && this.virtualTime >= this.nextWaveAt) {
      this.startNextWave();
    }
  }

  private checkDefeat(): void {
    if (this.mode !== "playing") return;
    if (this.currentWave.isBoss && this.bossDeadlineAt !== null && this.virtualTime >= this.bossDeadlineAt) {
      this.endRun(false, `${this.currentWave.label} 제한시간 초과. 실패.`);
      return;
    }
    if (this.monsters.length >= MAX_MONSTERS) this.endRun(false, "몬스터 200마리 도달. 실패.");
  }

  private startNextWave(): void {
    const next = this.currentWave.wave + 1;
    if (next > FINAL_WAVE) {
      this.endRun(true);
      return;
    }
    this.enterWave(next);
    this.log(`${this.currentWave.label} 시작`, this.currentWave.isBoss ? "rare" : "normal");
    this.emitState(true);
  }

  private enterWave(wave: number): void {
    this.currentWave = getWaveSpec(wave);
    this.spawnedInWave = 0;
    this.spawnAccumulator = this.currentWave.spawnMs;
    this.nextWaveAt = 0;
    this.bossDeadlineAt = this.currentWave.isBoss ? this.virtualTime + BOSS_ROUND_LIMIT_MS : null;
  }

  private spawnMonster(wave: WaveSpec): void {
    const id = `m${++this.monsterSerial}`;
    const scale = wave.isBoss ? 1.45 : wave.size === "large" ? 1.12 : wave.size === "small" ? 0.86 : 1;
    const shadow = this.add.ellipse(0, 13 * scale, 32 * scale, 11 * scale, 0x000000, 0.26);
    const body = this.add.sprite(0, -4 * scale, wave.isBoss ? "monster-boss" : `monster-${wave.size}`).setScale(scale);
    const hpBack = this.add.rectangle(0, -27 * scale, 36 * scale, 4, 0x020617, 0.88);
    const hpFill = this.add.rectangle(-18 * scale, -27 * scale, 36 * scale, 4, 0xef4444, 1).setOrigin(0, 0.5);
    const label = wave.isBoss
      ? this.add
          .text(0, 26 * scale, wave.label, {
            color: "#fef3c7",
            fontSize: "11px",
            fontFamily: "monospace",
            fontStyle: "bold",
          })
          .setOrigin(0.5)
      : null;
    const start = this.path[0];
    const children = label ? [shadow, body, hpBack, hpFill, label] : [shadow, body, hpBack, hpFill];
    const container = this.add.container(start.x, start.y, children).setDepth(40);
    container.setSize(58 * scale, 62 * scale);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-29 * scale, -36 * scale, 58 * scale, 72 * scale),
      Phaser.Geom.Rectangle.Contains,
    );
    container.on("pointerdown", () => this.focusTarget(id));
    this.monsters.push({
      id,
      wave: wave.wave,
      label: wave.label,
      size: wave.size,
      hp: wave.hp,
      maxHp: wave.hp,
      speed: wave.speed,
      isBoss: wave.isBoss,
      segment: 0,
      segmentDistance: 0,
      traveled: wave.isBoss ? 100000 + wave.wave * 1000 : wave.wave * 1000,
      container,
      body,
      hpFill,
      lockedUntil: 0,
      ensnaredUntil: 0,
      empUntil: 0,
    });
  }

  private hitMonster(
    unit: UnitInstance,
    monster: MonsterInstance,
    damage: number,
    profile: CombatProfile,
  ): void {
    const targetX = monster.container.x;
    const targetY = monster.container.y - 4;
    this.drawShot(unit.kind, unit.x, unit.y - 8, targetX, targetY, GRADE_BY_ID[unit.gradeId].color);
    if (profile.magic && Math.random() < (monster.isBoss ? 0.34 : 0.16)) {
      this.applyMagic(unit, monster, profile, false);
    }
    this.damageMonster(monster, damage, unit);
    this.applySplash(unit, monster, targetX, targetY, damage, profile);
  }

  private damageMonster(monster: MonsterInstance, damage: number, unit: UnitInstance): void {
    if (!this.monsters.includes(monster)) return;
    monster.hp -= damage;
    const ratio = Phaser.Math.Clamp(monster.hp / monster.maxHp, 0, 1);
    const scale = this.monsterScale(monster);
    monster.hpFill.width = 36 * scale * ratio;
    if (monster.hp <= 0) {
      this.killMonster(monster, unit);
    }
  }

  private killMonster(monster: MonsterInstance, unit: UnitInstance): void {
    const index = this.monsters.indexOf(monster);
    if (index >= 0) this.monsters.splice(index, 1);
    if (this.focusTargetId === monster.id) {
      this.focusTargetId = null;
      this.updateFocusTargetMarker();
    }
    monster.container.destroy(true);
    this.kills += 1;
    this.killPayoutBank += 1;
    this.score += monster.isBoss ? 2500 + monster.wave * 120 : 10 + monster.wave * 2;
    if (this.killPayoutBank >= 10) {
      const payouts = Math.floor(this.killPayoutBank / 10);
      this.killPayoutBank -= payouts * 10;
      this.minerals += payouts * 12;
    }

    if (monster.isBoss && monster.wave === this.currentWave.wave) {
      if (isFinalWave(monster.wave)) {
        this.endRun(true);
      } else if (this.currentWave.reward) {
        this.minerals += this.currentWave.reward.mineral;
        this.pendingReward = {
          reward: this.currentWave.reward,
          remaining: this.currentWave.reward.count,
          source: monster.label,
        };
        this.mode = "reward";
        this.log(`${monster.label} 처치. 보상을 선택하세요.`, "rare");
        this.emitReward();
      } else {
        this.log(`${monster.label} 처치`, "rare");
        this.startNextWave();
      }
    }

    if (gradeRank(unit.gradeId) >= gradeRank("legendary")) {
      this.flashAt(unit.x, unit.y, GRADE_BY_ID[unit.gradeId].color);
    }
  }

  private endRun(cleared: boolean, defeatReason?: string): void {
    if (this.mode === "ended") return;
    this.mode = "ended";
    this.defeatReason = cleared ? undefined : defeatReason;
    const round = cleared ? FINAL_WAVE : this.currentWave.wave;
    this.result = {
      cleared,
      round,
      score: this.score + (cleared ? 100000 : 0),
      kills: this.kills,
      bestGrade: GRADE_BY_ID[this.bestGradeId].name,
      bestUpgrade: Math.max(this.upgrades.ghost, this.upgrades.dragoon, this.upgrades.hydra),
      playTimeSec: Math.floor((this.virtualTime - this.startVirtualTime) / 1000),
      defeatReason: this.defeatReason,
    };
    this.score = this.result.score;
    this.log(cleared ? "101R CLEAR!" : this.defeatReason ?? "도전 실패.", cleared ? "rare" : "warn");
    emit("result", this.result);
    this.emitState(true);
  }

  private findTarget(unit: UnitInstance): MonsterInstance | null {
    const focused = this.focusedTargetInRange(unit);
    if (focused) return focused;

    const range = this.unitRange(unit);
    const rangeSq = range * range;
    let best: MonsterInstance | null = null;
    for (const monster of this.monsters) {
      const dx = monster.container.x - unit.x;
      const dy = monster.container.y - unit.y;
      if (dx * dx + dy * dy > rangeSq) continue;
      if (!best || monster.traveled > best.traveled) best = monster;
    }
    return best;
  }

  private focusedTargetInRange(unit: UnitInstance): MonsterInstance | null {
    if (!this.focusTargetId) return null;
    const target = this.monsters.find((monster) => monster.id === this.focusTargetId);
    if (!target) return null;
    const range = this.unitRange(unit);
    const dx = target.container.x - unit.x;
    const dy = target.container.y - unit.y;
    return dx * dx + dy * dy <= range * range ? target : null;
  }

  private bestManualTarget(): MonsterInstance | null {
    return [...this.monsters].sort((a, b) => {
      if (a.isBoss !== b.isBoss) return a.isBoss ? -1 : 1;
      if (Math.ceil(a.hp) !== Math.ceil(b.hp)) return b.hp - a.hp;
      return b.traveled - a.traveled;
    })[0] ?? null;
  }

  private combatProfile(unit: UnitInstance): CombatProfile {
    const base: CombatProfile = {
      rangeMultiplier: 1,
      cooldownMultiplier: 1,
      damageMultiplier: 1,
      splashRadius: 0,
      splashRatio: 0,
      ignoreSizePenalty: false,
      label: "기본 공격",
    };

    if (unit.gradeId === "relic") {
      return {
        ...base,
        rangeMultiplier: 1.12,
        cooldownMultiplier: 0.82,
        label: "유물: 사거리와 공속 증가",
      };
    }

    if (unit.gradeId === "epic") {
      return {
        ...base,
        rangeMultiplier: 1.18,
        cooldownMultiplier: 0.74,
        damageMultiplier: 1.06,
        label: "서사: 강화 고속 단일 공격",
      };
    }

    if (unit.gradeId === "legendary") {
      return {
        ...base,
        rangeMultiplier: 1.24,
        cooldownMultiplier: 0.68,
        damageMultiplier: 1.08,
        splashRadius: 48,
        splashRatio: 0.36,
        label: "전설: 작은 스플래시 공격",
      };
    }

    if (unit.gradeId === "unique") {
      const magicByKind: Record<UnitKind, CombatProfile["magic"]> = {
        ghost: "lockdown",
        dragoon: "emp",
        hydra: "ensnare",
      };
      const labelByKind: Record<UnitKind, string> = {
        ghost: "에픽: 락다운 정지탄",
        dragoon: "에픽: EMP 취약화탄",
        hydra: "에픽: 인스네어 감속탄",
      };
      return {
        ...base,
        rangeMultiplier: 1.32,
        cooldownMultiplier: 0.6,
        damageMultiplier: 1.14,
        splashRadius: 58,
        splashRatio: 0.44,
        magic: magicByKind[unit.kind],
        label: labelByKind[unit.kind],
      };
    }

    if (unit.gradeId === "mythic") {
      return {
        ...base,
        rangeMultiplier: 1.48,
        cooldownMultiplier: 0.42,
        damageMultiplier: 1.18,
        splashRadius: 82,
        splashRatio: 0.72,
        ignoreSizePenalty: true,
        label: "신화: 초고속 광역 공격",
      };
    }

    if (unit.gradeId === "origin") {
      return {
        ...base,
        rangeMultiplier: 1.86,
        cooldownMultiplier: 0.32,
        damageMultiplier: 1.28,
        splashRadius: 860,
        splashRatio: 0.56,
        ignoreSizePenalty: true,
        label: "태초: 전장급 스플래시 공격",
      };
    }

    return base;
  }

  private unitRange(unit: UnitInstance): number {
    return UNITS[unit.kind].range * this.combatProfile(unit).rangeMultiplier;
  }

  private attackCooldown(unit: UnitInstance): number {
    const cooldown = UNITS[unit.kind].attackMs * this.combatProfile(unit).cooldownMultiplier;
    return Math.max(90, cooldown);
  }

  private sizeModifier(unit: UnitInstance, monster: MonsterInstance, profile: CombatProfile): number {
    let modifier = profile.ignoreSizePenalty ? 1 : DAMAGE_MODIFIER[unit.kind][monster.size];
    if (monster.empUntil > this.virtualTime) modifier *= 1.25;
    if (unit.gradeId === "unique") modifier = Math.max(modifier, 0.82);
    return modifier;
  }

  private monsterSpeedFactor(monster: MonsterInstance): number {
    if (monster.lockedUntil > this.virtualTime) return monster.isBoss ? 0.18 : 0;
    if (monster.ensnaredUntil > this.virtualTime) return monster.isBoss ? 0.62 : 0.42;
    return 1;
  }

  private updateMonsterStatusVisual(monster: MonsterInstance): void {
    if (monster.lockedUntil > this.virtualTime) {
      monster.body.setTint(0x38bdf8);
      return;
    }
    if (monster.ensnaredUntil > this.virtualTime) {
      monster.body.setTint(0x4ade80);
      return;
    }
    if (monster.empUntil > this.virtualTime) {
      monster.body.setTint(0xa78bfa);
      return;
    }
    monster.body.clearTint();
  }

  private applyMagic(
    unit: UnitInstance,
    monster: MonsterInstance,
    profile: CombatProfile,
    manual: boolean,
  ): void {
    if (!profile.magic || !this.monsters.includes(monster)) return;
    const color = GRADE_BY_ID[unit.gradeId].color;
    const duration = manual ? (monster.isBoss ? 1700 : 3200) : monster.isBoss ? 820 : 1550;

    if (profile.magic === "lockdown") {
      monster.lockedUntil = Math.max(monster.lockedUntil, this.virtualTime + duration);
      this.drawStatusPulse(monster.container.x, monster.container.y, manual ? 48 : 30, 0x38bdf8);
      return;
    }

    const radius = profile.magic === "emp" ? (manual ? 96 : 72) : manual ? 88 : 66;
    for (const other of [...this.monsters]) {
      if (Phaser.Math.Distance.Between(monster.container.x, monster.container.y, other.container.x, other.container.y) > radius) {
        continue;
      }
      if (profile.magic === "emp") {
        other.empUntil = Math.max(other.empUntil, this.virtualTime + (manual ? (other.isBoss ? 2600 : 4200) : other.isBoss ? 1450 : 2550));
        if (manual) this.damageMonster(other, Math.min(other.maxHp * 0.018, this.unitDamage(unit) * 1.2), unit);
      } else {
        other.ensnaredUntil = Math.max(other.ensnaredUntil, this.virtualTime + (manual ? (other.isBoss ? 2600 : 4300) : other.isBoss ? 1500 : 2600));
      }
    }
    this.drawStatusPulse(monster.container.x, monster.container.y, radius, profile.magic === "emp" ? 0xa78bfa : 0x4ade80);
    if (profile.magic === "emp") this.flashAt(monster.container.x, monster.container.y, color);
  }

  private applySplash(
    unit: UnitInstance,
    primary: MonsterInstance,
    x: number,
    y: number,
    primaryDamage: number,
    profile: CombatProfile,
  ): void {
    if (profile.splashRadius <= 0 || profile.splashRatio <= 0) return;

    const splashColor = GRADE_BY_ID[unit.gradeId].color;
    const visualRadius = Math.min(profile.splashRadius, 210);
    this.drawSplash(x, y, visualRadius, splashColor);

    for (const monster of [...this.monsters]) {
      if (monster.id === primary.id) continue;
      const distance = Phaser.Math.Distance.Between(x, y, monster.container.x, monster.container.y);
      if (distance > profile.splashRadius) continue;
      const falloff = Phaser.Math.Clamp(1 - distance / Math.max(profile.splashRadius, 1), 0.42, 1);
      const splashDamage = primaryDamage * profile.splashRatio * falloff;
      this.damageMonster(monster, splashDamage, unit);
    }
  }

  private monsterScale(monster: MonsterInstance): number {
    return monster.isBoss ? 1.45 : monster.size === "large" ? 1.12 : monster.size === "small" ? 0.86 : 1;
  }

  private updateFocusTargetMarker(): void {
    const target = this.focusTargetId
      ? this.monsters.find((monster) => monster.id === this.focusTargetId)
      : undefined;

    if (!target) {
      this.focusTargetRing?.destroy();
      this.focusTargetRing = undefined;
      if (this.focusTargetId && !target) this.focusTargetId = null;
      return;
    }

    const radius = target.isBoss ? 30 : 23;
    if (!this.focusTargetRing) {
      this.focusTargetRing = this.add.circle(target.container.x, target.container.y, radius, 0x000000, 0);
      this.focusTargetRing.setStrokeStyle(3, 0xfef08a, 0.94).setDepth(85);
    }
    this.focusTargetRing.setPosition(target.container.x, target.container.y);
    this.focusTargetRing.setRadius(radius);
  }

  private unitDamage(unit: UnitInstance): number {
    const spec = UNITS[unit.kind];
    const grade = GRADE_BY_ID[unit.gradeId];
    const upgrade = 1 + this.upgrades[unit.kind] * 0.34;
    return spec.baseDamage * grade.power * upgrade;
  }

  private upgradeCost(kind: UnitKind): number {
    const level = this.upgrades[kind];
    const base = kind === "hydra" ? 10 : 12;
    const lateTax = Math.max(0, level - 25) * 1.2;
    return Math.floor(base + level * 1.15 + lateTax);
  }

  private nextOpenUnitPosition(): Point | null {
    const seed = this.units.length + 1;
    for (let i = 0; i < 140; i += 1) {
      const angle = (seed + i) * 2.399963;
      const radius = 20 + Math.sqrt(seed + i) * 20;
      const point = this.clampToBuildArea({
        x: CANVAS_W / 2 + Math.cos(angle) * radius * 1.55,
        y: CANVAS_H / 2 + Math.sin(angle) * radius,
      });
      if (this.isUnitPointAvailable(point, new Set())) return point;
    }
    for (let i = 0; i < 180; i += 1) {
      const point = this.clampToBuildArea({
        x: Phaser.Math.Between(BUILD_BOUNDS.x, BUILD_BOUNDS.x + BUILD_BOUNDS.width),
        y: Phaser.Math.Between(BUILD_BOUNDS.y, BUILD_BOUNDS.y + BUILD_BOUNDS.height),
      });
      if (this.isUnitPointAvailable(point, new Set())) return point;
    }
    return null;
  }

  private clampToBuildArea(point: Point): Point {
    return {
      x: Phaser.Math.Clamp(point.x, BUILD_BOUNDS.x, BUILD_BOUNDS.x + BUILD_BOUNDS.width),
      y: Phaser.Math.Clamp(point.y, BUILD_BOUNDS.y, BUILD_BOUNDS.y + BUILD_BOUNDS.height),
    };
  }

  private findOpenUnitPositionNear(point: Point, ignoreIds: Set<string>): Point | null {
    const base = this.clampToBuildArea(point);
    if (this.isUnitPointAvailable(base, ignoreIds)) return base;

    const seen = new Set<string>();
    for (let radius = 6; radius <= UNIT_MIN_DISTANCE * 3; radius += 6) {
      const steps = Math.max(12, Math.ceil(radius / 3));
      for (let i = 0; i < steps; i += 1) {
        const angle = (Math.PI * 2 * i) / steps;
        const candidate = this.clampToBuildArea({
          x: base.x + Math.cos(angle) * radius,
          y: base.y + Math.sin(angle) * radius,
        });
        const key = `${Math.round(candidate.x)}:${Math.round(candidate.y)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (this.isUnitPointAvailable(candidate, ignoreIds)) return candidate;
      }
    }

    return null;
  }

  private isUnitPointAvailable(point: Point, ignoreIds: Set<string>): boolean {
    if (!this.pointInBuildArea(point.x, point.y)) return false;
    return this.units.every((unit) => {
      if (ignoreIds.has(unit.id)) return true;
      return Phaser.Math.Distance.Between(unit.x, unit.y, point.x, point.y) >= UNIT_MIN_DISTANCE;
    });
  }

  private buildPath(): void {
    this.path = [
      { x: 76, y: 96 },
      { x: CANVAS_W - 76, y: 96 },
      { x: CANVAS_W - 76, y: CANVAS_H - 92 },
      { x: 76, y: CANVAS_H - 92 },
    ];
    this.pathLengths = this.path.map((point, index) => {
      const next = this.path[(index + 1) % this.path.length];
      return Phaser.Math.Distance.Between(point.x, point.y, next.x, next.y);
    });
    this.pathTotal = this.pathLengths.reduce((sum, length) => sum + length, 0);
  }

  private positionOnSegment(segment: number, distance: number): Point {
    const start = this.path[segment];
    const end = this.path[(segment + 1) % this.path.length];
    const t = Phaser.Math.Clamp(distance / this.pathLengths[segment], 0, 1);
    return {
      x: Phaser.Math.Linear(start.x, end.x, t),
      y: Phaser.Math.Linear(start.y, end.y, t),
    };
  }

  private drawField(): void {
    this.staticLayer?.destroy(true);
    this.staticLayer = this.add.layer();
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x182433, 0x182433, 0x0a1019, 0x0a1019, 1);
    bg.fillRect(0, 0, CANVAS_W, CANVAS_H);

    bg.fillStyle(0x111827, 1);
    bg.fillRoundedRect(92, 114, CANVAS_W - 184, CANVAS_H - 228, 8);
    bg.lineStyle(1, 0x26384c, 0.8);
    bg.strokeRoundedRect(92, 114, CANVAS_W - 184, CANVAS_H - 228, 8);

    bg.lineStyle(1, 0x1e3346, 0.45);
    for (let x = BUILD_BOUNDS.x; x <= BUILD_BOUNDS.x + BUILD_BOUNDS.width; x += 38) {
      bg.lineBetween(x, BUILD_BOUNDS.y, x, BUILD_BOUNDS.y + BUILD_BOUNDS.height);
    }
    for (let y = BUILD_BOUNDS.y; y <= BUILD_BOUNDS.y + BUILD_BOUNDS.height; y += 34) {
      bg.lineBetween(BUILD_BOUNDS.x, y, BUILD_BOUNDS.x + BUILD_BOUNDS.width, y);
    }

    bg.lineStyle(28, 0x283746, 1);
    for (let i = 0; i < this.path.length; i += 1) {
      const a = this.path[i];
      const b = this.path[(i + 1) % this.path.length];
      bg.lineBetween(a.x, a.y, b.x, b.y);
    }
    bg.lineStyle(2, 0xfbbf24, 0.72);
    for (let i = 0; i < this.path.length; i += 1) {
      const a = this.path[i];
      const b = this.path[(i + 1) % this.path.length];
      bg.lineBetween(a.x, a.y, b.x, b.y);
    }

    const title = this.add
      .text(CANVAS_W / 2, 38, "101라운드까지 버티면 클리어", {
        color: "#fef3c7",
        fontSize: "18px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    const sub = this.add
      .text(CANVAS_W / 2, CANVAS_H - 34, "유닛 드래그 배치 · 소환 10M · 10킬당 12M · 200마리 패배", {
        color: "#cbd5e1",
        fontSize: "14px",
      })
      .setOrigin(0.5);
    this.staticLayer.add([bg, title, sub]);
  }

  private createTextures(): void {
    const makeUnit = (key: string, color: number, accent: number, shape: "circle" | "diamond" | "spike") => {
      if (this.textures.exists(key)) return;
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.clear();
      if (shape === "circle") {
        g.fillStyle(0x020617, 0.36).fillEllipse(24, 39, 34, 9);
        g.fillStyle(0x111827, 1).fillRect(13, 30, 7, 10).fillRect(28, 30, 7, 10);
        g.fillStyle(accent, 1).fillEllipse(24, 24, 22, 26);
        g.fillStyle(color, 1).fillRect(16, 15, 16, 17);
        g.fillStyle(0xe5e7eb, 1).fillRect(18, 10, 12, 9);
        g.fillStyle(0x0f172a, 1).fillRect(12, 22, 25, 4);
        g.fillStyle(0xcbd5e1, 1).fillRect(31, 20, 13, 3);
        g.fillStyle(0x38bdf8, 1).fillRect(20, 17, 8, 3);
      } else if (shape === "diamond") {
        g.fillStyle(0x020617, 0.38).fillEllipse(24, 40, 38, 10);
        g.fillStyle(accent, 1).fillEllipse(24, 25, 30, 22);
        g.fillStyle(color, 1).fillEllipse(24, 22, 22, 15);
        g.fillStyle(0x1e3a8a, 1).fillRect(9, 28, 9, 4).fillRect(30, 28, 9, 4);
        g.fillRect(13, 34, 7, 5).fillRect(28, 34, 7, 5);
        g.fillStyle(0xfef08a, 1).fillCircle(24, 22, 4);
        g.lineStyle(2, 0xfacc15, 0.9).strokeTriangle(24, 7, 38, 25, 24, 41);
      } else {
        g.fillStyle(0x020617, 0.38).fillEllipse(24, 40, 38, 10);
        g.fillStyle(accent, 1).fillTriangle(9, 39, 19, 8, 26, 35);
        g.fillTriangle(39, 39, 29, 8, 22, 35);
        g.fillStyle(color, 1).fillEllipse(24, 27, 25, 30);
        g.fillStyle(0x14532d, 1).fillTriangle(15, 17, 19, 6, 23, 19);
        g.fillTriangle(25, 19, 29, 6, 33, 17);
        g.fillStyle(0x052e16, 1).fillCircle(18, 23, 3).fillCircle(30, 23, 3);
        g.fillStyle(0xbbf7d0, 1).fillTriangle(18, 35, 24, 27, 30, 35);
      }
      g.generateTexture(key, 48, 48);
      g.destroy();
    };

    makeUnit("unit-ghost", UNITS.ghost.color, UNITS.ghost.accent, "circle");
    makeUnit("unit-dragoon", UNITS.dragoon.color, UNITS.dragoon.accent, "diamond");
    makeUnit("unit-hydra", UNITS.hydra.color, UNITS.hydra.accent, "spike");

    const makeMonster = (key: string, color: number, accent: number, radius: number) => {
      if (this.textures.exists(key)) return;
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x020617, 0.35).fillEllipse(28, 43, radius * 2.1, 9);
      g.fillStyle(accent, 1).fillEllipse(28, 29, radius * 2.1, radius * 1.8 + 8);
      g.fillStyle(color, 1).fillEllipse(28, 23, radius * 1.9, radius * 1.7);
      g.fillStyle(0x0f172a, 1).fillCircle(22, 22, 3).fillCircle(34, 22, 3);
      g.fillStyle(0xf8fafc, 0.35).fillEllipse(22, 15, radius * 0.65, radius * 0.3);
      g.generateTexture(key, 56, 56);
      g.destroy();
    };

    makeMonster("monster-small", 0xf87171, 0x7f1d1d, 13);
    makeMonster("monster-medium", 0x93c5fd, 0x1e3a8a, 16);
    makeMonster("monster-large", 0xa78bfa, 0x4c1d95, 19);
    makeMonster("monster-boss", 0xfde68a, 0x92400e, 21);
  }

  private playRareSummonEffect(unit: UnitInstance): void {
    const grade = GRADE_BY_ID[unit.gradeId];
    const spec = UNITS[unit.kind];
    const config = this.rareSummonEffectConfig(unit.gradeId);
    const primary = grade.color;
    const secondary = spec.color;
    const parts = this.colorParts(primary);

    this.cameras.main.flash(Math.min(260, config.duration * 0.22), parts.r, parts.g, parts.b);
    this.cameras.main.shake(Math.min(360, config.duration * 0.28), config.shake);

    const overlay = this.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, primary, config.overlayAlpha)
      .setDepth(132)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: overlay,
      alpha: 0,
      duration: config.duration,
      ease: "Sine.easeOut",
      onComplete: () => overlay.destroy(),
    });

    const beam = this.add
      .rectangle(unit.x, unit.y - 155, config.beamWidth, 320, primary, 0.16)
      .setDepth(134)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: beam,
      alpha: 0,
      scaleX: 1.9,
      scaleY: 0.15,
      duration: config.duration * 0.9,
      ease: "Quad.easeOut",
      onComplete: () => beam.destroy(),
    });

    this.drawRareSummonRings(unit.x, unit.y, primary, secondary, config);
    this.drawRareSummonSparks(unit.x, unit.y, primary, secondary, config);
    this.drawRaceSummonSignature(unit.kind, unit.x, unit.y, primary, secondary, config);
    this.attachRareSummonAura(unit, primary, secondary, config);
    this.showRareSummonTitle(config.title, primary, secondary, config.duration);
  }

  private rareSummonEffectConfig(gradeId: GradeId): RareSummonEffectConfig {
    const configs: Record<GradeId, RareSummonEffectConfig> = {
      common: {
        title: "",
        duration: 700,
        overlayAlpha: 0,
        shake: 0,
        ringCount: 0,
        sparkCount: 0,
        radius: 0,
        beamWidth: 0,
        auraMs: 0,
      },
      rare: {
        title: "",
        duration: 700,
        overlayAlpha: 0,
        shake: 0,
        ringCount: 0,
        sparkCount: 0,
        radius: 0,
        beamWidth: 0,
        auraMs: 0,
      },
      ancient: {
        title: "",
        duration: 700,
        overlayAlpha: 0,
        shake: 0,
        ringCount: 0,
        sparkCount: 0,
        radius: 0,
        beamWidth: 0,
        auraMs: 0,
      },
      relic: {
        title: "",
        duration: 700,
        overlayAlpha: 0,
        shake: 0,
        ringCount: 0,
        sparkCount: 0,
        radius: 0,
        beamWidth: 0,
        auraMs: 0,
      },
      epic: {
        title: "",
        duration: 700,
        overlayAlpha: 0,
        shake: 0,
        ringCount: 0,
        sparkCount: 0,
        radius: 0,
        beamWidth: 0,
        auraMs: 0,
      },
      legendary: {
        title: "전설 소환",
        duration: 880,
        overlayAlpha: 0.05,
        shake: 0.0022,
        ringCount: 2,
        sparkCount: 16,
        radius: 86,
        beamWidth: 56,
        auraMs: 1300,
      },
      unique: {
        title: "에픽 출현",
        duration: 1080,
        overlayAlpha: 0.08,
        shake: 0.0032,
        ringCount: 3,
        sparkCount: 24,
        radius: 118,
        beamWidth: 72,
        auraMs: 1800,
      },
      mythic: {
        title: "신화 강림",
        duration: 1320,
        overlayAlpha: 0.12,
        shake: 0.0044,
        ringCount: 4,
        sparkCount: 34,
        radius: 154,
        beamWidth: 92,
        auraMs: 2300,
      },
      origin: {
        title: "태초 각성",
        duration: 1600,
        overlayAlpha: 0.18,
        shake: 0.006,
        ringCount: 5,
        sparkCount: 48,
        radius: 210,
        beamWidth: 124,
        auraMs: 3000,
      },
    };

    return configs[gradeId];
  }

  private drawRareSummonRings(
    x: number,
    y: number,
    primary: number,
    secondary: number,
    config: RareSummonEffectConfig,
  ): void {
    for (let i = 0; i < config.ringCount; i += 1) {
      const color = i % 2 === 0 ? primary : secondary;
      const ring = this.add.circle(x, y, 16 + i * 4, color, 0.06).setStrokeStyle(3, color, 0.78);
      ring.setDepth(138 + i).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: ring,
        radius: config.radius + i * 22,
        alpha: 0,
        duration: config.duration * (0.72 + i * 0.1),
        delay: i * 82,
        ease: "Sine.easeOut",
        onComplete: () => ring.destroy(),
      });
    }
  }

  private drawRareSummonSparks(
    x: number,
    y: number,
    primary: number,
    secondary: number,
    config: RareSummonEffectConfig,
  ): void {
    for (let i = 0; i < config.sparkCount; i += 1) {
      const angle = (Math.PI * 2 * i) / config.sparkCount + Phaser.Math.FloatBetween(-0.18, 0.18);
      const distance = Phaser.Math.Between(Math.floor(config.radius * 0.34), Math.floor(config.radius));
      const color = i % 3 === 0 ? secondary : primary;
      const spark = this.add.circle(x, y - 4, Phaser.Math.Between(2, 4), color, 0.9);
      spark.setDepth(146).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance - Phaser.Math.Between(10, 54),
        alpha: 0,
        scale: Phaser.Math.FloatBetween(0.25, 0.7),
        duration: Phaser.Math.Between(Math.floor(config.duration * 0.42), Math.floor(config.duration * 0.9)),
        ease: "Quad.easeOut",
        onComplete: () => spark.destroy(),
      });
    }
  }

  private drawRaceSummonSignature(
    kind: UnitKind,
    x: number,
    y: number,
    primary: number,
    secondary: number,
    config: RareSummonEffectConfig,
  ): void {
    if (kind === "ghost") {
      for (let i = -2; i <= 2; i += 1) {
        const line = this.add.graphics().setDepth(145).setBlendMode(Phaser.BlendModes.ADD);
        const offset = i * 16;
        line.lineStyle(i === 0 ? 3 : 1, i === 0 ? primary : secondary, i === 0 ? 0.86 : 0.54);
        line.lineBetween(x + offset, y - 112, x + offset * 0.35, y + 46);
        this.tweens.add({
          targets: line,
          alpha: 0,
          y: -28,
          duration: config.duration * 0.82,
          ease: "Sine.easeOut",
          onComplete: () => line.destroy(),
        });
      }
      return;
    }

    if (kind === "dragoon") {
      for (let i = 0; i < 7; i += 1) {
        const angle = (Math.PI * 2 * i) / 7;
        const bolt = this.add.graphics().setDepth(145).setBlendMode(Phaser.BlendModes.ADD);
        bolt.lineStyle(2, i % 2 === 0 ? secondary : primary, 0.82);
        const sx = x + Math.cos(angle) * 22;
        const sy = y + Math.sin(angle) * 12 - 8;
        bolt.lineBetween(sx, sy, sx + Math.cos(angle) * 34, sy + Math.sin(angle) * 28);
        bolt.lineBetween(sx + Math.cos(angle) * 34, sy + Math.sin(angle) * 28, sx + Math.cos(angle + 0.42) * 52, sy + Math.sin(angle + 0.42) * 46);
        this.tweens.add({
          targets: bolt,
          alpha: 0,
          scale: 1.45,
          duration: config.duration * 0.64,
          ease: "Quad.easeOut",
          onComplete: () => bolt.destroy(),
        });
      }
      return;
    }

    for (let i = 0; i < 9; i += 1) {
      const mist = this.add.circle(
        x + Phaser.Math.Between(-26, 26),
        y + Phaser.Math.Between(-8, 24),
        Phaser.Math.Between(9, 18),
        i % 2 === 0 ? secondary : primary,
        0.16,
      );
      mist.setDepth(144).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: mist,
        x: mist.x + Phaser.Math.Between(-42, 42),
        y: mist.y - Phaser.Math.Between(24, 70),
        radius: mist.radius * Phaser.Math.FloatBetween(1.7, 2.6),
        alpha: 0,
        duration: config.duration * Phaser.Math.FloatBetween(0.65, 1.05),
        ease: "Sine.easeOut",
        onComplete: () => mist.destroy(),
      });
    }
  }

  private attachRareSummonAura(
    unit: UnitInstance,
    primary: number,
    secondary: number,
    config: RareSummonEffectConfig,
  ): void {
    const aura = this.add.circle(0, -2, 28, primary, 0.05).setStrokeStyle(2, primary, 0.88);
    const orbit = this.add.circle(0, -2, 38, secondary, 0).setStrokeStyle(2, secondary, 0.72);
    aura.setBlendMode(Phaser.BlendModes.ADD);
    orbit.setBlendMode(Phaser.BlendModes.ADD);
    unit.container.add([aura, orbit]);

    this.tweens.add({
      targets: aura,
      radius: 42,
      alpha: 0,
      duration: config.auraMs,
      ease: "Sine.easeOut",
      onComplete: () => aura.destroy(),
    });
    this.tweens.add({
      targets: orbit,
      angle: 360,
      scaleX: 1.18,
      scaleY: 0.72,
      alpha: 0,
      duration: config.auraMs,
      ease: "Sine.easeInOut",
      onComplete: () => orbit.destroy(),
    });
  }

  private showRareSummonTitle(title: string, primary: number, secondary: number, duration: number): void {
    if (!title) return;
    const back = this.add
      .rectangle(CANVAS_W / 2, 92, 300, 42, 0x020617, 0.78)
      .setStrokeStyle(1, secondary, 0.48)
      .setDepth(150);
    const text = this.add
      .text(CANVAS_W / 2, 90, title, {
        color: "#fff7ed",
        fontSize: "28px",
        fontStyle: "bold",
        stroke: "#020617",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(151);
    text.setTint(primary);

    this.tweens.add({
      targets: [back, text],
      y: "-=18",
      alpha: 0,
      duration,
      delay: 220,
      ease: "Sine.easeIn",
      onComplete: () => {
        back.destroy();
        text.destroy();
      },
    });
  }

  private colorParts(color: number): { r: number; g: number; b: number } {
    return {
      r: (color >> 16) & 0xff,
      g: (color >> 8) & 0xff,
      b: color & 0xff,
    };
  }

  private drawShot(kind: UnitKind, x1: number, y1: number, x2: number, y2: number, color: number): void {
    if (kind === "ghost") {
      const shot = this.add.graphics().setDepth(100);
      shot.lineStyle(2, 0xdbeafe, 0.96);
      shot.lineBetween(x1, y1, x2, y2);
      shot.lineStyle(1, color, 0.75);
      shot.lineBetween(x1 + 2, y1 + 1, x2 + 2, y2 + 1);
      this.tweens.add({
        targets: shot,
        alpha: 0,
        duration: 75,
        onComplete: () => shot.destroy(),
      });
      return;
    }

    if (kind === "dragoon") {
      const trail = this.add.graphics().setDepth(99);
      trail.lineStyle(2, 0x7dd3fc, 0.35);
      trail.lineBetween(x1, y1, x2, y2);
      const orb = this.add.circle(x1, y1, 5, 0x93c5fd, 1).setStrokeStyle(2, color, 0.9).setDepth(100);
      this.tweens.add({
        targets: orb,
        x: x2,
        y: y2,
        duration: 115,
        ease: "Quad.easeOut",
        onComplete: () => {
          orb.destroy();
          this.flashAt(x2, y2, 0x93c5fd);
        },
      });
      this.tweens.add({
        targets: trail,
        alpha: 0,
        duration: 140,
        onComplete: () => trail.destroy(),
      });
      return;
    }

    const spine = this.add.graphics().setDepth(100);
    spine.lineStyle(2, 0xbbf7d0, 0.95);
    spine.lineBetween(x1, y1, x2, y2);
    spine.lineStyle(1, color, 0.9);
    spine.lineBetween(x1 - 3, y1 + 2, x2 - 3, y2 + 2);
    spine.lineBetween(x1 + 3, y1 - 2, x2 + 3, y2 - 2);
    this.tweens.add({
      targets: spine,
      alpha: 0,
      duration: 105,
      onComplete: () => spine.destroy(),
    });
  }

  private drawSplash(x: number, y: number, radius: number, color: number): void {
    const wave = this.add.circle(x, y, Math.max(12, radius * 0.22), color, 0.1).setStrokeStyle(2, color, 0.62);
    wave.setDepth(96);
    this.tweens.add({
      targets: wave,
      radius,
      alpha: 0,
      duration: 210,
      ease: "Quad.easeOut",
      onComplete: () => wave.destroy(),
    });
  }

  private drawStatusPulse(x: number, y: number, radius: number, color: number): void {
    const pulse = this.add.circle(x, y, 8, color, 0.18).setStrokeStyle(2, color, 0.8);
    pulse.setDepth(98);
    this.tweens.add({
      targets: pulse,
      radius,
      alpha: 0,
      duration: 300,
      ease: "Sine.easeOut",
      onComplete: () => pulse.destroy(),
    });
  }

  private flashAt(x: number, y: number, color: number): void {
    const flash = this.add.circle(x, y, 18, color, 0.2).setStrokeStyle(2, color, 0.9);
    flash.setDepth(y + 32);
    this.tweens.add({
      targets: flash,
      scale: 2.2,
      alpha: 0,
      duration: 260,
      onComplete: () => flash.destroy(),
    });
  }

  private clearDynamicObjects(): void {
    for (const unit of this.units) unit.container.destroy(true);
    for (const monster of this.monsters) monster.container.destroy(true);
    this.focusTargetRing?.destroy();
    this.focusTargetRing = undefined;
    this.selectionBox?.destroy();
    this.selectionBox = undefined;
    this.selectionStart = undefined;
    this.dragGroup = null;
    this.units = [];
    this.monsters = [];
    this.selectedUnitId = null;
    this.focusTargetId = null;
    this.selectedUnitIds.clear();
  }

  private emitReward(): void {
    if (!this.pendingReward) return;
    emit("reward", {
      source: this.pendingReward.source,
      grade: GRADE_BY_ID[this.pendingReward.reward.grade].name,
      remaining: this.pendingReward.remaining,
      randomUpgradeChance: this.pendingReward.reward.randomUpgradeChance,
    });
  }

  private emitState(force = false): void {
    if (!force && this.virtualTime - this.lastStateEmit < 250) return;
    this.lastStateEmit = this.virtualTime;
    emit("state", this.getStatePayload());
  }

  private log(message: string, tone: "normal" | "warn" | "rare"): void {
    emit("log", { message, tone });
  }

  private toggleFullscreen(): void {
    if (this.scale.isFullscreen) this.scale.stopFullscreen();
    else this.scale.startFullscreen();
  }
}
