export type GradeId =
  | "common"
  | "rare"
  | "ancient"
  | "relic"
  | "epic"
  | "legendary"
  | "unique"
  | "mythic"
  | "origin";

export type UnitKind = "ghost" | "dragoon" | "hydra";
export type MonsterSize = "small" | "medium" | "large";
export type DamageType = "concussive" | "normal" | "explosive";

export type GradeSpec = {
  id: GradeId;
  name: string;
  shortName: string;
  probability: number;
  power: number;
  color: number;
  cssColor: string;
  sellValue: number | null;
};

export type UnitSpec = {
  kind: UnitKind;
  raceName: string;
  name: string;
  attackType: DamageType;
  baseDamage: number;
  range: number;
  attackMs: number;
  color: number;
  accent: number;
};

export type WaveSpec = {
  wave: number;
  label: string;
  count: number;
  hp: number;
  speed: number;
  size: MonsterSize;
  spawnMs: number;
  isBoss: boolean;
  reward?: BossReward;
};

export type BossReward = {
  mineral: number;
  grade: GradeId;
  count: number;
  randomUpgradeChance: number;
};

export type ScoreRecord = {
  id: string;
  nickname: string;
  round: number;
  cleared: boolean;
  score: number;
  kills: number;
  bestGrade: string;
  bestUpgrade: number;
  playTimeSec: number;
  createdAt: string;
};
