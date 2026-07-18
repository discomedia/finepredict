import { createApp } from "./app.js";
import { createAuthRuntime } from "./auth.js";
import { loadConfig } from "./config.js";
import { createDatabaseResources } from "./database/client.js";
import { ProductStore } from "./database/product-store.js";
import {
  MemoryReportStore,
  NeonReportStore,
  type ReportStore,
} from "./database/store.js";
import { log } from "./log.js";
import { BillingService } from "./integrations/billing.js";
import { DiscoMailEmailService } from "./integrations/email.js";

const config = loadConfig();

/**
 * Selects durable Neon persistence when configured, otherwise local memory.
 *
 * @returns Report store for the current runtime.
 */
const databaseResources = config.databaseUrl
  ? createDatabaseResources(config.databaseUrl)
  : null;
const store: ReportStore = databaseResources
  ? new NeonReportStore(databaseResources.database)
  : new MemoryReportStore();
if (!databaseResources) {
  log(
    "server.persistence",
    "DATABASE_URL is absent; using non-persistent in-memory report storage.",
  );
}
const emailService = new DiscoMailEmailService(
  config.discoMailApiKey,
  config.discoMailFromEmail,
);
const authRuntime = createAuthRuntime(config, emailService);
const app = createApp({
  authRuntime,
  billingService: new BillingService(config),
  config,
  ...(databaseResources
    ? { productStore: new ProductStore(databaseResources.database) }
    : {}),
  store,
});
const server = app.listen(config.port, "0.0.0.0", () => {
  log("server.listen", `FinePredict API is listening on port ${config.port}.`, {
    port: config.port,
  });
});

/**
 * Closes HTTP and database resources on a platform termination signal.
 *
 * @param signal - Operating-system termination signal.
 * @returns Nothing after resources close.
 */
async function shutdown(signal: string): Promise<void> {
  log("server.shutdown", `FinePredict API is shutting down.`, { signal });
  server.close();
  await Promise.all([databaseResources?.close(), authRuntime?.close()]);
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
