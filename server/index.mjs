import express from "express";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const dataDir = path.resolve("server");
const scorePath = path.join(dataDir, "scores.json");

app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5173");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/scores", async (_req, res) => {
  const scores = await readScores();
  res.json(sortScores(keepBestScoresByNickname(scores)).slice(0, 50));
});

app.post("/api/scores", async (req, res) => {
  const record = sanitizeRecord(req.body);
  if (!record) {
    res.status(400).json({ error: "invalid_score" });
    return;
  }

  const scores = await readScores();
  const result = upsertBestScore(scores, record);
  await writeScores(sortScores(result.scores).slice(0, 500));
  res.status(result.saved ? 201 : 200).json({ record: result.record, saved: result.saved });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`score server listening on http://127.0.0.1:${port}`);
});

async function readScores() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(scorePath)) return [];
  try {
    const raw = await readFile(scorePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeScores(scores) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(scorePath, `${JSON.stringify(scores, null, 2)}\n`, "utf8");
}

function sanitizeRecord(input) {
  const nickname = String(input?.nickname ?? "").trim().slice(0, 12);
  if (!nickname) return null;

  const round = clampInt(input?.round, 1, 101);
  const score = clampInt(input?.score, 0, 999999999);
  const kills = clampInt(input?.kills, 0, 9999999);
  const bestUpgrade = clampInt(input?.bestUpgrade, 0, 999);
  const playTimeSec = clampInt(input?.playTimeSec, 0, 86400);
  const cleared = Boolean(input?.cleared) && round >= 101;
  const bestGrade = String(input?.bestGrade ?? "일반").slice(0, 12);

  return {
    id: crypto.randomUUID(),
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

function clampInt(value, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function sortScores(scores) {
  return [...scores].sort(compareScoreRecords);
}

function upsertBestScore(scores, record) {
  const bestScores = keepBestScoresByNickname([...scores, record]);
  const recordKey = nicknameKey(record.nickname);
  const keptRecord = bestScores.find((score) => nicknameKey(score.nickname) === recordKey) ?? record;

  return {
    scores: bestScores,
    record: keptRecord,
    saved: keptRecord.id === record.id,
  };
}

function keepBestScoresByNickname(scores) {
  const bestByNickname = new Map();

  for (const score of scores) {
    const key = nicknameKey(score.nickname);
    if (!key) continue;
    const current = bestByNickname.get(key);
    if (!current || compareScoreRecords(score, current) < 0) {
      bestByNickname.set(key, score);
    }
  }

  return [...bestByNickname.values()];
}

function nicknameKey(nickname) {
  return String(nickname).trim().toLocaleLowerCase("ko-KR");
}

function compareScoreRecords(a, b) {
  if (a.cleared !== b.cleared) return a.cleared ? -1 : 1;
  if (a.round !== b.round) return b.round - a.round;
  if (a.score !== b.score) return b.score - a.score;
  if (a.kills !== b.kills) return b.kills - a.kills;
  return String(b.createdAt).localeCompare(String(a.createdAt));
}
