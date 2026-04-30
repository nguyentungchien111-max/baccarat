import app from "./app";
import { logger } from "./lib/logger";
import { loadMemory, saveMemorySync } from "./lib/memory";
import { applySeeds } from "./lib/seed";
import { startPoller } from "./lib/source";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

loadMemory();
applySeeds();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startPoller();
});

const flushAndExit = (signal: string) => {
  logger.info({ signal }, "shutting down, flushing memory");
  try {
    saveMemorySync();
  } catch {
    // ignore
  }
  process.exit(0);
};
process.on("SIGTERM", () => flushAndExit("SIGTERM"));
process.on("SIGINT", () => flushAndExit("SIGINT"));
