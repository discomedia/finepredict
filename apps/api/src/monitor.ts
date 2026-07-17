import { Pool } from "pg";

import { loadConfig } from "./config.js";
import { createDatabaseResources } from "./database/client.js";
import { BillingService } from "./integrations/billing.js";
import { ResendEmailService } from "./integrations/email.js";
import { log } from "./log.js";
import { MonitorService } from "./monitoring/service.js";
import { MonitoringStore } from "./monitoring/store.js";

const config = loadConfig();
if (!config.databaseUrl) {
  throw new Error(`FinePredict monitor: DATABASE_URL is required.`);
}

const lockPool = new Pool({ connectionString: config.databaseUrl, max: 1 });
const lockClient = await lockPool.connect();
const databaseResources = createDatabaseResources(config.databaseUrl);
let acquired = false;

try {
  await lockClient.query("begin");
  const lockResult = await lockClient.query<{ acquired: boolean }>(
    `select pg_try_advisory_xact_lock(hashtext('finepredict-hourly-monitor')) as acquired`,
  );
  acquired = lockResult.rows[0]?.acquired ?? false;
  if (!acquired) {
    log(
      "monitor.main",
      `Another monitor run holds the advisory lock; exiting.`,
    );
  } else {
    const emailService = new ResendEmailService(
      config.resendApiKey,
      config.resendFromEmail,
    );
    const result = await new MonitorService({
      billingService: new BillingService(config),
      config,
      emailService,
      store: new MonitoringStore(databaseResources.database),
    }).run();
    log("monitor.main", `Hourly monitor completed and will now exit.`, {
      ...result,
    });
  }
} finally {
  await lockClient.query("rollback").catch(() => undefined);
  lockClient.release();
  await Promise.all([lockPool.end(), databaseResources.close()]);
}
