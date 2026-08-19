import { useId } from "react";
import type { ChangeRow, DecisionSummary } from "../domain/documentSections";
import { MarkdownBody } from "./MarkdownBody";

/**
 * 결정권자 요약을 보여 주는 보드. 결정은 항상 앱의 도장 세 개로 내리므로 별도의 요청 문구는 없다.
 *
 * 현행 불릿형 문서는 제안 한 문장 아래 "지금 → 앞으로" 행들을 세로로 쌓고, 이전 문단형 문서는
 * 현재→변경 후 전후 상자 한 쌍으로 그대로 그린다. 긴 문단을 좁은 상자 두 개에 붓던 표시가 문서
 * 형식과 함께 행 단위로 바뀐 것이라, 어느 쪽도 문서를 고쳐 쓰지 않는다.
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

      {summary.changes ? (
        <div aria-label="바뀌는 것" className="decision-summary-changes" role="group">
          <h3>바뀌는 것</h3>
          <ul>
            {summary.changes.map((row, index) => (
              <ChangeRowItem key={index} row={row} />
            ))}
          </ul>
        </div>
      ) : (
        <div aria-label="변화 전후" className="decision-summary-compare" role="group">
          <div className="decision-summary-before">
            <h3>현재</h3>
            <MarkdownBody body={summary.current ?? ""} />
          </div>
          <span aria-hidden="true" className="decision-summary-arrow">→</span>
          <div className="decision-summary-after">
            <h3>변경 후</h3>
            <MarkdownBody body={summary.after ?? ""} />
          </div>
        </div>
      )}

      {summary.riskItems && (
        <section aria-labelledby={`${id}-risk`} className="decision-summary-risk">
          <h3 id={`${id}-risk`}>비용과 위험</h3>
          <ul className="decision-summary-risk-items">
            {summary.riskItems.map((item, index) => (
              <li key={index}><MarkdownBody body={item} /></li>
            ))}
          </ul>
        </section>
      )}
      {!summary.riskItems && summary.risk && (
        <section aria-labelledby={`${id}-risk`} className="decision-summary-risk">
          <h3 id={`${id}-risk`}>비용과 위험</h3>
          <MarkdownBody body={summary.risk} />
        </section>
      )}
    </section>
  );
}

function ChangeRowItem({ row }: { row: ChangeRow }) {
  if (row.whole !== undefined) {
    return (
      <li className="decision-change-row decision-change-single">
        <MarkdownBody body={row.whole} />
      </li>
    );
  }
  return (
    <li className="decision-change-row">
      <span className="decision-change-before">
        <small>지금</small>
        <MarkdownBody body={row.before ?? ""} />
      </span>
      <span aria-hidden="true" className="decision-summary-arrow">→</span>
      <span className="decision-change-after">
        <small>앞으로</small>
        <MarkdownBody body={row.after ?? ""} />
      </span>
    </li>
  );
}
