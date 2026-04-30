import { Router, type IRouter } from "express";
import { analyze } from "../lib/derive";
import {
  ensureTable,
  loadMemory,
  memoryDataPath,
  saveMemorySync,
  scheduleSave,
  type TableState,
} from "../lib/memory";
import { predictNext, type Prediction } from "../lib/predict";
import { getCachedSource, pollOnce, type SourceRow } from "../lib/source";
import { learnFromSequence } from "../lib/learner";
import { applySeeds, SEED_SEQUENCES } from "../lib/seed";
import { backfillAccuracy } from "../lib/backfill";

const router: IRouter = Router();

type TableEntry = {
  table: string;
  goodRoad: string | null;
  inShoeChange: boolean;
  shoeNumber: number;
  lastShoeChangeAt: string | null;
  observations: number;
  mainSequence: string;
  bigRoad: string;
  columns: number[];
  subBoards: { eye: string; small: string; cockroach: string };
  prediction: Prediction;
};

function tableState(tableName: string): TableState | undefined {
  const mem = loadMemory();
  return mem.tables[tableName];
}

function buildTableEntry(row: SourceRow): TableEntry {
  const a = analyze(row.result || "");
  const mem = loadMemory();
  const state = mem.tables[row.table_name];
  const inShoeChange = !a.cleaned || (state?.inShoeChange ?? false);
  const prediction: Prediction = inShoeChange
    ? {
        pick: null,
        confidence: 0,
        basis: "Bàn đang thay bộ bài, chưa có dữ liệu để dự đoán",
        details: [],
        totalSamples: 0,
      }
    : predictNext(mem, {
        bigRoad: a.bigRoad,
        eye: a.eye,
        small: a.small,
        cockroach: a.cockroach,
      });
  return {
    table: row.table_name,
    goodRoad: row.goodRoad ?? null,
    inShoeChange,
    shoeNumber: state?.shoeNumber ?? 1,
    lastShoeChangeAt: state?.lastShoeChangeAt ?? null,
    observations: state?.observations ?? 0,
    mainSequence: a.cleaned,
    bigRoad: a.bigRoad,
    columns: a.columns,
    subBoards: { eye: a.eye, small: a.small, cockroach: a.cockroach },
    prediction,
  };
}

router.get("/predict", (_req, res) => {
  const { rows, fetchedAt, error } = getCachedSource();
  const mem = loadMemory();
  const tables = rows.map((row) => buildTableEntry(row));
  res.json({
    code: 200,
    fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
    sourceError: error,
    learnedSamples: mem.totals.samples,
    tablesLearned: Object.keys(mem.tables).length,
    shoesCompleted: mem.totals.shoesCompleted,
    tables,
  });
});

router.get("/predict/:table", (req, res) => {
  const tableName = req.params["table"]!;
  const { rows } = getCachedSource();
  const row = rows.find((r) => r.table_name === tableName);
  if (!row) {
    const state = tableState(tableName);
    if (!state) {
      res.status(404).json({ error: "table not found" });
      return;
    }
    const a = analyze(state.lastSeen);
    res.json({
      table: tableName,
      goodRoad: null,
      inShoeChange: state.inShoeChange,
      shoeNumber: state.shoeNumber,
      lastShoeChangeAt: state.lastShoeChangeAt,
      observations: state.observations,
      mainSequence: a.cleaned,
      bigRoad: a.bigRoad,
      columns: a.columns,
      subBoards: { eye: a.eye, small: a.small, cockroach: a.cockroach },
      prediction: state.inShoeChange
        ? {
            pick: null,
            confidence: 0,
            basis: "Bàn đang thay bộ bài",
            details: [],
            totalSamples: 0,
          }
        : predictNext(loadMemory(), {
            bigRoad: a.bigRoad,
            eye: a.eye,
            small: a.small,
            cockroach: a.cockroach,
          }),
      stale: true,
    });
    return;
  }
  res.json(buildTableEntry(row));
});

