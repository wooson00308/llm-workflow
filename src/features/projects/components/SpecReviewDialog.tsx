import { useEffect, useState } from "react";
import { Icon } from "../../../shared/ui/Icon";
import type {
  SpecDecisionOutcome,
  SpecDocument,
} from "../domain/types";

interface Props {
  busy: boolean;
  document: SpecDocument;
  onClose(): void;
  onDecision(outcome: SpecDecisionOutcome, comment: string): Promise<boolean>;
}

const statusLabels: Record<string, string> = {
  draft: "작성 중",
  user_review: "내 선택 대기",
  approved: "승인됨",
  rejected: "폐기됨",
};

export function SpecReviewDialog({
  busy,
  document,
  onClose,
  onDecision,
}: Props) {
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const [recorded, setRecorded] = useState<SpecDecisionOutcome | null>(null);
  const awaitingDecision = document.summary.status === "user_review" && !recorded;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function decide(outcome: SpecDecisionOutcome) {
    if (outcome === "rejected" && !comment.trim()) return;
    if (await onDecision(outcome, comment.trim())) {
      setRecorded(outcome);
      setRejecting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="spec-dialog-title"
        aria-modal="true"
        className="spec-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="spec-dialog-header">
          <div>
            <p className="eyebrow">PLANNING DOCUMENT · {document.summary.id}</p>
            <h1 id="spec-dialog-title">{document.summary.title}</h1>
          </div>
          <button aria-label="기획서 닫기" className="dialog-close" onClick={onClose}>×</button>
        </header>

        <div className="spec-status-row">
          <span className={`status-pill status-${recorded ?? document.summary.status}`}>
            {recorded === "approved"
              ? "승인됨"
              : recorded === "rejected"
                ? "폐기됨"
                : statusLabels[document.summary.status] ?? document.summary.status}
          </span>
          <span>원본 Markdown은 수정하지 않고 결정 기록을 별도 저장합니다.</span>
        </div>

        <article className="spec-paper">
          <MarkdownBody body={document.body} />
          {recorded && (
            <div className={`decision-stamp ${recorded}`} aria-live="polite">
              <Icon name="stamp" />
              <strong>{recorded === "approved" ? "승인" : "폐기"}</strong>
              <small>USER DECISION</small>
            </div>
          )}
        </article>

        {awaitingDecision && (
          <footer className="decision-footer">
            {rejecting ? (
              <div className="rejection-form">
                <label htmlFor="rejection-comment">폐기 사유</label>
                <textarea
                  autoFocus
                  id="rejection-comment"
                  maxLength={2_000}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="LLM이 다음 기획에서 반영할 수 있도록 구체적으로 적어주세요."
                  value={comment}
                />
                <div>
                  <button className="text-button" onClick={() => setRejecting(false)}>취소</button>
                  <button
                    className="danger-button"
                    disabled={busy || !comment.trim()}
                    onClick={() => void decide("rejected")}
                  >
                    코멘트와 함께 폐기
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div><strong>이 기획을 다음 단계로 넘길까요?</strong><span>승인 또는 폐기 기록이 `decisions/`에 남습니다.</span></div>
                <div className="decision-actions">
                  <button className="secondary-button reject" disabled={busy} onClick={() => setRejecting(true)}>폐기</button>
                  <button className="stamp-button" disabled={busy} onClick={() => void decide("approved")}><Icon name="stamp" />승인 도장 찍기</button>
                </div>
              </>
            )}
          </footer>
        )}

        {recorded && (
          <footer className="decision-recorded">
            <span>결정 Markdown을 안전하게 저장했습니다.</span>
            <button className="primary-button" onClick={onClose}>확인</button>
          </footer>
        )}
      </section>
    </div>
  );
}

function MarkdownBody({ body }: { body: string }) {
  return (
    <div className="markdown-body">
      {body.split("\n").map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <span className="markdown-space" key={index} />;
        if (trimmed.startsWith("### ")) return <h3 key={index}>{trimmed.slice(4)}</h3>;
        if (trimmed.startsWith("## ")) return <h2 key={index}>{trimmed.slice(3)}</h2>;
        if (trimmed.startsWith("# ")) return <h1 key={index}>{trimmed.slice(2)}</h1>;
        if (/^[-*] /.test(trimmed)) return <li key={index}>{trimmed.slice(2)}</li>;
        if (/^\d+\. /.test(trimmed)) return <li key={index}>{trimmed.replace(/^\d+\. /, "")}</li>;
        return <p key={index}>{trimmed}</p>;
      })}
    </div>
  );
}
