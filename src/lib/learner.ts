import { analyze } from "./derive";
import {
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

  const prev = mem.tables[tableName]?.lastSeen ?? "";
  let startIdx = 0;
  if (prev && cleaned.startsWith(prev)) {
    startIdx = prev.length;
  } else {
    startIdx = 0;
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

  const cur = mem.tables[tableName] ?? {
    lastSeen: "",
    updatedAt: "",
    observations: 0,
  };
  mem.tables[tableName] = {
    lastSeen: cleaned,
    updatedAt: new Date().toISOString(),
    observations: cur.observations + learned,
  };
  mem.totals.updatedAt = new Date().toISOString();
  if (learned > 0) scheduleSave();
  return learned;
}