router.get("/tables", (_req, res) => {
  const { rows, fetchedAt } = getCachedSource();
  const mem = loadMemory();
  const list = rows.map((row) => {
    const state = mem.tables[row.table_name];
    const a = analyze(row.result || "");
    return {
      table: row.table_name,
      length: a.cleaned.length,
      bigRoadLength: a.bigRoad.length,
      inShoeChange: !a.cleaned || (state?.inShoeChange ?? false),
      shoeNumber: state?.shoeNumber ?? 1,
      observations: state?.observations ?? 0,
      lastShoeChangeAt: state?.lastShoeChangeAt ?? null,
      updatedAt: state?.updatedAt ?? null,
    };
  });
  res.json({
    fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
    count: list.length,
    tables: list,
  });
});

router.get("/sequences", (_req, res) => {
  const { rows, fetchedAt } = getCachedSource();
  const mem = loadMemory();
  const list = rows.map((row) => {
    const state = mem.tables[row.table_name];
    const cleaned = (row.result || "")
      .toUpperCase()
      .replace(/[^BPT]/g, "");
    return {
      table: row.table_name,
      mainSequence: cleaned,
      length: cleaned.length,
      inShoeChange: !cleaned || (state?.inShoeChange ?? false),
      shoeNumber: state?.shoeNumber ?? 1,
      lastShoeChangeAt: state?.lastShoeChangeAt ?? null,
      recentShoes: state?.recentShoes ?? [],
    };
  });
  res.json({
    fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
    note: "Chỉ lưu chuỗi gốc Big Road. Bảng phụ (mắt/tiểu/gián) suy ra từ chuỗi này.",
    count: list.length,
    tables: list,
  });
});

router.get("/sequence/:table", (req, res) => {
  const tableName = req.params["table"]!;
  const { rows } = getCachedSource();
  const row = rows.find((r) => r.table_name === tableName);
  const mem = loadMemory();
  const state = mem.tables[tableName];
  const live = (row?.result || "").toUpperCase().replace(/[^BPT]/g, "");
  const stored = state?.lastSeen ?? "";
  const mainSequence = live || stored;
  if (!state && !row) {
    res.status(404).json({ error: "table not found" });
    return;
  }
  const a = analyze(mainSequence);
  res.json({
    table: tableName,
    mainSequence,
    length: mainSequence.length,
    inShoeChange: !live || (state?.inShoeChange ?? false),
    shoeNumber: state?.shoeNumber ?? 1,
    lastShoeChangeAt: state?.lastShoeChangeAt ?? null,
    observations: state?.observations ?? 0,
    recentShoes: state?.recentShoes ?? [],
    derivedSubBoards: {
      eye: a.eye,
      small: a.small,
      cockroach: a.cockroach,
    },
    bigRoadColumns: a.columns,
  });
});

router.get("/analyze/:sequence", (req, res) => {
  const seq = req.params["sequence"] ?? "";
  const a = analyze(seq);
  const mem = loadMemory();
  const prediction = predictNext(mem, {
    bigRoad: a.bigRoad,
    eye: a.eye,
    small: a.small,
    cockroach: a.cockroach,
  });
  res.json({
    input: a.cleaned,
    bigRoad: a.bigRoad,
    columns: a.columns,
    subBoards: { eye: a.eye, small: a.small, cockroach: a.cockroach },
    prediction,
  });
});

router.get("/memory/stats", (_req, res) => {
  const mem = loadMemory();
  res.json({
    totalSamples: mem.totals.samples,
    tablesLearned: Object.keys(mem.tables).length,
    shoesCompleted: mem.totals.shoesCompleted,
    ngramKeys: {
      main: Object.keys(mem.ngrams.main).length,
      eye: Object.keys(mem.ngrams.eye).length,
      small: Object.keys(mem.ngrams.small).length,
      cockroach: Object.keys(mem.ngrams.cockroach).length,
    },
    tables: Object.fromEntries(
      Object.entries(mem.tables).map(([k, v]) => [
        k,
        {
          observations: v.observations,
          lastLength: v.lastSeen.length,
          shoeNumber: v.shoeNumber,
          inShoeChange: v.inShoeChange,
          lastShoeChangeAt: v.lastShoeChangeAt,
          updatedAt: v.updatedAt,
        },
      ]),
    ),
    storagePath: memoryDataPath(),
    updatedAt: mem.totals.updatedAt,
  });
});

