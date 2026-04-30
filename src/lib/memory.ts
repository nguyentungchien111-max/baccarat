import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

export type NgramMap = Record<string, Record<string, number>>;

export type TableState = {
  lastSeen: string;
  updatedAt: string;
  observations: number;
  shoeNumber: number;
  inShoeChange: boolean;
  lastShoeChangeAt: string | null;
  recentShoes: string[];
};

export type Memory = {
  version: 2;
  ngrams: {
    main: NgramMap;
    eye: NgramMap;
    small: NgramMap;
    cockroach: NgramMap;
  };
  tables: Record<string, TableState>;
  totals: { samples: number; updatedAt: string; shoesCompleted: number };
  appliedSeeds: string[];
  accuracy: AccuracyMemory;
};

export type AccuracyRecent = {
  table: string;
  predicted: "B" | "P";
  actual: "B" | "P";
  correct: boolean;
  k: number;
  board: "main" | "eye" | "small" | "cockroach";
  conf: number;
  at: string;
};

export type AccuracyMemory = {
  totalPredictions: number;
  correctPredictions: number;
  byTable: Record<
    string,
    {
      predictions: number;
      correct: number;
      currentStreak: number;
      bestStreak: number;
      lastAt: string;
      recent: AccuracyRecent[];
    }
  >;
  byK: Record<string, { predictions: number; correct: number }>;
  byBoard: Record<
    "main" | "eye" | "small" | "cockroach",
    { predictions: number; correct: number }
  >;
  byBucket: Record<string, { predictions: number; correct: number }>;
  recent: AccuracyRecent[];
};

const DATA_DIR =
  process.env["DATA_DIR"] || path.resolve(process.cwd(), "data");
const MEM_PATH = path.join(DATA_DIR, "baccarat-memory.json");

const RECENT_SHOES_KEEP = 10;

let mem: Memory | null = null;

function emptyAccuracy(): AccuracyMemory {
  return {
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
}

function emptyMemory(): Memory {
  return {
    version: 2,
    ngrams: { main: {}, eye: {}, small: {}, cockroach: {} },
    tables: {},
    totals: {
      samples: 0,
      updatedAt: new Date().toISOString(),
      shoesCompleted: 0,
    },
    appliedSeeds: [],
    accuracy: emptyAccuracy(),
  };
}

function migrate(raw: unknown): Memory {
  const fresh = emptyMemory();
  if (!raw || typeof raw !== "object") return fresh;
  const r = raw as Partial<Memory> & {
    tables?: Record<string, Partial<TableState>>;
    totals?: Partial<Memory["totals"]>;
  };
  fresh.ngrams = {
    main: r.ngrams?.main ?? {},
    eye: r.ngrams?.eye ?? {},
    small: r.ngrams?.small ?? {},
    cockroach: r.ngrams?.cockroach ?? {},
  };
  if (r.tables) {
    for (const [name, t] of Object.entries(r.tables)) {
      fresh.tables[name] = {
        lastSeen: t?.lastSeen ?? "",
        updatedAt: t?.updatedAt ?? new Date().toISOString(),
        observations: t?.observations ?? 0,
        shoeNumber: t?.shoeNumber ?? 1,
        inShoeChange: t?.inShoeChange ?? false,
        lastShoeChangeAt: t?.lastShoeChangeAt ?? null,
        recentShoes: Array.isArray(t?.recentShoes) ? t!.recentShoes! : [],
      };
    }
  }
  fresh.totals = {
    samples: r.totals?.samples ?? 0,
    updatedAt: r.totals?.updatedAt ?? new Date().toISOString(),
    shoesCompleted: r.totals?.shoesCompleted ?? 0,
  };
  fresh.appliedSeeds = Array.isArray((r as { appliedSeeds?: unknown }).appliedSeeds)
    ? ((r as { appliedSeeds: string[] }).appliedSeeds)
    : [];
  const acc = (r as { accuracy?: Partial<AccuracyMemory> }).accuracy;
  if (acc && typeof acc === "object") {
    const fixedByTable: AccuracyMemory["byTable"] = {};
    for (const [k, v] of Object.entries(acc.byTable ?? {})) {
      const vv = v as Partial<AccuracyMemory["byTable"][string]>;
      fixedByTable[k] = {
        predictions: vv.predictions ?? 0,
        correct: vv.correct ?? 0,
        currentStreak: vv.currentStreak ?? 0,
        bestStreak: vv.bestStreak ?? 0,
        lastAt: vv.lastAt ?? new Date(0).toISOString(),
        recent: Array.isArray(vv.recent) ? vv.recent : [],
      };
    }
    fresh.accuracy = {
      totalPredictions: acc.totalPredictions ?? 0,
      correctPredictions: acc.correctPredictions ?? 0,
      byTable: fixedByTable,
      byK: acc.byK ?? {},
      byBoard: {
        main: acc.byBoard?.main ?? { predictions: 0, correct: 0 },
        eye: acc.byBoard?.eye ?? { predictions: 0, correct: 0 },
        small: acc.byBoard?.small ?? { predictions: 0, correct: 0 },
        cockroach: acc.byBoard?.cockroach ?? { predictions: 0, correct: 0 },
      },
      byBucket: acc.byBucket ?? {},
      recent: Array.isArray(acc.recent) ? acc.recent : [],
    };
  }
  return fresh;
}

const RECENT_PREDICTIONS_KEEP = 500;
const RECENT_PER_TABLE_KEEP = 200;

function bucketOf(conf: number): string {
  if (conf < 0.5) return "<0.5";
  if (conf < 0.6) return "0.5-0.6";
  if (conf < 0.7) return "0.6-0.7";
  if (conf < 0.8) return "0.7-0.8";
  if (conf < 0.9) return "0.8-0.9";
  return "0.9+";
}

export function recordAccuracy(
  table: string,
  predicted: "B" | "P",
  actual: "B" | "P",
  k: number,
  board: "main" | "eye" | "small" | "cockroach",
  conf: number,
): void {
  const m = loadMemory();
  const a = m.accuracy;
  const correct = predicted === actual;
  const at = new Date().toISOString();
  a.totalPredictions += 1;
  if (correct) a.correctPredictions += 1;

  const tbl = a.byTable[table] ?? {
    predictions: 0,
    correct: 0,
    currentStreak: 0,
    bestStreak: 0,
    lastAt: at,
    recent: [],
  };
  if (!Array.isArray(tbl.recent)) tbl.recent = [];
  tbl.predictions += 1;
  if (correct) {
    tbl.correct += 1;
    tbl.currentStreak += 1;
    if (tbl.currentStreak > tbl.bestStreak) tbl.bestStreak = tbl.currentStreak;
  } else {
    tbl.currentStreak = 0;
  }
  tbl.lastAt = at;
  const entry: AccuracyRecent = { table, predicted, actual, correct, k, board, conf, at };
  tbl.recent.unshift(entry);
  if (tbl.recent.length > RECENT_PER_TABLE_KEEP) {
    tbl.recent.length = RECENT_PER_TABLE_KEEP;
  }
  a.byTable[table] = tbl;

  const kKey = String(k);
  const kEntry = a.byK[kKey] ?? { predictions: 0, correct: 0 };
  kEntry.predictions += 1;
  if (correct) kEntry.correct += 1;
  a.byK[kKey] = kEntry;

  const boardEntry = a.byBoard[board] ?? { predictions: 0, correct: 0 };
  boardEntry.predictions += 1;
  if (correct) boardEntry.correct += 1;
  a.byBoard[board] = boardEntry;

  const b = bucketOf(conf);
  const bEntry = a.byBucket[b] ?? { predictions: 0, correct: 0 };
  bEntry.predictions += 1;
  if (correct) bEntry.correct += 1;
  a.byBucket[b] = bEntry;

  a.recent.unshift(entry);
  if (a.recent.length > RECENT_PREDICTIONS_KEEP) {
    a.recent.length = RECENT_PREDICTIONS_KEEP;
  }
  scheduleSave();
}

export function loadMemory(): Memory {
  if (mem) return mem;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(MEM_PATH)) {
      const raw = fs.readFileSync(MEM_PATH, "utf8");
      mem = migrate(JSON.parse(raw));
      logger.info(
        {
          samples: mem.totals.samples,
          tables: Object.keys(mem.tables).length,
          shoes: mem.totals.shoesCompleted,
        },
        "Memory loaded",
      );
    } else {
      mem = emptyMemory();
      logger.info({ path: MEM_PATH }, "Memory file not found, starting fresh");
    }
  } catch (err) {
    logger.error({ err }, "Failed to load memory, starting fresh");
    mem = emptyMemory();
  }
  return mem;
}

