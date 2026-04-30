import { Router, type IRouter } from "express";
import { analyze } from "../lib/derive";
import { loadMemory, memoryDataPath, saveMemorySync } from "../lib/memory";
import { predictNext } from "../lib/predict";
import { getCachedSource, pollOnce } from "../lib/source";

const router: IRouter = Router();

function buildTableEntry(row: { table_name: string; result: string; goodRoad?: string | null }) {
  const a = analyze(row.result || "");
  const mem = loadMemory();
  const prediction = predictNext(mem, {
    bigRoad: a.bigRoad,
    eye: a.eye,
    small: a.small,
    cockroach: a.cockroach,
  });
  return {
    table: row.table_name,
    goodRoad: row.goodRoad ?? null,
    mainSequence: a.cleaned,
    bigRoad: a.bigRoad,
    columns: a.columns,
    subBoards: {
      eye: a.eye,
      small: a.small,
      cockroach: a.cockroach,
    },
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
    tables,
  });
});

router.get("/predict/:table", (req, res) => {
  const { rows } = getCachedSource();
  const row = rows.find((r) => r.table_name === req.params["table"]);
  if (!row) {
    res.status(404).json({ error: "table not found" });
    return;
  }
  res.json(buildTableEntry(row));
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
    subBoards: {
      eye: a.eye,
      small: a.small,
      cockroach: a.cockroach,
    },
    prediction,
  });
});

router.get("/memory/stats", (_req, res) => {
  const mem = loadMemory();
  res.json({
    totalSamples: mem.totals.samples,
    tablesLearned: Object.keys(mem.tables).length,
    ngramKeys: {
      main: Object.keys(mem.ngrams.main).length,
      eye: Object.keys(mem.ngrams.eye).length,
      small: Object.keys(mem.ngrams.small).length,
      cockroach: Object.keys(mem.ngrams.cockroach).length,
    },
    tables: Object.fromEntries(
      Object.entries(mem.tables).map(([k, v]) => [
        k,
        { observations: v.observations, lastLength: v.lastSeen.length, updatedAt: v.updatedAt },
      ]),
    ),
    storagePath: memoryDataPath(),
    updatedAt: mem.totals.updatedAt,
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
