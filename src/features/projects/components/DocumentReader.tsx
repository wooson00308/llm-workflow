import { useEffect, useMemo, useState } from "react";
import { parseDecisionSummary, splitSection } from "../domain/documentSections";
import { DecisionSummaryBoard } from "./DecisionSummaryBoard";
import { MarkdownBody } from "./MarkdownBody";

/**
 * 결정권자 요약 절의 제목. 앱이 문서 계약에 박아 넣은 문자열과 문자 단위로 같다(TASK-118).
 *
 * 이 한 문자열만 찾는다. 후보를 추측하지 않고 대소문자·공백 변형도 만들지 않는다(SPEC-039 R2).
 */
export const DECISION_SUMMARY_HEADING = "## 결정권자 요약";

/**
 * 문서 하나를 두 양식으로 그린다. 기본은 결정권자에게 쓴 요약 절이고, 토글이 원문 전문을 편다.
 *
 * 토글 상태를 저장하지 않는다(DECISION-BAD86692의 승인된 확인 필요 3번). 문서를 열 때마다 평문에서
 * 시작하는 것이 이 화면의 기본 독자가 누구인지 말하는 자리다. 문서가 바뀌면 이 컴포넌트도 원문
 * 상태를 접어, 부르는 쪽의 `key` 유무와 관계없이 같은 기본 화면을 지킨다.
 *
 * 요약 절이 없으면 원문 전문을 그리고 아무 문구도 붙이지 않는다(승인된 확인 필요 2번). 그때는 토글도
 * 두지 않는다. 눌러도 같은 것이 다시 나오는 토글은 감춰 둔 것이 있다고 말하는 셈이고, 문구를 붙이지
 * 않기로 한 결정과 같은 이유로 그 말도 하지 않는다.
 */
export function DocumentReader({ body }: { body: string }) {
  const [showSource, setShowSource] = useState(false);
  const summary = useMemo(() => splitSection(body, DECISION_SUMMARY_HEADING).section, [body]);
  const decisionSummary = useMemo(() => parseDecisionSummary(summary), [summary]);

  useEffect(() => setShowSource(false), [body]);

  if (summary === null) return <MarkdownBody body={body} />;

  return (
    <div className={`document-reader${decisionSummary ? " structured" : ""}`}>
      <div className="document-reader-bar">
        <button
          aria-expanded={showSource}
          className="document-reader-toggle"
          onClick={() => setShowSource((value) => !value)}
          type="button"
        >
          {showSource ? "요약만 보기" : "원문 전문 보기"}
        </button>
      </div>
      {/* 원문은 자르지 않은 본문 그대로다. 기본 뷰에서 감춰졌던 절이 토글 뒤에서 전부 보인다. */}
      {showSource
        ? <MarkdownBody body={body} />
        : decisionSummary
          ? <DecisionSummaryBoard summary={decisionSummary} />
          : <MarkdownBody body={summary} />}
    </div>
  );
}
