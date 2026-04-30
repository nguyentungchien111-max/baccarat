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
