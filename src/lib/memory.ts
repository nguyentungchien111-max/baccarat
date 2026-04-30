import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

export type NgramMap = Record<string, Record<string, number>>;

export type Memory = {
  version: 1;
  ngrams: {
    main: NgramMap;
    eye: NgramMap;
    small: NgramMap;
    cockroach: NgramMap;
  };
  tables: Record<
    string,
    { lastSeen: string; updatedAt: string; observations: number }
  >;
  totals: { samples: number; updatedAt: string };
};

const DATA_DIR =
  process.env["DATA_DIR"] || path.resolve(process.cwd(), "data");
const MEM_PATH = path.join(DATA_DIR, "baccarat-memory.json");

let mem: Memory | null = null;

function emptyMemory(): Memory {
  return {
    version: 1,
    ngrams: { main: {}, eye: {}, small: {}, cockroach: {} },
    tables: {},
    totals: { samples: 0, updatedAt: new Date().toISOString() },
  };
}

export function loadMemory(): Memory {
  if (mem) return mem;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(MEM_PATH)) {
      const raw = fs.readFileSync(MEM_PATH, "utf8");
      mem = JSON.parse(raw) as Memory;
      if (!mem.ngrams) mem = emptyMemory();
      logger.info(
        { samples: mem.totals.samples, tables: Object.keys(mem.tables).length },
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

export function memoryDataPath(): string {
  return MEM_PATH;
}
