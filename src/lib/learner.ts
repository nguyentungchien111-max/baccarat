import { analyze } from "./derive";
import {
  ensureTable,
  loadMemory,
  recordNgram,
  scheduleSave,
  type Memory,
} from "./memory";

const KS = [8, 7, 6, 5, 4, 3, 2];
const SUB_KS = [6, 5, 4, 3, 2];

type BoardName = "main" | "eye" | "small" | "cockroach";

function recordAllK(
  mem: Memory,
  board: BoardName,
  prevSeq: string,
  next: string,
  ks: number[],
): void {
  for (const k of ks) {
    if (prevSeq.length >= k) {
      recordNgram(mem.ngrams[board], prevSeq.slice(-k), next);
    }
  }
}

export function learnFromSequence(tableName: string, rawSeq: string): number {
  const mem = loadMemory();
  const cleaned = (rawSeq || "").toUpperCase().replace(/[^BPT]/g, "");
  if (!cleaned) return 0;

  const t = ensureTable(tableName);
  const prev = t.lastSeen;
  const wasShoeChange = t.inShoeChange;

  let startIdx = 0;
  let resetShoe = false;
  if (prev && cleaned.startsWith(prev)) {
    startIdx = prev.length;
  } else if (prev && !cleaned.startsWith(prev)) {
    resetShoe = true;
    startIdx = 0;
  } else {
    startIdx = 0;
  }

  if (resetShoe) {
    t.recentShoes.unshift(prev);
    if (t.recentShoes.length > 10) t.recentShoes.length = 10;
    mem.totals.shoesCompleted += 1;
    t.shoeNumber += 1;
    t.lastShoeChangeAt = new Date().toISOString();
  } else if (wasShoeChange) {
    t.shoeNumber += 1;
  }

  let learned = 0;

  for (let i = startIdx; i < cleaned.length; i++) {
    const next = cleaned[i]!;
    if (next !== "B" && next !== "P") continue;

    const before = cleaned.slice(0, i);
    const after = cleaned.slice(0, i + 1);
    const aBefore = analyze(before);
    const aAfter = analyze(after);

    recordAllK(mem, "main", aBefore.bigRoad, next, KS);

    for (const board of ["eye", "small", "cockroach"] as const) {
      const oldSeq = aBefore[board];
      const newSeq = aAfter[board];
      if (newSeq.length > oldSeq.length) {
        const newMark = newSeq[newSeq.length - 1]!;
        recordAllK(mem, board, oldSeq, newMark, SUB_KS);
      }
    }

    mem.totals.samples += 1;
    learned += 1;
  }

  t.lastSeen = cleaned;
  t.updatedAt = new Date().toISOString();
  t.observations += learned;
  t.inShoeChange = false;
  mem.totals.updatedAt = t.updatedAt;
  if (learned > 0 || wasShoeChange || resetShoe) scheduleSave();
  return learned;
}
