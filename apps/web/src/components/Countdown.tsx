import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";

/** Properties for a market resolution countdown. */
interface CountdownProps {
  endDate: string | null;
}

/**
 * Renders a compact countdown to the platform end timestamp.
 *
 * @param props - Optional ISO end date.
 * @returns Countdown or an explicit missing deadline marker.
 */
export function Countdown({ endDate }: CountdownProps) {
  const [currentTimeMilliseconds, setCurrentTimeMilliseconds] = useState(() =>
    Date.now(),
  );

  useEffect(() => {
    if (!endDate || Number.isNaN(new Date(endDate).getTime())) {
      return undefined;
    }
    setCurrentTimeMilliseconds(Date.now());
    const intervalId = window.setInterval(() => {
      const nextTimeMilliseconds = Date.now();
      setCurrentTimeMilliseconds(nextTimeMilliseconds);
      if (nextTimeMilliseconds >= new Date(endDate).getTime()) {
        window.clearInterval(intervalId);
      }
    }, 1_000);
    return () => window.clearInterval(intervalId);
  }, [endDate]);

  if (!endDate) {
    return (
      <span className="countdown muted">
        <Clock3 size={15} /> No platform end time
      </span>
    );
  }
  const endTimeMilliseconds = new Date(endDate).getTime();
  if (Number.isNaN(endTimeMilliseconds)) {
    return (
      <span className="countdown muted">
        <Clock3 size={15} /> Invalid platform end time
      </span>
    );
  }
  const remainingMilliseconds = endTimeMilliseconds - currentTimeMilliseconds;
  if (remainingMilliseconds <= 0) {
    return (
      <span className="countdown resolved">
        <Clock3 size={15} /> Platform close passed
      </span>
    );
  }
  const remainingLabel = formatRemainingTime(remainingMilliseconds);
  return (
    <time className="countdown" dateTime={endDate}>
      <Clock3 size={15} /> {remainingLabel} remaining
    </time>
  );
}

/**
 * Formats a remaining duration with useful precision for both short and long
 * prediction-market contracts.
 *
 * @param remainingMilliseconds - Positive duration until platform close.
 * @returns Compact duration using days/hours, hours/minutes, or minutes/seconds.
 */
export function formatRemainingTime(remainingMilliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMilliseconds / 1_000));
  if (totalSeconds >= 86_400) {
    const days = Math.floor(totalSeconds / 86_400);
    const hours = Math.floor((totalSeconds % 86_400) / 3_600);
    return `${days}d ${hours}h`;
  }
  if (totalSeconds >= 3_600) {
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    return `${hours}h ${minutes}m`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}
