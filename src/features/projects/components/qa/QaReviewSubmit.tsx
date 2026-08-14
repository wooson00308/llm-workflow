import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  WorkGroupQaOutcome,
  WorkGroupQaSubmission,
  WorkGroupQaSubmissionResult,
  WorkGroupQaScenario,
  WorkGroupSummary,
} from "../../domain/types";
import type { QaReviewDraft, QaReviewDraftEntry } from "../../infrastructure/browserQaReviewDraftStore";
import { browserQaReviewDraftStore, createQaReviewRequestId } from "../../infrastructure/browserQaReviewDraftStore";

interface QaReviewTarget {
  item: WorkGroupQaScenario;
  entry: QaReviewDraftEntry;
  outcome: WorkGroupQaOutcome;
  stale: boolean;
}

interface Props {
  feature: WorkGroupSummary;
  workflowDirectory: string;
  onEditItem(scenarioId: string): void;
  onRecorded(): void;
  onScopeOpenChange(open: boolean): void;
  onSubmit(submission: WorkGroupQaSubmission): Promise<WorkGroupQaSubmissionResult | null>;
  scopeOpen: boolean;
  scopePanel: ReactNode;
}

/** 시나리오별 메모를 검토한 뒤 그룹 decision 하나를 원자적으로 기록한다. */
export function QaReviewSubmit({
  feature,
  workflowDirectory,
  onEditItem,
  onRecorded,
  onScopeOpenChange,
  onSubmit,
  scopeOpen,
  scopePanel,
}: Props) {
  const [draft, setDraft] = useState<QaReviewDraft>(
    () => browserQaReviewDraftStore.load(workflowDirectory, feature.id, feature.revision)
      ?? { startedAt: new Date().toISOString(), requestId: createQaReviewRequestId(), entries: {} },
  );
  const [submitting, setSubmitting] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [callFailed, setCallFailed] = useState(false);
  const headingRef = useRef<HTMLElement>(null);
  const commentRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const reopenRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const targets = useMemo(() => feature.scenarios.flatMap((item) => {
    const entry = draft.entries[item.id];
    if (!entry?.outcome) return [];
    return [{
      item,
      entry,
      outcome: entry.outcome,
      stale: entry.expectedUpdatedAt !== feature.updatedAt,
    } satisfies QaReviewTarget];
  }), [draft.entries, feature.scenarios, feature.updatedAt]);

  const revisionTargets = targets.filter((target) => target.outcome === "revision_requested");
  const confirmedTargets = targets.filter((target) => target.outcome === "confirmed");
  const staleTargets = targets.filter((target) => target.stale);

  function writeDraft(next: QaReviewDraft) {
    setDraft(next);
    browserQaReviewDraftStore.save(workflowDirectory, feature.id, feature.revision, next);
  }

  function changeEntry(target: QaReviewTarget, change: Partial<QaReviewDraftEntry>) {
    writeDraft({ ...draft, entries: { ...draft.entries, [target.item.id]: { ...target.entry, ...change } } });
  }

  function chooseOutcome(target: QaReviewTarget, outcome: WorkGroupQaOutcome) {
    setBlocked(null);
    changeEntry(target, { outcome });
  }

  async function submit() {
    setCallFailed(false);
    if (targets.length !== feature.scenarios.length) {
      setBlocked("모든 확인 항목에 결과를 남긴 뒤 제출해 주세요.");
      return;
    }
    if (staleTargets.length > 0) {
      setBlocked(`그룹 내용이 바뀐 뒤 다시 보지 않은 항목이 ${staleTargets.length}개 있습니다.`);
      reopenRefs.current.get(staleTargets[0].item.id)?.focus();
      return;
    }
    const missing = revisionTargets.find((target) => !target.entry.comment.trim());
    if (missing) {
      setBlocked(`재작업 요청에는 사유가 필요합니다. ${missing.item.title}의 사유를 적어 주세요.`);
      commentRefs.current.get(missing.item.id)?.focus();
      return;
    }

    setBlocked(null);
    setSubmitting(true);
    const result = await onSubmit({
      workflowDirectory,
      fileName: feature.fileName,
      expectedRevision: feature.revision,
      expectedUpdatedAt: feature.updatedAt,
      requestId: draft.requestId,
      entries: targets.map(({ item, entry, outcome }) => ({
        scenarioId: item.id,
        outcome,
        comment: entry.comment,
      })),
    });
    setSubmitting(false);

    if (!result) {
      setCallFailed(true);
      // 백엔드가 stale revision·시나리오·미검증 태스크를 거절하면 결정은 기록되지 않는다.
      // 임시 결과는 보존한 채 첫 항목으로 돌아가 최신 그룹을 다시 확인하게 한다.
      const firstScenario = feature.scenarios[0];
      if (firstScenario) onEditItem(firstScenario.id);
      return;
    }

    browserQaReviewDraftStore.clear(workflowDirectory, feature.id, feature.revision);
    onRecorded();
  }

  return (
    <section aria-label="제출 전 검토" className="qa-review" ref={headingRef} tabIndex={-1}>
      <div className="qa-review-main">
        <header className="qa-review-head">
          <div><p className="qa-review-kicker">마지막 단계</p><h2>최종 검토</h2><p>문제 항목을 먼저 확인하고 이 기능 전체에 한 번 기록하세요.</p></div>
        </header>

        {staleTargets.length > 0 && <p className="confirm-warning" role="status">그룹 내용이 바뀌었습니다. {staleTargets.length}개 항목을 다시 확인해야 제출할 수 있습니다.</p>}
        {blocked && <p className="confirm-warning" role="alert">{blocked}</p>}
        {callFailed && <p className="confirm-warning" role="alert">기록하지 못했습니다. 남긴 검토는 그대로 있으니 내용을 다시 확인한 뒤 재시도해 주세요.</p>}

        <QaReviewScenarioSection
          commentRefs={commentRefs.current}
          emptyText="문제가 기록된 항목이 없습니다."
          label="문제가 있는 항목"
          onChangeComment={(target, comment) => changeEntry(target, { comment })}
          onChooseOutcome={chooseOutcome}
          onEditItem={onEditItem}
          reopenRefs={reopenRefs.current}
          submitting={submitting}
          targets={revisionTargets}
          title={`문제 있음 ${revisionTargets.length}건`}
        />
        <QaReviewScenarioSection
          commentRefs={commentRefs.current}
          emptyText="확인 완료로 표시한 항목이 없습니다."
          label="확인한 항목"
          muted
          onChangeComment={(target, comment) => changeEntry(target, { comment })}
          onChooseOutcome={chooseOutcome}
          onEditItem={onEditItem}
          reopenRefs={reopenRefs.current}
          submitting={submitting}
          targets={confirmedTargets}
          title={`확인함 ${confirmedTargets.length}건`}
        />
      </div>

      <aside aria-label="최종 결정" className="qa-review-decision">
        <div className="qa-review-totals" aria-label="검토 결과 요약">
          <span className={revisionTargets.length > 0 ? "has-revision" : ""}>문제 {revisionTargets.length}</span>
          <span>확인 {confirmedTargets.length}</span>
        </div>
        <p className="qa-review-outcome">{revisionTargets.length > 0 ? "하나 이상의 문제가 있어 이 기능 전체가 재작업으로 돌아갑니다." : "모든 확인 결과를 이 기능의 승인으로 기록합니다."}</p>
        <button
          aria-expanded={scopeOpen}
          className="text-button qa-review-scope-toggle"
          onClick={() => onScopeOpenChange(!scopeOpen)}
          type="button"
        >
          {scopeOpen ? "기능 설명 닫기" : "기능 설명 보기"}
        </button>
        {scopeOpen && <div className="qa-review-scope-panel">{scopePanel}</div>}
        <footer className="qa-review-footer">
          <button className="stamp-button" disabled={submitting || targets.length === 0} onClick={() => void submit()} type="button">
            {submitting ? "기록하는 중…" : revisionTargets.length > 0 ? "재작업 요청 기록하기" : "기능 승인 기록하기"}
          </button>
        </footer>
      </aside>
    </section>
  );
}

