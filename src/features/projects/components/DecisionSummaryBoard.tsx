import { useId } from "react";
import type { DecisionSummary } from "../domain/documentSections";
import { MarkdownBody } from "./MarkdownBody";

/**
 * 결정권자 요약을 세 덩어리로 보여 주는 보드: 제안 한 문장, 현재→변경 후 전후 한 쌍,
 * 그리고 있을 때만 비용과 위험. 결정은 항상 앱의 도장 세 개로 내리므로 별도의 요청 문구는 없다.
 */
export function DecisionSummaryBoard({ summary }: { summary: DecisionSummary }) {
  const id = useId();
  const titleId = `${id}-title`;

  return (
    <section aria-labelledby={titleId} className="decision-summary-board">
      <header className="decision-summary-proposal">
        <h2 id={titleId}>결정 보드</h2>
        <h3>제안</h3>
        <MarkdownBody body={summary.proposal} />
      </header>

      <div aria-label="변화 전후" className="decision-summary-compare" role="group">
        <div className="decision-summary-before">
          <h3>현재</h3>
          <MarkdownBody body={summary.current} />
        </div>
        <span aria-hidden="true" className="decision-summary-arrow">→</span>
        <div className="decision-summary-after">
          <h3>변경 후</h3>
          <MarkdownBody body={summary.after} />
        </div>
      </div>

      {summary.risk && (
        <section aria-labelledby={`${id}-risk`} className="decision-summary-risk">
          <h3 id={`${id}-risk`}>비용과 위험</h3>
          <MarkdownBody body={summary.risk} />
        </section>
      )}
    </section>
  );
}