router.get("/memory/seeds", (_req, res) => {
  const mem = loadMemory();
  const applied = new Set(mem.appliedSeeds);
  res.json({
    totalSeeds: SEED_SEQUENCES.length,
    appliedCount: SEED_SEQUENCES.filter((s) => applied.has(s.id)).length,
    pendingCount: SEED_SEQUENCES.filter((s) => !applied.has(s.id)).length,
    seeds: SEED_SEQUENCES.map((s) => ({
      id: s.id,
      table: s.table,
      length: s.sequence.length,
      sequence: s.sequence,
      source: s.source ?? null,
      applied: applied.has(s.id),
    })),
  });
});

router.get("/memory/seeds.txt", (_req, res) => {
  const lines = SEED_SEQUENCES.map(
    (s) => `${s.id} | ${s.table} (len=${s.sequence.length}): ${s.sequence}`,
  );
  res.type("text/plain").send(lines.join("\n"));
});

router.post("/memory/seed-now", (_req, res) => {
  const r = applySeeds();
  res.json({ ok: true, ...r, totalSeeds: SEED_SEQUENCES.length });
});

router.get("/memory/dump", (req, res) => {
  const mem = loadMemory();
  const board = req.query["board"] as string | undefined;
  const minTotal = Number(req.query["minTotal"] ?? "0");
  const limit = Number(req.query["limit"] ?? "0");

  function summarize(map: Record<string, Record<string, number>>) {
    const rows: Array<{
      tail: string;
      k: number;
      total: number;
      counts: Record<string, number>;
      bestPick: string;
      bestRatio: number;
    }> = [];
    for (const [tail, counts] of Object.entries(map)) {
      let total = 0;
      let best = "";
      let bestCount = -1;
      for (const [k, v] of Object.entries(counts)) {
        total += v;
        if (v > bestCount) {
          bestCount = v;
          best = k;
        }
      }
      if (total < minTotal) continue;
      rows.push({
        tail,
        k: tail.length,
        total,
        counts,
        bestPick: best,
        bestRatio: total > 0 ? Math.round((bestCount / total) * 1000) / 1000 : 0,
      });
    }
    rows.sort((a, b) => b.total - a.total || a.tail.localeCompare(b.tail));
    return limit > 0 ? rows.slice(0, limit) : rows;
  }

  const boards: Array<"main" | "eye" | "small" | "cockroach"> = board
    ? [board as "main" | "eye" | "small" | "cockroach"]
    : ["main", "eye", "small", "cockroach"];

  const ngrams: Record<string, ReturnType<typeof summarize>> = {};
  for (const b of boards) {
    if (mem.ngrams[b]) ngrams[b] = summarize(mem.ngrams[b]);
  }

  res.json({
    storagePath: memoryDataPath(),
    totalSamples: mem.totals.samples,
    shoesCompleted: mem.totals.shoesCompleted,
    tablesLearned: Object.keys(mem.tables).length,
    updatedAt: mem.totals.updatedAt,
    tables: mem.tables,
    ngramKeyCounts: {
      main: Object.keys(mem.ngrams.main).length,
      eye: Object.keys(mem.ngrams.eye).length,
      small: Object.keys(mem.ngrams.small).length,
      cockroach: Object.keys(mem.ngrams.cockroach).length,
    },
    ngrams,
    note: "Mỗi 'tail' là pattern đã thấy, 'counts' là số lần dẫn tới B/P/T tương ứng. bestPick = nước tiếp theo dự đoán cho pattern đó.",
  });
});

