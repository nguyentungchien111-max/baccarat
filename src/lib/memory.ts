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
};

const DATA_DIR =
  process.env["DATA_DIR"] || path.resolve(process.cwd(), "data");
const MEM_PATH = path.join(DATA_DIR, "baccarat-memory.json");

const RECENT_SHOES_KEEP = 10;

let mem: Memory | null = null;

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
  return fresh;
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
