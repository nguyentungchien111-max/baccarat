import { learnFromSequence } from "./learner";
import { ensureTable, loadMemory, saveMemorySync } from "./memory";
import { logger } from "./logger";

export type SeedEntry = {
  id: string;
  table: string;
  sequence: string;
  source?: string;
};

export const SEED_SEQUENCES: SeedEntry[] = [
  { id: "u-2026-04-30-01", table: "seed-01", sequence: "BPBBBPBBBBTPBBPBPTBPBBPTPPPTBBBPBBBBPPBBPTPP", source: "user-2026-04-30" },
  { id: "u-2026-04-30-02", table: "seed-02", sequence: "BPPTBPPBPPBPPBPBBBTTBBPPBPBPBBPBBBBB", source: "user-2026-04-30" },
  { id: "u-2026-04-30-03", table: "seed-03", sequence: "BPPBBTBBPPBPPPPPTBPPBBBBBPPBPPBPBBTBBPPBBBBBPBPPPPPBBPBBPPTBPB", source: "user-2026-04-30" },
  { id: "u-2026-04-30-04", table: "seed-04", sequence: "BBBTBBPBTBPPPPTBBPPBBPBBPBPPBTBBBBBPBPPBPPBBBBPPPBPBBPBP", source: "user-2026-04-30" },
  { id: "u-2026-04-30-05", table: "seed-05", sequence: "BPPBPTTBPPBBPBBTPPBPPBBPBBPBBPPBBPBTTPBPPBPBTBBPBBPPBTBBBPBPP", source: "user-2026-04-30" },
  { id: "u-2026-04-30-06", table: "seed-06", sequence: "PTBBPPBBBPBBBBBBBBBBPBPTPPPBPPTTBPPBPPPBBPBBPPBBBP", source: "user-2026-04-30" },
  { id: "u-2026-04-30-07", table: "seed-07", sequence: "PBPBPPPBPPPTPBBPPBBBBBBPBTBBBBTBB", source: "user-2026-04-30" },
  { id: "u-2026-04-30-08", table: "seed-08", sequence: "PPBPBPBTBBBPTBPBBPBTPBBPBBBPPBPPBPBBBPPBBBPPBPPBPPPPPBBPPP", source: "user-2026-04-30" },
  { id: "u-2026-04-30-09", table: "seed-09", sequence: "PBPPBPBPBBPPPPBBPPBPBPBPBBPPPPPTBPTBTBPPBBPPPPPBPPPPPBPBPBBTPBBT", source: "user-2026-04-30" },
  { id: "u-2026-04-30-10", table: "seed-10", sequence: "PPPBBPPTPPBBBPPBBPBBBBPBBPPPPBBBPPP", source: "user-2026-04-30" },
  { id: "u-2026-04-30-11", table: "seed-11", sequence: "BPPBPPBPTBPBBPBBBBPPPPBPPPPPPPPBBBPPPBPPBPPBBPBPPPBBPPPBB", source: "user-2026-04-30" },
  { id: "u-2026-04-30-12", table: "seed-12", sequence: "PBPPTBTBBBBBBBBBPBPPTBPBPBPBPPBPBBTBPPPBPPTBPPPPPBPTTTTPPTPBPBBT", source: "user-2026-04-30" },
  { id: "u-2026-04-30-13", table: "seed-13", sequence: "BPPPBPPPTPPPBPTPBBPBBBBBPTPBB", source: "user-2026-04-30" },
  { id: "u-2026-04-30-14", table: "seed-14", sequence: "PTBBPPBBBBBPPTBBPPPPBPBTPPBBBBPBBP", source: "user-2026-04-30" },
  { id: "u-2026-04-30-15", table: "seed-15", sequence: "BPBPBPPBBBBPPPTBPPPPBPBTPPPBBTBPBPPPPPPPPPBBBTBPTBPPBBBPTBBBBTPPTPB", source: "user-2026-04-30" },
  { id: "u-2026-04-30-16", table: "seed-16", sequence: "PPBBBBBPBTBPBPBPBBBPBPPTBPTBBBTPBBTPPPPBPBBPPTPBTBBPBPPBBBPBPPBBPPPBBP", source: "user-2026-04-30" },
  { id: "u-2026-04-30-17", table: "seed-17", sequence: "BBBBPPBPBBPPBPPTTPBBPPPPPP", source: "user-2026-04-30" },
  { id: "u-2026-04-30-18", table: "seed-18", sequence: "PTBPBPPBPBPB", source: "user-2026-04-30" },
  { id: "u-2026-04-30-19", table: "seed-19", sequence: "PBPBPPPTTBPBPBBPPPPPPPBBBPPBPPPBB", source: "user-2026-04-30" },
  { id: "u-2026-04-30-20", table: "seed-20", sequence: "PPPBPTPPTPBPPBPTBBPPBBBPPPBBPBPPBBPTBBBBPPPBPBPPPBPBPB", source: "user-2026-04-30" },
  { id: "u-2026-04-30-21", table: "seed-21", sequence: "BPPPBPBBPTPPBBPPPTBBPPPBBPTBTPBBPP", source: "user-2026-04-30" },
  { id: "u-2026-04-30-22", table: "seed-22", sequence: "PBBPBBBPPPBBPPPPBPBBBBPPBBTPPPTBPBPTPTPBPPPBBPBPP", source: "user-2026-04-30" },
  { id: "u-2026-04-30-23", table: "seed-23", sequence: "PBPPBBPBP", source: "user-2026-04-30" },
  { id: "u-2026-04-30-24", table: "seed-24", sequence: "BPTBPTBBPPBPPPBBBBBPBP", source: "user-2026-04-30" },
];

export function applySeeds(): { applied: number; learned: number; skipped: number } {
  const mem = loadMemory();
  let applied = 0;
  let learned = 0;
  let skipped = 0;
  for (const seed of SEED_SEQUENCES) {
    if (mem.appliedSeeds.includes(seed.id)) {
      skipped++;
      continue;
    }
    const t = ensureTable(seed.table);
    if (t.lastSeen.length > 0) {
      t.recentShoes.unshift(t.lastSeen);
      if (t.recentShoes.length > 10) t.recentShoes.length = 10;
      t.shoeNumber += 1;
    }
    t.lastSeen = "";
    learned += learnFromSequence(seed.table, seed.sequence);
    mem.appliedSeeds.push(seed.id);
    applied++;
  }
  if (applied > 0) {
    saveMemorySync();
    logger.info(
      { applied, learned, skipped, totalSeeds: SEED_SEQUENCES.length },
      "applied built-in seed sequences",
    );
  } else {
    logger.info(
      { skipped, totalSeeds: SEED_SEQUENCES.length },
      "all seeds already applied",
    );
  }
  return { applied, learned, skipped };
}