function QaReviewScenarioSection({
  commentRefs,
  emptyText,
  label,
  muted = false,
  onChangeComment,
  onChooseOutcome,
  onEditItem,
  reopenRefs,
  submitting,
  targets,
  title,
}: {
  commentRefs: Map<string, HTMLTextAreaElement>;
  emptyText: string;
  label: string;
  muted?: boolean;
  onChangeComment(target: QaReviewTarget, comment: string): void;
  onChooseOutcome(target: QaReviewTarget, outcome: WorkGroupQaOutcome): void;
  onEditItem(scenarioId: string): void;
  reopenRefs: Map<string, HTMLButtonElement>;
  submitting: boolean;
  targets: QaReviewTarget[];
  title: string;
}) {
  return (
    <section aria-label={label} className={`qa-review-section ${muted ? "qa-review-section-muted" : ""}`}>
      <h3>{title}</h3>
      {targets.length === 0 ? <p className="qa-review-empty">{emptyText}</p> : (
        <ul className="qa-review-list">
          {targets.map((target) => (
            <li key={target.item.id}>
              <details className="qa-review-row" open={!muted || target.stale}>
                <summary>
                  <span className="qa-review-title">{target.item.title}</span>
                  <span className={`qa-review-summary-state ${target.outcome === "revision_requested" ? "revision" : ""}`}>
                    {target.outcome === "revision_requested" ? "문제 있음" : "확인함"}
                  </span>
                </summary>
                <div className="qa-review-row-body">
                  {target.stale && <p className="qa-review-state" role="status">다시 확인 필요 · 작업 그룹 내용이 바뀌었습니다.</p>}
                  <div className="qa-review-choices">
                    <button aria-pressed={target.outcome === "confirmed"} className="qa-review-choice" disabled={submitting} onClick={() => onChooseOutcome(target, "confirmed")} type="button">확인함</button>
                    <button aria-pressed={target.outcome === "revision_requested"} className="qa-review-choice" disabled={submitting} onClick={() => onChooseOutcome(target, "revision_requested")} type="button">문제 있음</button>
                    <button
                      className="text-button"
                      onClick={() => onEditItem(target.item.id)}
                      ref={(node) => { if (node) reopenRefs.set(target.item.id, node); else reopenRefs.delete(target.item.id); }}
                      type="button"
                    >이 항목 다시 보기</button>
                  </div>
                  <span className="qa-review-comment-label">메모</span>
                  <textarea
                    aria-label={`${target.item.title} 메모`}
                    disabled={submitting}
                    maxLength={2_000}
                    onChange={(event) => onChangeComment(target, event.target.value)}
                    placeholder={target.outcome === "revision_requested" ? "무엇이 기대와 달랐는지" : "남길 말이 있으면 적습니다"}
                    ref={(node) => { if (node) commentRefs.set(target.item.id, node); else commentRefs.delete(target.item.id); }}
                    value={target.entry.comment}
                  />
                  {target.outcome === "revision_requested" && !target.entry.comment.trim() && <p className="qa-review-state" role="status">사유를 적어야 제출할 수 있습니다.</p>}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