router.get("/memory/raw", (_req, res) => {
  const mem = loadMemory();
  res.json(mem);
});

router.get("/export", (req, res) => {
  const mem = loadMemory();
  const includeShoes = req.query["shoes"] !== "false";
  const live = req.query["live"] === "true";
  const liveTables = new Set<string>();
  if (live) {
    for (const r of getCachedSource().rows) liveTables.add(r.table_name);
  }

  const entries: Array<{ table: string; sequence: string; mode: "replace" }> = [];
  for (const [name, t] of Object.entries(mem.tables)) {
    if (live && !liveTables.has(name)) continue;
    if (t.lastSeen.length > 0) {
      entries.push({ table: name, sequence: t.lastSeen, mode: "replace" });
    }
    if (includeShoes && t.recentShoes.length > 0) {
      t.recentShoes.forEach((seq, i) => {
        if (seq.length > 0) {
          entries.push({
            table: `${name}-prev${i + 1}`,
            sequence: seq,
            mode: "replace",
          });
        }
      });
    }
  }

  res.json({
    exportedAt: new Date().toISOString(),
    totalSamples: mem.totals.samples,
    shoesCompleted: mem.totals.shoesCompleted,
    tablesExported: entries.length,
    note: "POST mảng `entries` này vào /api/learn để nạp lại toàn bộ chuỗi (kể cả khi thay GitHub/Railway).",
    entries,
  });
});

router.get("/export.txt", (req, res) => {
  const mem = loadMemory();
  const includeShoes = req.query["shoes"] !== "false";
  const lines: string[] = [];
  for (const [name, t] of Object.entries(mem.tables)) {
    if (t.lastSeen.length > 0) lines.push(`${name}: ${t.lastSeen}`);
    if (includeShoes) {
      t.recentShoes.forEach((seq, i) => {
        if (seq.length > 0) lines.push(`${name}-prev${i + 1}: ${seq}`);
      });
    }
  }
  res.type("text/plain").send(lines.join("\n"));
});

router.get("/stats/accuracy", (req, res) => {
  const mem = loadMemory();
  const a = mem.accuracy;
  const recentLimit = Math.min(Number(req.query["recent"] ?? "50") || 50, 500);
  const overall =
    a.totalPredictions > 0
      ? Math.round((a.correctPredictions / a.totalPredictions) * 1000) / 1000
      : 0;
  function ratio(p: number, c: number) {
    return p > 0 ? Math.round((c / p) * 1000) / 1000 : 0;
  }
  const includeRecent = req.query["tableRecent"] !== "0";
  const tableRecentLimit = Math.min(Number(req.query["tableRecent"] ?? "100") || 100, 200);
  const byTable = Object.fromEntries(
    Object.entries(a.byTable)
      .map(([k, v]) => [
        k,
        {
          predictions: v.predictions,
          correct: v.correct,
          accuracy: ratio(v.predictions, v.correct),
          currentStreak: v.currentStreak,
          bestStreak: v.bestStreak,
          lastAt: v.lastAt,
          ...(includeRecent ? { recent: (v.recent ?? []).slice(0, tableRecentLimit) } : {}),
        },
      ])
      .sort(([, a1], [, b1]) => (b1 as { predictions: number }).predictions - (a1 as { predictions: number }).predictions),
  );
  const byK = Object.fromEntries(
    Object.entries(a.byK)
      .map(([k, v]) => [k, { ...v, accuracy: ratio(v.predictions, v.correct) }])
      .sort(([k1], [k2]) => Number(k1) - Number(k2)),
  );
  const byBoard = Object.fromEntries(
    Object.entries(a.byBoard).map(([k, v]) => [
      k,
      { ...v, accuracy: ratio(v.predictions, v.correct) },
    ]),
  );
  const buckets = ["<0.5", "0.5-0.6", "0.6-0.7", "0.7-0.8", "0.8-0.9", "0.9+"];
  const byBucket = Object.fromEntries(
    buckets.map((b) => {
      const v = a.byBucket[b] ?? { predictions: 0, correct: 0 };
      return [b, { ...v, accuracy: ratio(v.predictions, v.correct) }];
    }),
  );
  const recent = a.recent.slice(0, recentLimit);
  const last20 = a.recent.slice(0, 20);
  const last20Correct = last20.filter((r) => r.correct).length;
  res.json({
    overall: {
      totalPredictions: a.totalPredictions,
      correctPredictions: a.correctPredictions,
      accuracy: overall,
      last20: {
        total: last20.length,
        correct: last20Correct,
        accuracy: last20.length > 0 ? Math.round((last20Correct / last20.length) * 1000) / 1000 : 0,
      },
    },
    byTable,
    byK,
    byBoard,
    byBucket,
    recent,
    note: "Chỉ tính ván live (không tính seed). k=số ký tự pattern. Bucket = mức confidence khi đoán.",
  });
});

