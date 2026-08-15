import { useMemo, useState } from "react";
import type {
  WorkGroupQaOutcome,
  WorkGroupQaSubmission,
  WorkGroupQaSubmissionResult,
  WorkGroupSummary,
} from "../../domain/types";
import type { QaReviewDraft } from "../../infrastructure/browserQaReviewDraftStore";
import { browserQaReviewDraftStore, createQaReviewRequestId } from "../../infrastructure/browserQaReviewDraftStore";
import { MarkdownBody } from "../MarkdownBody";

interface Props {
  feature: WorkGroupSummary;
  workflowDirectory: string;
  onRecorded(): void;
  onSubmit(submission: WorkGroupQaSubmission): Promise<WorkGroupQaSubmissionResult | null>;
}

/**
 * 아키텍트가 그룹 생성 시점에 적어 둔 통합 QA 플로우를 한 페이지로 보여 주고,
 * 기능 전체에 결정 하나(승인 또는 재작업 요청)를 기록한다. 항목별 확인은 없다.
 */
export function QaFlowReview({ feature, workflowDirectory, onRecorded, onSubmit }: Props) {
  const stored = useMemo(
    () => browserQaReviewDraftStore.load(workflowDirectory, feature.id, feature.revision),
    [feature.id, feature.revision, workflowDirectory],
  );
  // 저장해 둔 임시 결정은 그룹 내용이 그대로일 때만 물려받는다. 내용이 바뀌었으면 처음부터 다시 본다.
  const fresh = useMemo(() => {
    const entries = stored ? Object.values(stored.entries) : [];
    return entries.length > 0 && entries.every((entry) => entry.expectedUpdatedAt === feature.updatedAt)
      ? entries[0]
      : null;
  }, [feature.updatedAt, stored]);
  const [requestId] = useState(() => stored?.requestId ?? createQaReviewRequestId());
  const [startedAt] = useState(() => stored?.startedAt ?? new Date().toISOString());
  const [outcome, setOutcome] = useState<WorkGroupQaOutcome | null>(fresh?.outcome ?? null);
  const [comment, setComment] = useState(fresh?.comment ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [callFailed, setCallFailed] = useState(false);
  const staleDraftDropped = Boolean(stored) && !fresh;

  function writeDraft(nextOutcome: WorkGroupQaOutcome | null, nextComment: string) {
    const draft: QaReviewDraft = {
      startedAt,
      requestId,
      entries: Object.fromEntries(feature.scenarios.map((scenario) => [scenario.id, {
        outcome: nextOutcome,
        comment: nextComment,
        expectedUpdatedAt: feature.updatedAt,
      }])),
    };
    browserQaReviewDraftStore.save(workflowDirectory, feature.id, feature.revision, draft);
  }

  function chooseOutcome(next: WorkGroupQaOutcome) {
    setBlocked(null);
    setOutcome(next);
    writeDraft(next, comment);
  }

  function changeComment(next: string) {
    setBlocked(null);
    setComment(next);
    writeDraft(outcome, next);
  }

  async function submit() {
    setCallFailed(false);
    if (!outcome) {
      setBlocked("확인 결과를 먼저 선택해 주세요.");
      return;
    }
    if (outcome === "revision_requested" && !comment.trim()) {
      setBlocked("재작업 요청에는 무엇이 기대와 달랐는지 설명이 필요합니다.");
      return;
    }

    setBlocked(null);
    setSubmitting(true);
    const result = await onSubmit({
      workflowDirectory,
      fileName: feature.fileName,
      expectedRevision: feature.revision,
      expectedUpdatedAt: feature.updatedAt,
      requestId,
      entries: feature.scenarios.map((scenario) => ({
        scenarioId: scenario.id,
        outcome,
        comment,
      })),
    });
    setSubmitting(false);

    if (!result) {
      // 백엔드가 stale revision이나 바뀐 구성을 거절하면 결정은 기록되지 않는다. 임시 결정은 남긴다.
      setCallFailed(true);
      return;
    }

    browserQaReviewDraftStore.clear(workflowDirectory, feature.id, feature.revision);
    onRecorded();
  }

  return (
    <section aria-label="품질 확인 플로우" className="qa-flow-layout">
      <div aria-label="확인 플로우" className="qa-flow" role="region">
        {staleDraftDropped && (
          <p className="confirm-warning" role="status">기능 내용이 바뀌어 남겨 둔 임시 결정을 비웠습니다. 아래 플로우를 처음부터 다시 확인해 주세요.</p>
        )}
        {feature.scenarios.length === 0 && (
          <p className="qa-flow-empty">확인 플로우가 준비되지 않았습니다. 아키텍트가 그룹을 구성할 때 함께 작성합니다.</p>
        )}
        {feature.scenarios.map((scenario) => (
          <section className="qa-flow-section" key={scenario.id}>
            <h2>{scenario.title}</h2>
            {scenario.body.trim()
              ? <MarkdownBody body={scenario.body} />
              : <p className="qa-flow-empty">확인할 내용이 비어 있습니다.</p>}
          </section>
        ))}
      </div>

      <aside aria-label="최종 결정" className="qa-review-decision">
        <p className="qa-decision-question">이 기능은 기대대로 동작하나요?</p>
        <div className="qa-decision-choices">
          <button
            aria-pressed={outcome === "confirmed"}
            className="secondary-button qa-decision-confirm"
            disabled={submitting}
            onClick={() => chooseOutcome("confirmed")}
            type="button"
          >기대대로 동작함</button>
          <button
            aria-pressed={outcome === "revision_requested"}
            className="secondary-button qa-decision-revision"
            disabled={submitting}
            onClick={() => chooseOutcome("revision_requested")}
            type="button"
          >문제 있음</button>
        </div>

        {(outcome === "revision_requested" || comment.trim() !== "") && (
          <div className="qa-decision-note">
            <label htmlFor="qa-flow-comment">{outcome === "revision_requested" ? "문제 설명" : "메모"}</label>
            <textarea
              disabled={submitting}
              id="qa-flow-comment"
              maxLength={2_000}
              onChange={(event) => changeComment(event.target.value)}
              placeholder="무엇이 기대와 달랐는지 적어주세요"
              value={comment}
            />
          </div>
        )}

        {blocked && <p className="confirm-warning" role="alert">{blocked}</p>}
        {callFailed && <p className="confirm-warning" role="alert">기록하지 못했습니다. 남긴 결정은 그대로 있으니 잠시 뒤 다시 시도해 주세요.</p>}

        <p className="qa-review-outcome">
          {outcome === "revision_requested"
            ? "이 기능 전체가 재작업으로 돌아갑니다."
            : outcome === "confirmed"
              ? "이 기능을 승인으로 기록합니다."
              : "결과를 선택하면 기록할 수 있습니다."}
        </p>
        <footer className="qa-review-footer">
          <button
            className="stamp-button"
            disabled={submitting || outcome === null}
            onClick={() => void submit()}
            type="button"
          >
            {submitting ? "기록하는 중…" : outcome === "revision_requested" ? "재작업 요청 기록하기" : "기능 승인 기록하기"}
          </button>
          <p className="qa-review-note">결정은 이 기능 전체에 한 번 기록됩니다. 제출 전까지는 이 기기에만 저장됩니다.</p>
        </footer>
      </aside>
    </section>
  );
}
