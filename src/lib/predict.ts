import type { Memory, NgramMap } from "./memory";

const KS = [8, 7, 6, 5, 4, 3, 2];
const SUB_KS = [6, 5, 4, 3, 2];

type Pick = "B" | "P";

type Lookup = {
  pick: string;
  count: number;
  total: number;
  k: number;
  tail: string;
};

function lookup(map: NgramMap, tail: string, k: number): Lookup | null {
  const bucket = map[tail];
  if (!bucket) return null;
  let bestKey = "";
  let bestCount = -1;
  let total = 0;
  for (const [key, count] of Object.entries(bucket)) {
    total += count;
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  if (total < 2) return null;
  return { pick: bestKey, count: bestCount, total, k, tail };
}

export type Prediction = {
  pick: Pick | null;
  confidence: number;
  basis: string;
  details: Array<{
    board: "main" | "eye" | "small" | "cockroach";
    tail: string;
    k: number;
    pick: string;
    count: number;
    total: number;
    voteFor: Pick | null;
  }>;
  totalSamples: number;
};

export function predictNext(
  mem: Memory,
  boards: { bigRoad: string; eye: string; small: string; cockroach: string },
): Prediction {
  const details: Prediction["details"] = [];
  const lastMain = boards.bigRoad[boards.bigRoad.length - 1] as
    | Pick
    | undefined;

  for (const k of KS) {
    if (boards.bigRoad.length < k) continue;
    const tail = boards.bigRoad.slice(-k);
    const r = lookup(mem.ngrams.main, tail, k);
    if (r && r.total >= 3) {
      details.push({
        board: "main",
        tail: r.tail,
        k: r.k,
        pick: r.pick,
        count: r.count,
        total: r.total,
        voteFor: (r.pick === "B" || r.pick === "P" ? r.pick : null) as
          | Pick
          | null,
      });
      const conf = r.count / r.total;
      if (r.pick === "B" || r.pick === "P") {
        return {
          pick: r.pick,
          confidence: Math.round(conf * 1000) / 1000,
          basis: `Bảng cái: tail "${tail}" (k=${k}) đã từng dẫn tới ${r.pick} ${r.count}/${r.total} lần`,
          details,
          totalSamples: r.total,
        };
      }
    }
  }

  const votes: Record<Pick, number> = { B: 0, P: 0 };
  let usedSamples = 0;

  if (lastMain === "B" || lastMain === "P") {
    const opposite: Pick = lastMain === "B" ? "P" : "B";
    for (const board of ["eye", "small", "cockroach"] as const) {
      const seq = boards[board];
      for (const k of SUB_KS) {
        if (seq.length < k) continue;
        const tail = seq.slice(-k);
        const r = lookup(mem.ngrams[board], tail, k);
        if (r && r.total >= 3) {
          const target: Pick = r.pick === "b" ? lastMain : opposite;
          const w = r.count / r.total;
          votes[target] += w;
          usedSamples += r.total;
          details.push({
            board,
            tail: r.tail,
            k: r.k,
            pick: r.pick,
            count: r.count,
            total: r.total,
            voteFor: target,
          });
          break;
        }
      }
    }
  }

  const sum = votes.B + votes.P;
  if (sum === 0) {
    return {
      pick: null,
      confidence: 0,
      basis: "Chưa đủ mẫu giống trong bộ nhớ để đưa ra dự đoán",
      details,
      totalSamples: 0,
    };
  }
  const pick: Pick = votes.B >= votes.P ? "B" : "P";
  return {
    pick,
    confidence: Math.round((votes[pick] / sum) * 1000) / 1000,
    basis: `Tổng hợp 3 bảng phụ: B=${votes.B.toFixed(2)} vs P=${votes.P.toFixed(2)}`,
    details,
    totalSamples: usedSamples,
  };
}
