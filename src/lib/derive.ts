export type Cell = { c: number; r: number; v: "B" | "P" };

export function buildBigRoad(main: string): {
  cells: Cell[];
  colLen: Record<number, number>;
} {
  const cells: Cell[] = [];
  let curCol = 0;
  let curRow = 0;
  let last: "B" | "P" | null = null;
  for (const ch of main) {
    if (ch !== "B" && ch !== "P") continue;
    if (ch !== last) {
      curCol++;
      curRow = 1;
    } else {
      curRow++;
    }
    cells.push({ c: curCol, r: curRow, v: ch });
    last = ch;
  }
  const colLen: Record<number, number> = {};
  for (const cell of cells) {
    colLen[cell.c] = Math.max(colLen[cell.c] ?? 0, cell.r);
  }
  return { cells, colLen };
}

export function deriveSubRoad(
  cells: Cell[],
  colLen: Record<number, number>,
  k: number,
): string {
  let out = "";
  for (const { c, r } of cells) {
    if (c < k + 1) continue;
    if (c === k + 1 && r === 1) continue;
    let mark: "b" | "p";
    if (r === 1) {
      const a = colLen[c - 1] ?? 0;
      const b = colLen[c - 1 - k] ?? 0;
      mark = a === b ? "b" : "p";
    } else {
      const L = colLen[c - k] ?? 0;
      if (L >= r) mark = "b";
      else if (L === r - 1) mark = "p";
      else mark = "b";
    }
    out += mark;
  }
  return out;
}

export type Analysis = {
  rawInput: string;
  cleaned: string;
  bigRoad: string;
  columns: number[];
  eye: string;
  small: string;
  cockroach: string;
  cells: Cell[];
  colLen: Record<number, number>;
};

export function analyze(main: string): Analysis {
  const cleaned = (main || "").toUpperCase().replace(/[^BPT]/g, "");
  const { cells, colLen } = buildBigRoad(cleaned);
  const bigRoad = cells.map((c) => c.v).join("");
  const columns = Object.keys(colLen)
    .map((k) => Number(k))
    .sort((a, b) => a - b)
    .map((k) => colLen[k] ?? 0);
  return {
    rawInput: main,
    cleaned,
    bigRoad,
    columns,
    eye: deriveSubRoad(cells, colLen, 1),
    small: deriveSubRoad(cells, colLen, 2),
    cockroach: deriveSubRoad(cells, colLen, 3),
    cells,
    colLen,
  };
}