let saveTimer: NodeJS.Timeout | null = null;

export function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveMemorySync();
  }, 2000);
}

export function saveMemorySync(): void {
  if (!mem) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = MEM_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(mem));
    fs.renameSync(tmp, MEM_PATH);
  } catch (err) {
    logger.error({ err }, "Failed to save memory");
  }
}

export function recordNgram(
  map: NgramMap,
  key: string,
  next: string,
): void {
  if (!key) return;
  let bucket = map[key];
  if (!bucket) {
    bucket = {};
    map[key] = bucket;
  }
  bucket[next] = (bucket[next] ?? 0) + 1;
}

export function ensureTable(tableName: string): TableState {
  const m = loadMemory();
  const existing = m.tables[tableName];
  if (existing) return existing;
  const fresh: TableState = {
    lastSeen: "",
    updatedAt: new Date().toISOString(),
    observations: 0,
    shoeNumber: 1,
    inShoeChange: false,
    lastShoeChangeAt: null,
    recentShoes: [],
  };
  m.tables[tableName] = fresh;
  return fresh;
}

export function markShoeChange(tableName: string): boolean {
  const m = loadMemory();
  const t = ensureTable(tableName);
  if (t.inShoeChange) return false;
  if (t.lastSeen.length > 0) {
    t.recentShoes.unshift(t.lastSeen);
    if (t.recentShoes.length > RECENT_SHOES_KEEP) {
      t.recentShoes.length = RECENT_SHOES_KEEP;
    }
    m.totals.shoesCompleted += 1;
  }
  t.lastSeen = "";
  t.inShoeChange = true;
  t.lastShoeChangeAt = new Date().toISOString();
  t.updatedAt = t.lastShoeChangeAt;
  m.totals.updatedAt = t.lastShoeChangeAt;
  scheduleSave();
  logger.info(
    { table: tableName, shoeNumber: t.shoeNumber },
    "shoe change detected",
  );
  return true;
}

export function memoryDataPath(): string {
  return MEM_PATH;
}