router.post("/stats/backfill", (req, res) => {
  const force = req.query["force"] === "1" || req.query["force"] === "true";
  const r = backfillAccuracy({ onlyEmpty: !force });
  res.json({ ok: true, ...r });
});

router.post("/stats/reset", (_req, res) => {
  const mem = loadMemory();
  mem.accuracy = {
    totalPredictions: 0,
    correctPredictions: 0,
    byTable: {},
    byK: {},
    byBoard: {
      main: { predictions: 0, correct: 0 },
      eye: { predictions: 0, correct: 0 },
      small: { predictions: 0, correct: 0 },
      cockroach: { predictions: 0, correct: 0 },
    },
    byBucket: {},
    recent: [],
  };
  saveMemorySync();
  res.json({ ok: true, message: "accuracy stats reset" });
});

router.post("/learn", (req, res) => {
  const body = (req.body ?? {}) as {
    table?: string;
    sequence?: string;
    mode?: "append" | "replace";
    entries?: Array<{ table?: string; sequence?: string; mode?: "append" | "replace" }>;
  };
  const items = body.entries && Array.isArray(body.entries)
    ? body.entries
    : [{ table: body.table, sequence: body.sequence, mode: body.mode }];

  const results: Array<{
    table: string;
    learned: number;
    sequenceLength: number;
    mode: "append" | "replace";
    error?: string;
  }> = [];

  let totalLearned = 0;
  for (const item of items) {
    const tableName = (item.table ?? "manual").toString().trim() || "manual";
    const seq = (item.sequence ?? "").toString();
    const mode: "append" | "replace" = item.mode === "replace" ? "replace" : "append";
    const cleaned = seq.toUpperCase().replace(/[^BPT]/g, "");
    if (!cleaned) {
      results.push({
        table: tableName,
        learned: 0,
        sequenceLength: 0,
        mode,
        error: "sequence rỗng hoặc không có B/P/T",
      });
      continue;
    }
    if (mode === "replace") {
      const t = ensureTable(tableName);
      if (t.lastSeen.length > 0) {
        t.recentShoes.unshift(t.lastSeen);
        if (t.recentShoes.length > 10) t.recentShoes.length = 10;
        t.shoeNumber += 1;
      }
      t.lastSeen = "";
      t.inShoeChange = false;
      t.lastShoeChangeAt = new Date().toISOString();
      scheduleSave();
    }
    const learned = learnFromSequence(tableName, cleaned);
    totalLearned += learned;
    results.push({
      table: tableName,
      learned,
      sequenceLength: cleaned.length,
      mode,
    });
  }

  saveMemorySync();
  const mem = loadMemory();
  res.json({
    ok: true,
    totalLearned,
    totalSamples: mem.totals.samples,
    items: results,
  });
});

router.post("/poll", async (_req, res) => {
  await pollOnce();
  saveMemorySync();
  const { fetchedAt, error } = getCachedSource();
  res.json({
    ok: true,
    fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
    sourceError: error,
  });
});

export default router;
