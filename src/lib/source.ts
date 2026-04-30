import { logger } from "./logger";
import { learnFromSequence } from "./learner";
import { markShoeChange } from "./memory";

const SOURCE_URL =
  process.env["BACCARAT_SOURCE_URL"] ||
  "https://shop.thiennhan.site/bcr.php";
const POLL_MS = Number(process.env["POLL_MS"] || "8000");

export type SourceRow = {
  cards?: string;
  game_code?: string;
  table_id?: string;
  table_name: string;
  result: string;
  goodRoad?: string | null;
  dealerEvent?: string | null;
};

type SourceResponse = {
  code?: number;
  message?: string;
  data?: SourceRow[];
};

let lastResults: SourceRow[] = [];
let lastFetchedAt = 0;
let lastError: string | null = null;
let pollerTimer: NodeJS.Timeout | null = null;

export function getCachedSource(): {
  rows: SourceRow[];
  fetchedAt: number;
  error: string | null;
} {
  return { rows: lastResults, fetchedAt: lastFetchedAt, error: lastError };
}

function isEmptyResult(s: string | undefined | null): boolean {
  if (!s) return true;
  return s.toUpperCase().replace(/[^BPT]/g, "").length === 0;
}

export async function pollOnce(): Promise<void> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(SOURCE_URL, {
      headers: {
        "User-Agent": "baccarat-analyzer/1.0",
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as SourceResponse;
    if (!json || !Array.isArray(json.data)) {
      throw new Error("invalid response shape");
    }
    lastResults = json.data;
    lastFetchedAt = Date.now();
    lastError = null;
    let totalLearned = 0;
    let shoeChanges = 0;
    for (const row of json.data) {
      if (!row.table_name) continue;
      if (isEmptyResult(row.result)) {
        if (markShoeChange(row.table_name)) shoeChanges += 1;
        continue;
      }
      totalLearned += learnFromSequence(row.table_name, row.result);
    }
    if (totalLearned > 0 || shoeChanges > 0) {
      logger.info(
        {
          tables: json.data.length,
          learned: totalLearned,
          shoeChanges,
        },
        "polled source",
      );
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    logger.warn({ err: lastError }, "poll failed");
  }
}

export function startPoller(): void {
  if (pollerTimer) return;
  void pollOnce();
  pollerTimer = setInterval(() => {
    void pollOnce();
  }, POLL_MS);
  logger.info({ url: SOURCE_URL, intervalMs: POLL_MS }, "poller started");
}

export function stopPoller(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
}
