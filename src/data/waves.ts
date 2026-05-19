import type { BossReward, GradeId, MonsterSize, WaveSpec } from "./types";

type RoundDef = {
  stage: string;
  monster: string;
  size: MonsterSize;
  boss?: boolean;
  reward?: BossReward;
  hp?: number;
  speed?: number;
};

const reward = (mineral: number, grade: GradeId, count = 1): BossReward => ({
  mineral,
  grade,
  count,
  randomUpgradeChance: 0.2,
});

const ROUNDS: Record<number, RoundDef> = {
  1: { stage: "리스항구", monster: "달팽이", size: "small" },
  2: { stage: "리스항구 외곽", monster: "파란달팽이", size: "small" },
  3: { stage: "헤네시스", monster: "빨간달팽이", size: "large" },
  4: { stage: "헤네시스 사냥터", monster: "주황버섯", size: "small" },
  5: { stage: "엘리니아", monster: "슬라임", size: "medium" },
  6: { stage: "엘리니아 남쪽필드", monster: "다크스텀프", size: "large" },
  7: { stage: "나무줄기둥지", monster: "초록버섯", size: "large" },
  8: { stage: "솟아오른나무", monster: "루팡", size: "small" },
  9: { stage: "페리온", monster: "와일드보어", size: "large" },
  10: { stage: "바위길", monster: "다크엑스텀프", size: "large" },
  11: { stage: "유적발굴단캠프", monster: "우드마스크", size: "small" },
  12: { stage: "유적발굴지", monster: "스켈독", size: "large" },
  13: { stage: "제1군영", monster: "스켈레톤 장교", size: "small" },
  14: { stage: "유적의 낭떠러지", monster: "스켈레톤 지휘관", size: "large" },
  15: { stage: "커닝시티", monster: "옥토퍼스", size: "medium" },
  16: { stage: "2호선 1구역", monster: "주니어레이스", size: "large" },
  17: { stage: "방황의 늪", monster: "주니어 네키", size: "medium" },
  18: { stage: "위험한 크로코", monster: "크로코", size: "small" },
  19: { stage: "플로리다 비치", monster: "로랑", size: "large" },
  20: { stage: "따뜻한 모래밭", monster: "엄티", size: "large" },
  21: { stage: "슬리피우드", monster: "좀비버섯", size: "small" },
  22: { stage: "드레이크 동굴", monster: "드레이크", size: "large" },
  23: { stage: "오르비스 항해중", monster: "플라이아이", size: "small" },
  24: {
    stage: "크림슨발록의 습격",
    monster: "크림슨 발록",
    size: "small",
    boss: true,
    reward: reward(50, "relic"),
    hp: 21000,
    speed: 46,
  },
  25: { stage: "오르비스", monster: "루나픽시", size: "medium" },
  26: { stage: "세가지빛 정원으로 가는 길", monster: "셀리온", size: "small" },
  27: { stage: "오르비스탑 입구", monster: "아이스스톤볼", size: "large" },
  28: { stage: "오르비스탑 10층", monster: "파이어스톤볼", size: "large" },
  29: { stage: "여신의 흔적", monster: "러스터픽시", size: "large" },
  30: { stage: "여신의 흔적", monster: "파파픽시", size: "small", boss: true, hp: 32000, speed: 48 },
  31: { stage: "엘나스", monster: "주니어예티", size: "small" },
  32: { stage: "차가운 벌판", monster: "헥터", size: "small" },
  33: { stage: "아쿠아리움", monster: "버플피쉬", size: "small" },
  34: { stage: "동쪽바다 갈림길", monster: "마스크피쉬", size: "large" },
  35: { stage: "위험한 바다의 협곡", monster: "리셀스퀴드", size: "large" },
  36: { stage: "난파선의 무덤", monster: "콜드샤크", size: "large" },
  37: {
    stage: "피아누스의 동굴",
    monster: "피아누스",
    size: "medium",
    boss: true,
    reward: reward(50, "epic"),
    hp: 62000,
    speed: 42,
  },
  38: { stage: "루디브리엄 항해중1", monster: "치크세이버", size: "small" },
  39: { stage: "루디브리엄 항해중2", monster: "트위터", size: "medium" },
  40: { stage: "루디브리엄", monster: "브라운테니", size: "small" },
  41: { stage: "하늘테라스 05", monster: "장난감목마", size: "large" },
  42: { stage: "에오스탑 100층", monster: "라츠", size: "medium" },
  43: { stage: "에오스탑 101층", monster: "트릭스터", size: "large" },
  44: { stage: "차원의 균열", monster: "롬바드", size: "large" },
  45: { stage: "차원의 균열", monster: "알리샤르", size: "large", boss: true, hp: 115000, speed: 40 },
  46: { stage: "지구방위본부", monster: "마티안", size: "small" },
  47: { stage: "로스웰초원", monster: "플라티안", size: "medium" },
  48: { stage: "쿨란초원1", monster: "바나드 그레이", size: "large" },
  49: { stage: "쿨란초원2", monster: "울트라 그레이", size: "small" },
  50: { stage: "장난감공장 1공정", monster: "로보토이", size: "large" },
  51: { stage: "장난감공장 기계실", monster: "마스터로보", size: "large" },
  52: { stage: "시간의 길", monster: "틱톡", size: "small" },
  53: { stage: "시간의 소용돌이", monster: "플레툰크로노스", size: "medium" },
  54: { stage: "사라진 시간", monster: "마스터 데스티니", size: "small" },
  55: { stage: "잊혀진 시간의 길", monster: "G.팬텀워치", size: "large" },
  56: { stage: "삐뚤어진 시간", monster: "듀얼 파이렛", size: "large" },
  57: { stage: "뒤틀린 시간의 길", monster: "기간틱 바이킹", size: "large" },
  58: {
    stage: "시계탑의 근원",
    monster: "파풀라투스",
    size: "small",
    boss: true,
    reward: reward(50, "epic"),
    hp: 190000,
    speed: 52,
  },
  59: { stage: "아랫마을", monster: "월묘", size: "medium" },
  60: { stage: "도깨비 고개", monster: "깨비", size: "large" },
  61: { stage: "무릉도원", monster: "묘선", size: "small" },
  62: { stage: "천도파수원", monster: "원공", size: "small" },
  63: { stage: "백초마을", monster: "삼단지", size: "small" },
  64: { stage: "50년 된 약초밭", monster: "늙은 도라지", size: "medium" },
  65: { stage: "빨간코 해적단 소굴", monster: "캡틴", size: "large" },
  66: { stage: "해적퇴치", monster: "데비즌", size: "large", boss: true, hp: 360000, speed: 42 },
  67: { stage: "아리안트", monster: "주니어카투스", size: "small" },
  68: { stage: "아리안트 동문 밖", monster: "벨라모아", size: "small" },
  69: { stage: "붉은 모래사막", monster: "붉은 모래난쟁이", size: "large" },
  70: { stage: "꿈꾸는 사막", monster: "스콜피언", size: "small" },
  71: { stage: "마가티아", monster: "네오 휴로이드", size: "large" },
  72: { stage: "관계자 출입금지", monster: "사이티", size: "small" },
  73: { stage: "날카로운 절벽", monster: "다크예티와 페페", size: "large" },
  74: { stage: "늑대의 영역", monster: "라이칸스로프", size: "small" },
  75: { stage: "폐광", monster: "마이너 좀비", size: "small" },
  76: { stage: "통로", monster: "쿨리좀비", size: "small" },
  77: { stage: "시련의 동굴", monster: "주니어 불독", size: "small" },
  78: { stage: "자쿰으로 통하는 문", monster: "파이어독", size: "large" },
  79: {
    stage: "자쿰의 제단",
    monster: "자쿰",
    size: "medium",
    boss: true,
    reward: reward(70, "legendary"),
    hp: 760000,
    speed: 40,
  },
  80: { stage: "리프레", monster: "레쉬", size: "medium" },
  81: { stage: "심술쟁이의 숲", monster: "헹키", size: "small" },
  82: { stage: "불과 어둠의 전장", monster: "검은 켄타우로스", size: "large" },
  83: { stage: "마뇽의 숲", monster: "마뇽", size: "large" },
  84: { stage: "용의 숲", monster: "리스튼", size: "large" },
  85: { stage: "사라진 숲", monster: "다크코니언", size: "small" },
  86: { stage: "협곡의 갈림길", monster: "블루 와이번", size: "small" },
  87: { stage: "죽은 용의 둥지", monster: "스켈레곤", size: "large" },
  88: { stage: "생명의 동굴 입구", monster: "뉴트주니어", size: "small" },
  89: { stage: "혼테일의 동굴 입구", monster: "네스트 골렘", size: "large" },
  90: {
    stage: "혼테일의 동굴",
    monster: "혼테일",
    size: "large",
    boss: true,
    reward: reward(100, "legendary"),
    hp: 1850000,
    speed: 38,
  },
  91: { stage: "시간의 신전", monster: "시간의 눈", size: "small" },
  92: { stage: "세 개의 문", monster: "추억의 사제", size: "small" },
  93: { stage: "망각의 길", monster: "망각의 수호대장", size: "large" },
  94: { stage: "부서진 회랑", monster: "라이카", size: "large" },
  95: {
    stage: "신들의 황혼",
    monster: "핑크빈",
    size: "medium",
    boss: true,
    reward: reward(150, "legendary"),
    hp: 3100000,
    speed: 44,
  },
  96: {
    stage: "비틀린 시간의 신전",
    monster: "타락한 시간의 신관",
    size: "small",
    boss: true,
    reward: reward(100, "relic"),
    hp: 1550000,
    speed: 46,
  },
  97: {
    stage: "미래의 문",
    monster: "타락한 시간의 수호대장",
    size: "large",
    boss: true,
    reward: reward(100, "relic", 2),
    hp: 1900000,
    speed: 40,
  },
  98: {
    stage: "파괴된 헤네시스",
    monster: "변형된 슬라임",
    size: "medium",
    boss: true,
    reward: reward(100, "epic"),
    hp: 2300000,
    speed: 44,
  },
  99: {
    stage: "황혼의 페리온",
    monster: "에이션트 다크골렘",
    size: "medium",
    boss: true,
    reward: reward(100, "epic", 2),
    hp: 2650000,
    speed: 42,
  },
  100: {
    stage: "기사단요새",
    monster: "정식기사A",
    size: "small",
    boss: true,
    reward: reward(100, "legendary"),
    hp: 3400000,
    speed: 50,
  },
  101: {
    stage: "시그너스의 정원",
    monster: "시그너스",
    size: "medium",
    boss: true,
    hp: 5200000,
    speed: 40,
  },
};

