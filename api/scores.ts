import { get, put } from "@vercel/blob";

type ScoreRecord = {
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

const SCORE_PATH = "scores.json";
const TOP_RECORDS = 50;
const MAX_RECORDS = 500;

export default {
  fetch(request: Request): Promise<Response> {
    return route(request);
  },
};

async function route(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (request.method === "GET") return handleGet();
  if (request.method === "POST") return handlePost(request);

  return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "GET,POST,OPTIONS" });
}

async function handleGet(): Promise<Response> {
  try {
    const scores = await readScores();
    return jsonResponse(sortScores(scores).slice(0, TOP_RECORDS));
  } catch (error) {
    console.error("score read failed", error);
    return jsonResponse([]);
  }
}

async function handlePost(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const record = sanitizeRecord(body);
  if (!record) return jsonResponse({ error: "invalid_score" }, 400);

  try {
    const scores = await readScores();
    scores.push(record);
    await writeScores(sortScores(scores).slice(0, MAX_RECORDS));
    return jsonResponse(record, 201);
  } catch (error) {
    console.error("score write failed", error);
    return jsonResponse({ error: "score_storage_unavailable" }, 500);
  }
}

async function readScores(): Promise<ScoreRecord[]> {
  const blob = await get(SCORE_PATH, { access: "private", useCache: false });
  if (!blob || !blob.stream) return [];

  const raw = await new Response(blob.stream).text();
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.filter(isScoreRecord) : [];
}

async function writeScores(scores: ScoreRecord[]): Promise<void> {
  await put(SCORE_PATH, `${JSON.stringify(scores, null, 2)}\n`, {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
  });
}

function sanitizeRecord(input: unknown): ScoreRecord | null {
  if (!isPlainObject(input)) return null;

  const nickname = String(input.nickname ?? "").trim().slice(0, 12);
  if (!nickname) return null;

  const round = clampInt(input.round, 1, 101);
  const score = clampInt(input.score, 0, 999999999);
  const kills = clampInt(input.kills, 0, 9999999);
  const bestUpgrade = clampInt(input.bestUpgrade, 0, 999);
  const playTimeSec = clampInt(input.playTimeSec, 0, 86400);
  const cleared = Boolean(input.cleared) && round >= 101;
  const bestGrade = String(input.bestGrade ?? "일반").slice(0, 12);

  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    nickname,
    round: cleared ? 101 : round,
    cleared,
    score,
    kills,
    bestGrade,
    bestUpgrade,
    playTimeSec,
    createdAt: new Date().toISOString(),
  };
}

function clampInt(value: unknown, min: number, max: number): number {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function sortScores(scores: ScoreRecord[]): ScoreRecord[] {
  return [...scores].sort((a, b) => {
    if (a.cleared !== b.cleared) return a.cleared ? -1 : 1;
    if (a.round !== b.round) return b.round - a.round;
    if (a.score !== b.score) return b.score - a.score;
    if (a.kills !== b.kills) return b.kills - a.kills;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

function isScoreRecord(value: unknown): value is ScoreRecord {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.nickname === "string" &&
    typeof value.round === "number" &&
    typeof value.cleared === "boolean" &&
    typeof value.score === "number" &&
    typeof value.kills === "number" &&
    typeof value.bestGrade === "string" &&
    typeof value.bestUpgrade === "number" &&
    typeof value.playTimeSec === "number" &&
    typeof value.createdAt === "string"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type",
  };
}
