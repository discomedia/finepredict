import type { MarketComparison, MarketPlatform } from "@finepredict/shared";
import { Check, X } from "lucide-react";

/** Properties for the cross-market comparison table. */
interface ComparisonTableProps {
  comparison: MarketComparison;
  leftPlatform: MarketPlatform;
  rightPlatform: MarketPlatform;
}

/**
 * Renders settlement terms side by side with an explicit equivalence verdict.
 *
 * @param props - Comparison rows and platform column labels.
 * @returns Accessible comparison table.
 */
export function ComparisonTable({
  comparison,
  leftPlatform,
  rightPlatform,
}: ComparisonTableProps) {
  return (
    <section className="report-section comparison-section">
      <div className="section-title-row">
        <div>
          <span className="report-kicker">Cross-market comparison</span>
          <h2>Equivalent trade?</h2>
        </div>
        <div
          className={`equivalence-badge ${comparison.equivalentTrade ? "equivalent" : "different"}`}
        >
          {comparison.equivalentTrade ? <Check size={18} /> : <X size={18} />}
          {comparison.equivalentTrade
            ? "Likely equivalent"
            : "No — terms differ"}
        </div>
      </div>
      <p className="comparison-conclusion">{comparison.conclusion}</p>
      <div className="table-scroll">
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Term</th>
              <th>{capitalize(leftPlatform)}</th>
              <th>{capitalize(rightPlatform)}</th>
              <th>Match</th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <tr key={row.term}>
                <th>{row.term}</th>
                <td>{row.left}</td>
                <td>{row.right}</td>
                <td className={row.equivalent ? "row-match" : "row-difference"}>
                  {row.equivalent ? <Check size={17} /> : <X size={17} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Capitalizes a platform name for a table heading.
 *
 * @param value - Lowercase platform value.
 * @returns Capitalized platform label.
 */
function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
