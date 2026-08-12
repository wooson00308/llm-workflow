import { useId } from "react";
import type { DecisionSummary } from "../domain/documentSections";
import { MarkdownBody } from "./MarkdownBody";

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

      <ol aria-label="변화 흐름" className="decision-summary-flow">
        <li>
          <h3>현재</h3>
          <MarkdownBody body={summary.current} />
        </li>
        <li>
          <h3>변경 후</h3>
          <MarkdownBody body={summary.after} />
        </li>
        <li>
          <h3>사용자 결과</h3>
          <MarkdownBody body={summary.userResult} />
        </li>
      </ol>

      <section aria-labelledby={`${id}-impact`} className="decision-summary-impact">
        <h3 id={`${id}-impact`}>영향 범위</h3>
        <dl>
          <div>
            <dt>변경</dt>
            <dd><MarkdownBody body={summary.changed} /></dd>
          </div>
          <div>
            <dt>유지</dt>
            <dd><MarkdownBody body={summary.unchanged} /></dd>
          </div>
        </dl>
      </section>

      {summary.risk && (
        <section aria-labelledby={`${id}-risk`} className="decision-summary-risk">
          <h3 id={`${id}-risk`}>비용과 위험</h3>
          <MarkdownBody body={summary.risk} />
        </section>
      )}

      <section aria-labelledby={`${id}-request`} className="decision-summary-request">
        <h3 id={`${id}-request`}>결정 요청</h3>
        <MarkdownBody body={summary.decisionRequest} />
      </section>
    </section>
  );
}
