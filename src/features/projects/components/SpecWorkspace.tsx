import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../../shared/ui/Icon";
import type {
  SpecDecisionOutcome,
  SpecDocument,
  WorkflowItemSummary,
  WorkflowSummary,
} from "../domain/types";
import { MarkdownBody } from "./MarkdownBody";

interface Props {
  busy: boolean;
  document: SpecDocument | null;
  loading: boolean;
  onDecision(outcome: SpecDecisionOutcome, comment: string): Promise<boolean>;
  onSelect(item: WorkflowItemSummary): void;
  workflow: WorkflowSummary;
}

type SpecFilter = "all" | "draft" | "user_review" | "decided";
type CommentDecision = Exclude<SpecDecisionOutcome, "approved">;

const statusLabels: Record<string, string> = {
  draft: "작성 중",
  user_review: "내 선택 대기",
  approved: "승인됨",
  revision_requested: "수정 요청됨",
  rejected: "폐기됨",
};

const decisionLabels: Record<SpecDecisionOutcome, string> = {
  approved: "승인",
  revision_requested: "수정 요청",
  rejected: "폐기",
};

export function SpecWorkspace({
  busy,
  document,
  loading,
  onDecision,
  onSelect,
  workflow,
}: Props) {
  const [filter, setFilter] = useState<SpecFilter>("all");
  const [commentDecision, setCommentDecision] = useState<CommentDecision | null>(null);
  const [comment, setComment] = useState("");
  const [recorded, setRecorded] = useState<SpecDecisionOutcome | null>(null);

  useEffect(() => {
    setCommentDecision(null);
    setComment("");
    setRecorded(null);
  }, [document?.summary.fileName]);

  const filtered = useMemo(
    () => workflow.items.specs.filter((item) => matchesFilter(item, filter)),
    [filter, workflow.items.specs],
  );
  const activeStatus = recorded ?? document?.summary.status;
  const awaitingDecision = activeStatus === "user_review";

  async function decide(outcome: SpecDecisionOutcome) {
    if (outcome !== "approved" && !comment.trim()) return;
    if (await onDecision(outcome, comment.trim())) {
      setRecorded(outcome);
      setCommentDecision(null);
    }
  }

  return (
    <section className="spec-workspace-view">
      <div className="view-heading spec-heading">
        <div>
          <p className="eyebrow">PLANNING REVIEW</p>
          <h1>기획서 검토</h1>
          <p>LLM이 정리한 요구사항을 읽고, 사용자 결정으로 다음 단계를 여세요.</p>
        </div>
        <span className={workflow.counts.decisions > 0 ? "needs-action" : ""}>
          <strong>{workflow.counts.decisions}</strong><small>내 선택 대기</small>
        </span>
      </div>

      <div className="spec-filter-bar" role="tablist" aria-label="기획서 상태 필터">
        {([
          ["all", "전체"],
          ["draft", "작성 중"],
          ["user_review", "선택 대기"],
          ["decided", "결정됨"],
        ] as const).map(([key, label]) => (
          <button
            aria-selected={filter === key}
            className={filter === key ? "active" : ""}
            key={key}
            onClick={() => setFilter(key)}
            role="tab"
          >
            {label}<span>{countFor(workflow.items.specs, key)}</span>
          </button>
        ))}
      </div>

      <div className="spec-workspace-layout">
        <aside className="spec-list-panel" aria-label="기획서 목록">
          <header><strong>{filterLabel(filter)}</strong><small>{filtered.length}개 문서</small></header>
          <div>
            {filtered.map((item) => (
              <button
                aria-pressed={document?.summary.fileName === item.fileName}
                className={document?.summary.fileName === item.fileName ? "active" : ""}
                key={item.fileName}
                onClick={() => onSelect(item)}
              >
                <span className={`status-pill status-${item.status}`}>
                  {statusLabels[item.status] ?? item.status}
                </span>
                <strong>{item.title}</strong>
                <small>{item.id} · {formatDate(item.updatedAt)}</small>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="panel-empty compact"><Icon name="stamp" /><strong>해당 문서가 없습니다</strong><span>LLM이 기획서를 작성하면 여기에 나타납니다.</span></div>
            )}
          </div>
        </aside>

        <section className="spec-reader-panel">
          {loading && <div className="reader-loading">기획서를 불러오는 중…</div>}
          {!loading && !document && (
            <div className="reader-empty"><Icon name="stamp" /><strong>검토할 기획서를 선택하세요</strong><p>목록에서 문서를 선택하면 Markdown 원문과 결정 도구가 열립니다.</p></div>
          )}
          {document && (
            <>
              <header>
                <div><p className="eyebrow">{document.summary.id}</p><h2>{document.summary.title}</h2></div>
                <span className={`status-pill status-${activeStatus}`}>
                  {statusLabels[activeStatus ?? ""] ?? activeStatus}
                </span>
              </header>
              <article className="spec-paper embedded">
                <MarkdownBody body={document.body} />
                {recorded && (
                  <div className={`decision-stamp ${recorded}`} aria-live="polite">
                    <Icon name="stamp" />
                    <strong>{decisionLabels[recorded]}</strong>
                    <small>USER DECISION</small>
                  </div>
                )}
              </article>
            </>
          )}
        </section>

        <aside className="decision-panel">
          <p className="eyebrow">USER GATE</p>
          <h2>사용자 결정</h2>
          {!document && <p className="decision-help">기획서를 선택하면 승인·수정 요청·폐기 도구가 활성화됩니다.</p>}
          {document && awaitingDecision && !commentDecision && (
            <>
              <div className="decision-callout"><Icon name="stamp" /><strong>검토가 필요합니다</strong><p>이 결정은 별도 Markdown 감사 로그로 보존됩니다.</p></div>
              <button className="stamp-button full" disabled={busy} onClick={() => void decide("approved")}><Icon name="stamp" />승인 도장 찍기</button>
              <button className="secondary-button revision full" disabled={busy} onClick={() => setCommentDecision("revision_requested")}><Icon name="workflow" />수정 요청</button>
              <button className="secondary-button reject full" disabled={busy} onClick={() => setCommentDecision("rejected")}>기획서 폐기</button>
            </>
          )}
          {document && awaitingDecision && commentDecision && (
            <div className="rejection-form side">
              <label htmlFor="decision-comment">{commentDecision === "revision_requested" ? "수정 요청 내용" : "폐기 사유"}</label>
              <textarea
                autoFocus
                id="decision-comment"
                maxLength={2_000}
                onChange={(event) => setComment(event.target.value)}
                placeholder={commentDecision === "revision_requested" ? "다시 검토할 범위와 원하는 방향을 구체적으로 적어주세요." : "폐기 이유를 기록해 주세요."}
                value={comment}
              />
              <div><button className="text-button" onClick={() => setCommentDecision(null)}>취소</button><button className={commentDecision === "revision_requested" ? "secondary-button" : "danger-button"} disabled={busy || !comment.trim()} onClick={() => void decide(commentDecision)}>{commentDecision === "revision_requested" ? "수정 요청 기록" : "폐기 기록"}</button></div>
            </div>
          )}
          {document && !awaitingDecision && (
            <div className={`decision-result ${activeStatus}`}>
              <Icon name={activeStatus === "approved" ? "stamp" : activeStatus === "revision_requested" ? "workflow" : "archive"} />
              <strong>{activeStatus === "approved" ? "승인된 기획입니다" : activeStatus === "revision_requested" ? "수정을 요청한 기획입니다" : activeStatus === "rejected" ? "폐기된 기획입니다" : "아직 작성 중입니다"}</strong>
              <p>{recorded ? "결정 Markdown을 안전하게 저장했습니다." : activeStatus === "draft" ? "LLM이 status를 user_review로 변경하면 결정을 내릴 수 있습니다." : "결정 기록은 원문과 분리되어 보존됩니다."}</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function matchesFilter(item: WorkflowItemSummary, filter: SpecFilter) {
  if (filter === "all") return true;
  if (filter === "decided") return ["approved", "revision_requested", "rejected"].includes(item.status);
  return item.status === filter;
}

function countFor(items: WorkflowItemSummary[], filter: SpecFilter) {
  return items.filter((item) => matchesFilter(item, filter)).length;
}

function filterLabel(filter: SpecFilter) {
  return { all: "모든 기획서", draft: "작성 중", user_review: "내 선택 대기", decided: "결정된 기획서" }[filter];
}

function formatDate(value: string | null) {
  if (!value) return "시간 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(date);
}
