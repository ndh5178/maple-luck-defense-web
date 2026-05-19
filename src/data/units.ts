import type { MonsterSize, UnitKind, UnitSpec } from "./types";

export const UNITS: Record<UnitKind, UnitSpec> = {
  ghost: {
    kind: "ghost",
    raceName: "테란",
    name: "고스트",
    attackType: "concussive",
    baseDamage: 15,
    range: 178,
    attackMs: 760,
    color: 0x5eead4,
    accent: 0x0f766e,
  },
  dragoon: {
    kind: "dragoon",
    raceName: "프로토스",
    name: "드라군",
    attackType: "explosive",
    baseDamage: 27,
    range: 205,
    attackMs: 1060,
    color: 0xfacc15,
    accent: 0x7c3aed,
  },
  hydra: {
    kind: "hydra",
    raceName: "저그",
    name: "히드라",
    attackType: "normal",
    baseDamage: 12,
    range: 165,
    attackMs: 560,
    color: 0x86efac,
    accent: 0x166534,
  },
};

export const UNIT_KINDS: UnitKind[] = ["ghost", "dragoon", "hydra"];

export const SIZE_LABEL: Record<MonsterSize, string> = {
  small: "소형",
  medium: "중형",
  large: "대형",
};

export const DAMAGE_MODIFIER: Record<UnitKind, Record<MonsterSize, number>> = {
  ghost: {
    small: 1,
    medium: 0.5,
    large: 0.25,
  },
  hydra: {
    small: 1,
    medium: 1,
    large: 1,
  },
  dragoon: {
    small: 0.5,
    medium: 0.75,
    large: 1,
  },
};

export function randomUnitKind(random = Math.random): UnitKind {
  return UNIT_KINDS[Math.floor(random() * UNIT_KINDS.length)];
}
