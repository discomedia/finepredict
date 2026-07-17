import type {
  AlertEventType,
  MarketObservation,
  NormalizedLifecycleState,
  SourceAvailability,
} from "@finepredict/shared";

/** Alert candidate created from two normalized observations. */
export interface MonitoringAlertCandidate {
  detail: string;
  title: string;
  type: AlertEventType;
}

/**
 * Maps raw platform lifecycle values without discarding the original value.
 *
 * @param platform - Source prediction-market platform.
 * @param rawState - Raw lifecycle state returned by the platform.
 * @returns FinePredict lifecycle state.
 */
export function normalizeLifecycleState(
  platform: "polymarket" | "kalshi",
  rawState: string,
): NormalizedLifecycleState {
  const normalized = rawState.trim().toLowerCase();
  if (["active", "open"].includes(normalized)) {
    return "open";
  }
  if (["inactive", "initialized", "pending"].includes(normalized)) {
    return "inactive";
  }
  if (["closed", "resolved"].includes(normalized)) {
    return platform === "polymarket" && normalized === "resolved"
      ? "finalized"
      : "closed";
  }
  if (normalized === "determined") {
    return "determined";
  }
  if (["disputed", "challenged"].includes(normalized)) {
    return "disputed";
  }
  if (["amended", "clarified"].includes(normalized)) {
    return "amended";
  }
  if (["finalized", "settled"].includes(normalized)) {
    return "finalized";
  }
  return "unknown";
}

/**
 * Produces specific verifiable changes instead of an aggregate risk score.
 *
 * @param current - Newly captured observation.
 * @param previousObservations - Prior observations ordered newest first.
 * @returns Concrete alert candidates for this transition.
 */
export function createMonitoringAlerts(
  current: MarketObservation,
  previousObservations: MarketObservation[],
): MonitoringAlertCandidate[] {
  const previous = previousObservations[0];
  if (!previous) {
    return [];
  }
  const alerts: MonitoringAlertCandidate[] = [];
  if (current.rulesHash !== previous.rulesHash) {
    alerts.push({
      detail: `The settlement-relevant rules text changed. Review the archived visual diff.`,
      title: `Rules changed`,
      type: "rules_changed",
    });
  }
  if (current.title !== previous.title) {
    alerts.push({
      detail: `The market title changed from “${previous.title}” to “${current.title}”.`,
      title: `Title changed`,
      type: "title_changed",
    });
  }
  if (current.deadline !== previous.deadline) {
    const previousTime = previous.deadline
      ? new Date(previous.deadline).getTime()
      : null;
    const currentTime = current.deadline
      ? new Date(current.deadline).getTime()
      : null;
    const extended =
      previousTime !== null &&
      currentTime !== null &&
      currentTime > previousTime;
    alerts.push({
      detail: `The deadline changed from ${formatNullableValue(previous.deadline)} to ${formatNullableValue(current.deadline)}.`,
      title: extended ? `Deadline extended` : `Deadline changed`,
      type: extended ? "deadline_extended" : "deadline_changed",
    });
  }
  if (current.resolutionSource !== previous.resolutionSource) {
    alerts.push({
      detail: `The named resolution source changed from ${formatNullableValue(previous.resolutionSource)} to ${formatNullableValue(current.resolutionSource)}.`,
      title: `Resolution source changed`,
      type: "resolution_source_changed",
    });
  }

  const currentIsDegraded = isLimitedSourceState(current.sourceAvailability);
  const previousTwoAreDegraded =
    previousObservations.length >= 2 &&
    previousObservations
      .slice(0, 2)
      .every((observation) =>
        isLimitedSourceState(observation.sourceAvailability),
      );
  const olderWasDegraded = previousObservations[2]
    ? isLimitedSourceState(previousObservations[2].sourceAvailability)
    : false;
  if (currentIsDegraded && previousTwoAreDegraded && !olderWasDegraded) {
    alerts.push({
      detail: `The named source has been access-limited or unchecked for three consecutive monitor runs. This does not prove that the source is unavailable.`,
      title: `Resolution source checks are limited`,
      type: "source_degraded",
    });
  }
  const previousThreeAreDegraded =
    previousObservations.length >= 3 &&
    previousObservations
      .slice(0, 3)
      .every((observation) =>
        isLimitedSourceState(observation.sourceAvailability),
      );
  if (current.sourceAvailability === "available" && previousThreeAreDegraded) {
    alerts.push({
      detail: `The named resolution source responded successfully after at least three limited checks.`,
      title: `Resolution source recovered`,
      type: "source_recovered",
    });
  }

  if (current.normalizedState !== previous.normalizedState) {
    const lifecycleType = lifecycleAlertType(current.normalizedState);
    if (lifecycleType) {
      alerts.push({
        detail: `The platform lifecycle moved from “${previous.rawPlatformState}” to “${current.rawPlatformState}”.`,
        title: lifecycleTitle(current.normalizedState),
        type: lifecycleType,
      });
    }
  }
  return alerts;
}

/**
 * Classifies source states that count toward the conservative three-run alert.
 *
 * @param state - Source availability result.
 * @returns True when automation could not confirm reachability.
 */
function isLimitedSourceState(state: SourceAvailability): boolean {
  return state === "access_limited" || state === "not_checked";
}

/**
 * Selects an alert type for lifecycle states that warrant notification.
 *
 * @param state - Current normalized lifecycle state.
 * @returns Lifecycle alert type or null for ordinary transitions.
 */
function lifecycleAlertType(
  state: NormalizedLifecycleState,
): AlertEventType | null {
  const mapping: Partial<Record<NormalizedLifecycleState, AlertEventType>> = {
    amended: "lifecycle_amended",
    determined: "lifecycle_determined",
    disputed: "lifecycle_disputed",
    finalized: "lifecycle_finalized",
  };
  return mapping[state] ?? null;
}

/**
 * Creates a readable lifecycle-alert heading.
 *
 * @param state - Current normalized lifecycle state.
 * @returns Human-readable notification title.
 */
function lifecycleTitle(state: NormalizedLifecycleState): string {
  const labels: Partial<Record<NormalizedLifecycleState, string>> = {
    amended: "Settlement state amended",
    determined: "Outcome determined",
    disputed: "Outcome disputed",
    finalized: "Settlement finalized",
  };
  return labels[state] ?? `Lifecycle changed`;
}

/**
 * Formats a nullable exact value for a monitoring message.
 *
 * @param value - Optional source or deadline value.
 * @returns Quoted value or an explicit absent label.
 */
function formatNullableValue(value: string | null): string {
  return value ? `“${value}”` : `not specified`;
}
