import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./database/client.js";
import {
  MemoryReportStore,
  NeonReportStore,
  type ReportStore,
} from "./database/store.js";
import { log } from "./log.js";

const config = loadConfig();

/**
 * Selects durable Neon persistence when configured, otherwise local memory.
 *
 * @returns Report store for the current runtime.
 */
function createReportStore(): ReportStore {
  if (!config.databaseUrl) {
    log(
      "server.createReportStore",
      "DATABASE_URL is absent; using non-persistent in-memory storage.",
    );
    return new MemoryReportStore();
  }
  return new NeonReportStore(createDatabase(config.databaseUrl));
}

const app = createApp({ config, store: createReportStore() });
app.listen(config.port, "0.0.0.0", () => {
  log("server.listen", `FinePredict API is listening on port ${config.port}.`, {
    port: config.port,
  });
});
