import type { GradeId, GradeSpec } from "./types";

export const GRADES: GradeSpec[] = [
  {
    id: "common",
    name: "일반",
    shortName: "일",
    probability: 50.0,
    power: 1,
    color: 0xcbd5e1,
    cssColor: "#cbd5e1",
    sellValue: 3,
  },
  {
    id: "rare",
    name: "레어",
    shortName: "레",
    probability: 33.1,
    power: 1.65,
    color: 0x60a5fa,
    cssColor: "#60a5fa",
    sellValue: 6,
  },
  {
    id: "ancient",
    name: "고대",
    shortName: "고",
    probability: 10.2,
    power: 2.75,
    color: 0x34d399,
    cssColor: "#34d399",
    sellValue: 9,
  },
  {
    id: "relic",
    name: "유물",
    shortName: "유",
    probability: 5.1,
    power: 4.8,
    color: 0xfbbf24,
    cssColor: "#fbbf24",
    sellValue: 16,
  },
  {
    id: "epic",
    name: "서사",
    shortName: "서",
    probability: 0.8,
    power: 8.5,
    color: 0xc084fc,
    cssColor: "#c084fc",
    sellValue: 30,
  },
  {
    id: "legendary",
    name: "전설",
    shortName: "전",
    probability: 0.5,
    power: 15,
    color: 0xfb7185,
    cssColor: "#fb7185",
    sellValue: null,
  },
  {
    id: "unique",
    name: "에픽",
    shortName: "에",
    probability: 0.2,
    power: 28,
    color: 0xf97316,
    cssColor: "#f97316",
    sellValue: null,
  },
  {
    id: "mythic",
    name: "신화",
    shortName: "신",
    probability: 0.08,
    power: 54,
    color: 0x22d3ee,
    cssColor: "#22d3ee",
    sellValue: null,
  },
  {
    id: "origin",
    name: "태초",
    shortName: "태",
    probability: 0.019,
    power: 120,
    color: 0xf8fafc,
    cssColor: "#f8fafc",
    sellValue: null,
  },
];

export const GRADE_BY_ID = Object.fromEntries(GRADES.map((grade) => [grade.id, grade])) as Record<
  GradeId,
  GradeSpec
>;

export function rollGrade(random = Math.random): GradeSpec {
  const total = GRADES.reduce((sum, grade) => sum + grade.probability, 0);
  let ticket = random() * total;
  for (const grade of GRADES) {
    ticket -= grade.probability;
    if (ticket <= 0) return grade;
  }
  return GRADES[0];
}

export function gradeRank(id: GradeId): number {
  return GRADES.findIndex((grade) => grade.id === id);
}

export function nextGrade(id: GradeId): GradeSpec {
  const index = gradeRank(id);
  return GRADES[Math.min(index + 1, GRADES.length - 1)];
}
