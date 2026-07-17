/** Structured fields attached to a FinePredict log event. */
export type LogContext = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * Writes a consistently timestamped structured application log.
 *
 * @param service - Service or module producing the event.
 * @param message - Human-readable event description.
 * @param context - Optional structured diagnostic fields.
 * @returns Nothing.
 */
export function log(
  service: string,
  message: string,
  context: LogContext = {},
): void {
  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
  });
  console.log(JSON.stringify({ timestamp, service, message, ...context }));
}
