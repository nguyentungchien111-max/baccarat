import { analyze } from "./derive";
import { loadMemory, recordAccuracy, scheduleSave } from "./memory";
import { predictNext } from "./predict";
import { logger } from "./logger";

export type BackfillReport = {
  tablesProcessed: number;
  predictionsAdded: number;
  perTable: Record<string, number>;
};

export function backfillAccuracy(opts?: { onlyEmpty?: boolean }): BackfillReport {
  const onlyEmpty = opts?.onlyEmpty ?? false;
  const mem = loadMemory();
  const report: BackfillReport = {
    tablesProcessed: 0,
    predictionsAdded: 0,
    perTable: {},
  };

  for (const [name, t] of Object.entries(mem.tables)) {
    if (!t.lastSeen || t.lastSeen.length < 3) continue;
    const existing = mem.accuracy.byTable[name];
    if (onlyEmpty && existing && existing.predictions > 0) continue;

    if (existing) {
      existing.predictions = 0;
      existing.correct = 0;
      existing.currentStreak = 0;
      existing.bestStreak = 0;
      existing.recent = [];
    }

    let added = 0;
    const cleaned = t.lastSeen.toUpperCase().replace(/[^BPT]/g, "");
    for (let i = 2; i < cleaned.length; i++) {
      const next = cleaned[i]!;
      if (next !== "B" && next !== "P") continue;
      const prefix = cleaned.slice(0, i);
      const a = analyze(prefix);
      if (a.bigRoad.length < 2) continue;
      const pred = predictNext(mem, {
        bigRoad: a.bigRoad,
        eye: a.eye,
        small: a.small,
        cockroach: a.cockroach,
      });
      if (pred.pick === "B" || pred.pick === "P") {
        const top = pred.details[0];
        recordAccuracy(
          name,
          pred.pick,
          next as "B" | "P",
          top?.k ?? 0,
          top?.board ?? "main",
          pred.confidence,
        );
        added += 1;
      }
    }
    report.tablesProcessed += 1;
    report.predictionsAdded += added;
    report.perTable[name] = added;
  }

  if (report.predictionsAdded > 0) {
    mem.accuracy.totalPredictions = 0;
    mem.accuracy.correctPredictions = 0;
    mem.accuracy.byK = {};
    mem.accuracy.byBoard = {
      main: { predictions: 0, correct: 0 },
      eye: { predictions: 0, correct: 0 },
      small: { predictions: 0, correct: 0 },
      cockroach: { predictions: 0, correct: 0 },
    };
    mem.accuracy.byBucket = {};
    mem.accuracy.recent = [];
    for (const [name, tbl] of Object.entries(mem.accuracy.byTable)) {
      mem.accuracy.totalPredictions += tbl.predictions;
      mem.accuracy.correctPredictions += tbl.correct;
      for (const r of tbl.recent) {
        const kKey = String(r.k);
        const ke = mem.accuracy.byK[kKey] ?? { predictions: 0, correct: 0 };
        ke.predictions += 1;
        if (r.correct) ke.correct += 1;
        mem.accuracy.byK[kKey] = ke;
        const be = mem.accuracy.byBoard[r.board];
        be.predictions += 1;
        if (r.correct) be.correct += 1;
        const buc = bucketOf(r.conf);
        const bue = mem.accuracy.byBucket[buc] ?? { predictions: 0, correct: 0 };
        bue.predictions += 1;
        if (r.correct) bue.correct += 1;
        mem.accuracy.byBucket[buc] = bue;
        mem.accuracy.recent.push(r);
      }
      void name;
    }
    mem.accuracy.recent.sort((a, b) => (a.at < b.at ? 1 : -1));
    if (mem.accuracy.recent.length > 500) mem.accuracy.recent.length = 500;
    scheduleSave();
    logger.info({ ...report }, "backfill complete");
  }
  return report;
}

function bucketOf(conf: number): string {
  if (conf < 0.5) return "<0.5";
  if (conf < 0.6) return "0.5-0.6";
  if (conf < 0.7) return "0.6-0.7";
  if (conf < 0.8) return "0.7-0.8";
  if (conf < 0.9) return "0.8-0.9";
  return "0.9+";
}