export function getWaveSpec(wave: number): WaveSpec {
  const def = ROUNDS[wave] ?? ROUNDS[1];
  const isBoss = Boolean(def.boss);
  const label = isBoss ? def.monster : `${wave}R ${def.monster}`;

  if (isBoss) {
    return {
      wave,
      label,
      count: 1,
      hp: def.hp ?? bossHp(wave),
      speed: def.speed ?? 42,
      size: def.size,
      spawnMs: 120,
      isBoss: true,
      reward: def.reward,
    };
  }

  return {
    wave,
    label,
    count: Math.min(70, 12 + Math.floor(wave * 1.12)),
    hp: regularHp(wave),
    speed: def.speed ?? 38 + Math.min(30, wave * 0.44),
    size: def.size,
    spawnMs: Math.max(225, 810 - wave * 5),
    isBoss: false,
  };
}

export function isFinalWave(wave: number): boolean {
  return wave >= 101;
}

function regularHp(wave: number): number {
  const phaseBoost = wave >= 90 ? 1.32 : wave >= 79 ? 1.18 : wave >= 58 ? 1.12 : wave >= 37 ? 1.06 : 1;
  return Math.floor((20 + wave * 7.25) * Math.pow(1.075, wave) * phaseBoost);
}

function bossHp(wave: number): number {
  return Math.floor(regularHp(wave) * (wave >= 96 ? 16 : 12));
}
