import { log as finePredictLog } from "../../log.js";

/** Log severity retained by the imported arbitrage modules. */
export type ArbitrageLogLevel = "error" | "info" | "warn";

/**
 * Adapts the scanner's existing structured log calls to FinePredict logging.
 *
 * @param level - Event severity.
 * @param service - Scanner module or operation name.
 * @param message - Human-readable diagnostic.
 * @returns Nothing.
 */
export function log(
  level: ArbitrageLogLevel,
  service: string,
  message: string,
): void {
  finePredictLog(`arbitrage.${service}`, message, { level });
}
