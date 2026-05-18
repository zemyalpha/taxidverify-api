import { serve } from "@hono/node-server";
import pino from "pino";
import { initDb } from "./db/client.js";
import { createApp } from "./app.js";

const logger = pino({ name: "taxidverify", level: process.env.LOG_LEVEL ?? "info" });

initDb(process.env.DATABASE_PATH);
const app = createApp();
const port = parseInt(process.env.PORT ?? "3000", 10);

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port }, "TaxIDVerify server started");
});
