import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const PUBLIC_DIR = path.resolve(__dirname, "public");
const PUBLIC_DIR_FALLBACK = path.resolve(__dirname, "../src/public");
app.use(express.static(PUBLIC_DIR, { fallthrough: true }));
app.use(express.static(PUBLIC_DIR_FALLBACK, { fallthrough: true }));
app.get("/", (_req, res) => {
  const primary = path.join(PUBLIC_DIR, "index.html");
  const fallback = path.join(PUBLIC_DIR_FALLBACK, "index.html");
  res.sendFile(primary, (err) => {
    if (err) res.sendFile(fallback);
  });
});

export default app;
