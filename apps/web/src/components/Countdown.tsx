import { Clock3 } from "lucide-react";

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
  if (!endDate) {
    return (
      <span className="countdown muted">
        <Clock3 size={15} /> No platform end time
      </span>
    );
  }
  const remainingMilliseconds = new Date(endDate).getTime() - Date.now();
  if (remainingMilliseconds <= 0) {
    return (
      <span className="countdown resolved">
        <Clock3 size={15} /> Platform close passed
      </span>
    );
  }
  const totalHours = Math.floor(remainingMilliseconds / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return (
    <span className="countdown">
      <Clock3 size={15} /> {days}d {hours}h remaining
    </span>
  );
}
