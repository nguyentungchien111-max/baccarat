import type { Memory, NgramMap } from "./memory";

const KS = [10, 9, 8, 7, 6, 5, 4, 3];
const SUB_KS = [8, 7, 6, 5, 4, 3];

// Tham số đã tinh chỉnh qua backtest 1,235 ván (sweep 48 cấu hình)
// Best: c=0.55 m=0.55 prior=1.5 → 53.3% (vs baseline always-B = 53.0%)
const MIN_TOTAL_MAIN = 5;
const MIN_TOTAL_SUB = 4;
const MIN_CONF = 0.55;
const MIN_ENSEMBLE_MARGIN = 0.55;
const SUB_BOARD_WEIGHT = 0.6;
// Banker bias prior: phản ánh ưu thế tự nhiên ~50.7-51% của nhà cái
const BANKER_PRIOR = 1.5;

type Pick = "B" | "P";
type BoardName = "main" | "eye" | "small" | "cockroach";

type Lookup = {
  pick: string;
  count: number;
  total: number;
  k: number;
  tail: string;
  conf: number;
};

function lookup(
  map: NgramMap,
  tail: string,
  k: number,
  minTotal: number,
): Lookup | null {
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
  if (total < minTotal) return null;
  if (bestCount <= 0) return null;
  return { pick: bestKey, count: bestCount, total, k, tail, conf: bestCount / total };
}

export type PredictionDetail = {
  board: BoardName;
  tail: string;
  k: number;
  pick: string;
  count: number;
  total: number;
  conf: number;
  voteFor: Pick | null;
  weight: number;
};

export type Prediction = {
  pick: Pick | null;
  confidence: number;
  basis: string;
  details: PredictionDetail[];
  totalSamples: number;
  topBoard: BoardName;
  topK: number;
  abstained: boolean;
  votes: { B: number; P: number };
};

function emptyResult(reason: string, details: PredictionDetail[] = []): Prediction {
  return {
    pick: null,
    confidence: 0,
    basis: reason,
    details,
    totalSamples: 0,
    topBoard: "main",
    topK: 0,
    abstained: true,
    votes: { B: 0, P: 0 },
  };
}

export function predictNext(
  mem: Memory,
  boards: { bigRoad: string; eye: string; small: string; cockroach: string },
): Prediction {
  const details: PredictionDetail[] = [];
  const lastMain = boards.bigRoad[boards.bigRoad.length - 1];
  if (lastMain !== "B" && lastMain !== "P") {
    return emptyResult("Bảng cái rỗng, không có ván trước");
  }
  const opposite: Pick = lastMain === "B" ? "P" : "B";

  // Khởi tạo votes với Banker prior (ưu thế nhà cái tự nhiên)
  const votes: Record<Pick, number> = { B: BANKER_PRIOR, P: 0 };
  let totalSamples = 0;

  // 1) Bảng cái — chọn match dài nhất, vote nếu confidence đủ
  let mainHit: PredictionDetail | null = null;
  for (const k of KS) {
    if (boards.bigRoad.length < k) continue;
    const tail = boards.bigRoad.slice(-k);
    const r = lookup(mem.ngrams.main, tail, k, MIN_TOTAL_MAIN);
    if (!r) continue;
    if (r.pick !== "B" && r.pick !== "P") continue;
    const weight = r.conf >= MIN_CONF ? k * (r.conf - 0.5) : 0;
    const detail: PredictionDetail = {
      board: "main",
      tail,
      k,
      pick: r.pick,
      count: r.count,
      total: r.total,
      conf: Math.round(r.conf * 1000) / 1000,
      voteFor: weight > 0 ? (r.pick as Pick) : null,
      weight: Math.round(weight * 1000) / 1000,
    };
    details.push(detail);
    if (weight > 0) {
      votes[r.pick as Pick] += weight;
      totalSamples += r.total;
      mainHit = detail;
    }
    break;
  }

  // 2) Mỗi bảng phụ (mắt/tiểu/gián) — chọn match dài nhất, weight thấp hơn main
  for (const board of ["eye", "small", "cockroach"] as const) {
    const seq = boards[board];
    for (const k of SUB_KS) {
      if (seq.length < k) continue;
      const tail = seq.slice(-k);
      const r = lookup(mem.ngrams[board], tail, k, MIN_TOTAL_SUB);
      if (!r) continue;
      if (r.pick !== "b" && r.pick !== "p") continue;
      const target: Pick = r.pick === "b" ? lastMain : opposite;
      const weight =
        r.conf >= MIN_CONF ? k * (r.conf - 0.5) * SUB_BOARD_WEIGHT : 0;
      const detail: PredictionDetail = {
        board,
        tail,
        k,
        pick: r.pick,
        count: r.count,
        total: r.total,
        conf: Math.round(r.conf * 1000) / 1000,
        voteFor: weight > 0 ? target : null,
        weight: Math.round(weight * 1000) / 1000,
      };
      details.push(detail);
      if (weight > 0) {
        votes[target] += weight;
        totalSamples += r.total;
      }
      break;
    }
  }

  const sum = votes.B + votes.P;
  if (sum === 0) {
    return {
      pick: null,
      confidence: 0,
      basis: `Không bảng nào đủ tin (cần conf ≥ ${MIN_CONF}, mẫu ≥ ${MIN_TOTAL_MAIN})`,
      details,
      totalSamples: 0,
      topBoard: "main",
      topK: 0,
      abstained: true,
      votes: {
        B: Math.round(votes.B * 1000) / 1000,
        P: Math.round(votes.P * 1000) / 1000,
      },
    };
  }

  const pick: Pick = votes.B >= votes.P ? "B" : "P";
  const margin = votes[pick] / sum;

  // Đếm số bảng đồng thuận với pick
  const agreeing = details.filter((d) => d.voteFor === pick);
  const top =
    agreeing.sort((a, b) => b.weight - a.weight)[0] ??
    mainHit ??
    details[0];

  if (margin < MIN_ENSEMBLE_MARGIN) {
    return {
      pick: null,
      confidence: Math.round(margin * 1000) / 1000,
      basis: `Các bảng không đồng thuận đủ rõ (margin ${(margin * 100).toFixed(0)}% < ${(MIN_ENSEMBLE_MARGIN * 100).toFixed(0)}%) — bỏ qua ván này`,
      details,
      totalSamples,
      topBoard: top?.board ?? "main",
      topK: top?.k ?? 0,
      abstained: true,
      votes: {
        B: Math.round(votes.B * 1000) / 1000,
        P: Math.round(votes.P * 1000) / 1000,
      },
    };
  }

  return {
    pick,
    confidence: Math.round(margin * 1000) / 1000,
    basis: `Ensemble ${agreeing.length} bảng đồng thuận → ${pick} (B=${votes.B.toFixed(2)} vs P=${votes.P.toFixed(2)})`,
    details,
    totalSamples,
    topBoard: top?.board ?? "main",
    topK: top?.k ?? 0,
    abstained: false,
    votes: {
      B: Math.round(votes.B * 1000) / 1000,
      P: Math.round(votes.P * 1000) / 1000,
    },
  };
}
