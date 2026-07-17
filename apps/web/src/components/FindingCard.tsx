import type { ContractFinding } from "@finepredict/shared";
import { AlertTriangle, Info, Siren } from "lucide-react";

/** Properties for one evidence-backed finding card. */
interface FindingCardProps {
  finding: ContractFinding;
}

/**
 * Renders a finding beside the exact supporting contract text.
 *
 * @param props - Specific contract finding.
 * @returns Finding card element.
 */
export function FindingCard({ finding }: FindingCardProps) {
  const Icon =
    finding.severity === "high"
      ? Siren
      : finding.severity === "warning"
        ? AlertTriangle
        : Info;
  return (
    <article className={`finding-card finding-${finding.severity}`}>
      <div className="finding-title">
        <Icon size={18} />
        <div>
          <span>{finding.severity}</span>
          <h4>{finding.title}</h4>
        </div>
      </div>
      <p>{finding.explanation}</p>
      <blockquote>“{finding.quote}”</blockquote>
    </article>
  );
}
