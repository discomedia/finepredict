import {
  createPublicClient,
  hexToString,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { polygon } from "viem/chains";

/** Official Polymarket UMA CTF adapter deployments on Polygon. */
const UMA_CTF_ADAPTERS: Address[] = [
  "0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49",
  "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74",
  "0xCB1822859cEF82Cd2Eb4E6276C7916e692995130",
];

const QUESTION_RESET_EVENT = parseAbiItem(
  "event QuestionReset(bytes32 indexed questionID)",
);
const QUESTION_RESOLVED_EVENT = parseAbiItem(
  "event QuestionResolved(bytes32 indexed questionID, int256 indexed settledPrice, uint256[] payouts)",
);
const QUESTION_MANUALLY_RESOLVED_EVENT = parseAbiItem(
  "event QuestionManuallyResolved(bytes32 indexed questionID, uint256[] payouts)",
);
const QUESTION_FLAGGED_EVENT = parseAbiItem(
  "event QuestionFlagged(bytes32 indexed questionID)",
);
const ANCILLARY_DATA_UPDATED_EVENT = parseAbiItem(
  "event AncillaryDataUpdated(bytes32 indexed questionID, address indexed owner, bytes update)",
);

/** Verifiable Polymarket UMA or bulletin-board event. */
export interface PolymarketChainEvent {
  detail: string | null;
  eventType:
    | "uma_disputed"
    | "uma_resolved"
    | "uma_manually_resolved"
    | "uma_flagged"
    | "onchain_clarification";
  occurredAt: string;
  rawPlatformState: string;
  sourceUrl: string;
  transactionHash: string;
}

/** Reads relevant UMA adapter and on-chain clarification events from Polygon. */
export class PolymarketChainMonitor {
  private readonly client;

  /**
   * Creates a read-only Polygon client.
   *
   * @param polygonRpcUrl - Configured Polygon JSON-RPC endpoint.
   */
  public constructor(polygonRpcUrl: string) {
    this.client = createPublicClient({
      chain: polygon,
      transport: http(polygonRpcUrl, { timeout: 15_000 }),
    });
  }

  /**
   * Loads transaction-backed dispute, resolution, and clarification events.
   *
   * @param questionId - Gamma market questionID.
   * @param creatorAddress - Optional market creator used to filter bulletins.
   * @returns Chronological verifiable events.
   */
  public async listEvents(
    questionId: string,
    creatorAddress: string | null,
  ): Promise<PolymarketChainEvent[]> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(questionId)) {
      return [];
    }
    const questionID = questionId as Hex;
    const [resetLogs, resolvedLogs, manualLogs, flaggedLogs, bulletinLogs] =
      await Promise.all([
        this.client.getLogs({
          address: UMA_CTF_ADAPTERS,
          args: { questionID },
          event: QUESTION_RESET_EVENT,
          fromBlock: 0n,
          toBlock: "latest",
        }),
        this.client.getLogs({
          address: UMA_CTF_ADAPTERS,
          args: { questionID },
          event: QUESTION_RESOLVED_EVENT,
          fromBlock: 0n,
          toBlock: "latest",
        }),
        this.client.getLogs({
          address: UMA_CTF_ADAPTERS,
          args: { questionID },
          event: QUESTION_MANUALLY_RESOLVED_EVENT,
          fromBlock: 0n,
          toBlock: "latest",
        }),
        this.client.getLogs({
          address: UMA_CTF_ADAPTERS,
          args: { questionID },
          event: QUESTION_FLAGGED_EVENT,
          fromBlock: 0n,
          toBlock: "latest",
        }),
        this.client.getLogs({
          address: UMA_CTF_ADAPTERS,
          args: {
            questionID,
            ...(creatorAddress && /^0x[0-9a-fA-F]{40}$/.test(creatorAddress)
              ? { owner: creatorAddress as Address }
              : {}),
          },
          event: ANCILLARY_DATA_UPDATED_EVENT,
          fromBlock: 0n,
          toBlock: "latest",
        }),
      ]);

    const candidates = [
      ...resetLogs.map((log) => ({
        blockNumber: log.blockNumber,
        detail: null,
        eventType: "uma_disputed" as const,
        rawPlatformState: "disputed",
        transactionHash: log.transactionHash,
      })),
      ...resolvedLogs.map((log) => ({
        blockNumber: log.blockNumber,
        detail: `Settled price: ${String(log.args.settledPrice)}.`,
        eventType: "uma_resolved" as const,
        rawPlatformState: "resolved",
        transactionHash: log.transactionHash,
      })),
      ...manualLogs.map((log) => ({
        blockNumber: log.blockNumber,
        detail: `Market resolved manually on-chain.`,
        eventType: "uma_manually_resolved" as const,
        rawPlatformState: "manually_resolved",
        transactionHash: log.transactionHash,
      })),
      ...flaggedLogs.map((log) => ({
        blockNumber: log.blockNumber,
        detail: `Market flagged for manual resolution.`,
        eventType: "uma_flagged" as const,
        rawPlatformState: "flagged",
        transactionHash: log.transactionHash,
      })),
      ...bulletinLogs.map((log) => ({
        blockNumber: log.blockNumber,
        detail: decodeBulletin(log.args.update),
        eventType: "onchain_clarification" as const,
        rawPlatformState: "clarified",
        transactionHash: log.transactionHash,
      })),
    ].filter(
      (
        event,
      ): event is typeof event & {
        blockNumber: bigint;
        transactionHash: Hex;
      } => event.blockNumber !== null && event.transactionHash !== null,
    );
    const blockNumbers = [
      ...new Set(candidates.map((item) => item.blockNumber)),
    ];
    const timestamps = new Map<bigint, bigint>();
    await Promise.all(
      blockNumbers.map(async (blockNumber) => {
        const block = await this.client.getBlock({ blockNumber });
        timestamps.set(blockNumber, block.timestamp);
      }),
    );
    return candidates
      .map((event) => ({
        detail: event.detail,
        eventType: event.eventType,
        occurredAt: new Date(
          Number(timestamps.get(event.blockNumber) ?? 0n) * 1000,
        ).toISOString(),
        rawPlatformState: event.rawPlatformState,
        sourceUrl: `https://polygonscan.com/tx/${event.transactionHash}`,
        transactionHash: event.transactionHash,
      }))
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  }
}

/**
 * Converts bulletin-board bytes to readable UTF-8 while preserving raw bytes.
 *
 * @param update - On-chain bulletin data.
 * @returns Decoded bulletin text or original hex.
 */
function decodeBulletin(update: Hex | undefined): string | null {
  if (!update) {
    return null;
  }
  try {
    return hexToString(update).replaceAll("\u0000", "").trim() || update;
  } catch {
    return update;
  }
}
