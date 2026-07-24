import { HttpServiceError } from "../common/http.js";
import { log } from "../common/log.js";

/** Minimal fetch signature accepted by the Kalshi scheduler. */
export type KalshiFetch = (
  input: URL | string,
  init?: RequestInit,
) => Promise<Response>;

/** Controls for globally paced, retryable Kalshi reads. */
export interface KalshiRequestSchedulerOptions {
  /** Minimum elapsed time between any two Kalshi request starts. */
  readonly minimumRequestStartSpacingMs?: number;
  /** Maximum physical HTTP attempts for one logical request. */
  readonly maximumAttempts?: number;
  /** Initial exponential retry delay before jitter. */
  readonly baseRetryDelayMs?: number;
  /** Optional fetch implementation used by tests. */
  readonly fetchImplementation?: KalshiFetch;
  /** Optional timer implementation used by tests. */
  readonly waitImplementation?: (delayMs: number) => Promise<void>;
  /** Optional random number source used to make retry jitter deterministic. */
  readonly randomImplementation?: () => number;
}

/** One callback invoked immediately before every physical HTTP attempt. */
export type KalshiRequestAttemptListener = () => void;

const defaultMinimumRequestStartSpacingMs = 200;
const defaultMaximumAttempts = 4;
const defaultBaseRetryDelayMs = 500;
const maximumRetryDelayMs = 8_000;
const retryableStatuses = new Set([429, 502, 503, 504]);

/**
 * Coordinates every Kalshi metadata and order-book request through one paced
 * queue and applies bounded exponential retry handling.
 */
export class KalshiRequestScheduler {
  private readonly minimumRequestStartSpacingMs: number;
  private readonly maximumAttempts: number;
  private readonly baseRetryDelayMs: number;
  private readonly fetchImplementation: KalshiFetch;
  private readonly waitImplementation: (delayMs: number) => Promise<void>;
  private readonly randomImplementation: () => number;
  private nextRequestStartAtMs = 0;
  private requestStartChain: Promise<void> = Promise.resolve();

  /**
   * Creates a shared Kalshi request scheduler.
   *
   * @param options - Request spacing, retry, and injectable test controls.
   */
  public constructor(options: KalshiRequestSchedulerOptions = {}) {
    this.minimumRequestStartSpacingMs =
      options.minimumRequestStartSpacingMs ??
      defaultMinimumRequestStartSpacingMs;
    this.maximumAttempts = options.maximumAttempts ?? defaultMaximumAttempts;
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? defaultBaseRetryDelayMs;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.waitImplementation = options.waitImplementation ?? wait;
    this.randomImplementation = options.randomImplementation ?? Math.random;
    assertNonNegativeInteger(
      this.minimumRequestStartSpacingMs,
      "minimumRequestStartSpacingMs",
    );
    assertPositiveInteger(this.maximumAttempts, "maximumAttempts");
    assertNonNegativeInteger(this.baseRetryDelayMs, "baseRetryDelayMs");
  }

  /**
   * Fetches and parses one Kalshi JSON response under shared pacing.
   *
   * @param url - Fully qualified Kalshi URL.
   * @param service - Diagnostic service name.
   * @param onAttempt - Callback used to count every physical HTTP request.
   * @returns Parsed JSON with caller-side validation still required.
   */
  public async requestJson(
    url: URL | string,
    service: string,
    onAttempt: KalshiRequestAttemptListener,
  ): Promise<unknown> {
    for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
      await this.waitForRequestSlot();
      onAttempt();
      const response = await this.fetchImplementation(url);
      const body = await response.text();
      if (response.ok) {
        try {
          return JSON.parse(body) as unknown;
        } catch (error: unknown) {
          const reason =
            error instanceof Error ? error.message : "unknown JSON error";
          throw new Error(`${service} returned invalid JSON: ${reason}`);
        }
      }
      const retryable = retryableStatuses.has(response.status);
      if (!retryable || attempt === this.maximumAttempts) {
        throw new HttpServiceError(service, response.status, body);
      }
      const delayMs = calculateRetryDelayMs(
        attempt,
        this.baseRetryDelayMs,
        this.randomImplementation(),
      );
      log(
        "warn",
        "KalshiRequestScheduler.requestJson",
        `${service} returned HTTP ${response.status}; retrying attempt ${attempt + 1} of ${this.maximumAttempts} after ${delayMs} ms`,
      );
      await this.waitImplementation(delayMs);
    }
    throw new Error(`${service} exhausted its retry budget`);
  }

  /**
   * Serializes request starts and reserves the next allowed start time.
   *
   * @returns Nothing after the current request has acquired its start slot.
   */
  private async waitForRequestSlot(): Promise<void> {
    const previous = this.requestStartChain;
    let releaseSlot: (() => void) | undefined;
    this.requestStartChain = new Promise<void>((resolvePromise) => {
      releaseSlot = resolvePromise;
    });
    await previous;
    try {
      const delayMs = Math.max(0, this.nextRequestStartAtMs - Date.now());
      if (delayMs > 0) {
        await this.waitImplementation(delayMs);
      }
      this.nextRequestStartAtMs =
        Date.now() + this.minimumRequestStartSpacingMs;
    } finally {
      releaseSlot?.();
    }
  }
}

/**
 * Calculates capped exponential retry delay with bounded positive jitter.
 *
 * @param attempt - Failed one-based attempt number.
 * @param baseRetryDelayMs - Initial retry delay.
 * @param randomValue - Random value between zero and one.
 * @returns Milliseconds to wait before the next attempt.
 */
export function calculateRetryDelayMs(
  attempt: number,
  baseRetryDelayMs: number,
  randomValue: number,
): number {
  const exponentialDelayMs =
    baseRetryDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  const jitterMs = Math.floor(
    Math.max(0, Math.min(1, randomValue)) * baseRetryDelayMs,
  );
  return Math.min(maximumRetryDelayMs, exponentialDelayMs + jitterMs);
}

/**
 * Waits for a bounded duration.
 *
 * @param delayMs - Delay in milliseconds.
 * @returns Promise resolved after the timer fires.
 */
function wait(delayMs: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}

/**
 * Validates a non-negative integer option.
 *
 * @param value - Candidate integer.
 * @param name - Option name included in failures.
 * @returns Nothing when valid.
 */
function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

/**
 * Validates a positive integer option.
 *
 * @param value - Candidate integer.
 * @param name - Option name included in failures.
 * @returns Nothing when valid.
 */
function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
