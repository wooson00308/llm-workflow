import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useArmedConfirm } from "../../../../shared/ui/useArmedConfirm";
import type { WorkGroupQaScenario, WorkGroupSummary } from "../../domain/types";
import type { QaReviewDraft, QaReviewDraftEntry } from "../../infrastructure/browserQaReviewDraftStore";
import { browserQaReviewDraftStore, createQaReviewRequestId } from "../../infrastructure/browserQaReviewDraftStore";
import { MarkdownBody } from "../MarkdownBody";

type QaItemState = "unchecked" | "confirmed" | "revision_requested" | "recheck";
type QaAuxiliaryMode = "scope" | "list" | null;

const ITEM_STATE_LABEL: Record<QaItemState, string> = {
  unchecked: "확인 전",
  confirmed: "확인함",
  revision_requested: "문제 있음",
  recheck: "다시 확인 필요",
};

/** 앱을 실행하는 동안 그룹 revision별로 마지막에 보던 시나리오를 기억한다. */
const lastViewedItems = new Map<string, string>();

interface Props {
  auxiliaryMode: QaAuxiliaryMode;
  feature: WorkGroupSummary;
  onAuxiliaryModeChange(mode: QaAuxiliaryMode): void;
  workflowDirectory: string;
  onReview(): void;
  scopePanel: ReactNode;
  startScenarioId?: string | null;
}

/** 아키텍트가 그룹에 적은 사용자 시나리오만 한 항목씩 확인하는 화면. */
export function QaSessionView({
  auxiliaryMode,
  feature,
  onAuxiliaryModeChange,
  workflowDirectory,
  onReview,
  scopePanel,
  startScenarioId,
}: Props) {
  const memoryKey = `${workflowDirectory}\n${feature.id}\n${feature.revision}`;
  const [draft, setDraft] = useState<QaReviewDraft>(
    () => browserQaReviewDraftStore.load(workflowDirectory, feature.id, feature.revision) ?? newDraft(),
  );
  const items = feature.scenarios;
  const [currentScenarioId, setCurrentScenarioId] = useState(
    () => resumeScenarioId(items, draft, memoryKey, startScenarioId),
  );
  const [noteOpen, setNoteOpen] = useState(false);
  const [revisionIntent, setRevisionIntent] = useState<ReadonlySet<string>>(new Set());
  const panelRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const firstRender = useRef(!startScenarioId);
  const discard = useArmedConfirm();

  const currentIndex = Math.max(0, items.findIndex((item) => item.id === currentScenarioId));
  const current = items[currentIndex];
  const states = useMemo(() => {
    const map = new Map<string, QaItemState>();
    for (const item of items) map.set(item.id, itemState(feature, draft.entries[item.id]));
    return map;
  }, [draft.entries, feature, items]);
  const recorded = [...states.values()].filter((state) => state === "confirmed" || state === "revision_requested").length;
  const savedCount = Object.keys(draft.entries).length;
  const withoutOutcome = items.filter((item) => {
    const entry = draft.entries[item.id];
    return !entry?.outcome || entry.expectedUpdatedAt !== feature.updatedAt;
  }).length;

  useEffect(() => {
    if (currentScenarioId) lastViewedItems.set(memoryKey, currentScenarioId);
  }, [currentScenarioId, memoryKey]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setNoteOpen(false);
    if (contentRef.current) contentRef.current.scrollTop = 0;
    panelRef.current?.focus();
  }, [currentScenarioId]);

  useEffect(() => {
    if (noteOpen) commentRef.current?.focus();
  }, [noteOpen]);

  function writeDraft(next: QaReviewDraft) {
    setDraft(next);
    browserQaReviewDraftStore.save(workflowDirectory, feature.id, feature.revision, next);
  }

  function withEntry(item: WorkGroupQaScenario, change: Partial<QaReviewDraftEntry>): QaReviewDraft {
    const previous = draft.entries[item.id] ?? {
      outcome: null,
      comment: "",
      expectedUpdatedAt: feature.updatedAt,
    };
    return {
      ...draft,
      entries: {
        ...draft.entries,
        [item.id]: { ...previous, expectedUpdatedAt: feature.updatedAt, ...change },
      },
    };
  }

  function chooseConfirmed(item: WorkGroupQaScenario) {
    setRevisionIntent(without(revisionIntent, item.id));
    writeDraft(withEntry(item, { outcome: "confirmed" }));
    const next = items[currentIndex + 1];
    if (next) setCurrentScenarioId(next.id);
  }

  function chooseRevision(item: WorkGroupQaScenario) {
    setRevisionIntent(new Set(revisionIntent).add(item.id));
    setNoteOpen(true);
    const comment = draft.entries[item.id]?.comment ?? "";
    writeDraft(withEntry(item, { outcome: comment.trim() ? "revision_requested" : null }));
  }

  function changeComment(item: WorkGroupQaScenario, comment: string) {
    const entry = draft.entries[item.id];
    const wantsRevision = revisionIntent.has(item.id) || entry?.outcome === "revision_requested";
    const outcome = wantsRevision ? (comment.trim() ? "revision_requested" : null) : entry?.outcome ?? null;
    writeDraft(withEntry(item, { comment, outcome }));
  }

  function discardDraft() {
    browserQaReviewDraftStore.clear(workflowDirectory, feature.id, feature.revision);
    setDraft(newDraft());
    setRevisionIntent(new Set());
  }

  function move(step: number) {
    const next = items[currentIndex + step];
    if (next) setCurrentScenarioId(next.id);
  }

  function toggleAuxiliary(mode: Exclude<QaAuxiliaryMode, null>) {
    onAuxiliaryModeChange(auxiliaryMode === mode ? null : mode);
  }

  if (!current) {
    return <p className="qa-queue-empty">사용자가 확인할 시나리오가 준비되지 않았습니다.</p>;
  }

  const entry = draft.entries[current.id];
  const wantsRevision = revisionIntent.has(current.id) || entry?.outcome === "revision_requested";
  const showComment = noteOpen || wantsRevision || Boolean(entry?.comment);

  return (
    <section aria-label="항목 확인" className="qa-session">
      <header className="qa-session-bar">
        <div className="qa-session-bar-main"><p className="qa-session-kicker">검토 진행</p><h2>{currentIndex + 1} / {items.length}</h2></div>
        <div className="qa-session-progress-wrap">
          <p className="qa-session-progress" role="status">{recorded}개 완료 · {items.length - recorded}개 남음</p>
          <progress aria-label="확인 진행률" max={items.length} value={recorded} />
        </div>
        <div className="qa-session-bar-actions">
          <button
            aria-expanded={auxiliaryMode === "scope"}
            className="text-button qa-session-scope-toggle"
            onClick={() => toggleAuxiliary("scope")}
            type="button"
          >
            {auxiliaryMode === "scope" ? "기능 설명 닫기" : "기능 설명 보기"}
          </button>
          <button
            aria-expanded={auxiliaryMode === "list"}
            className="secondary-button qa-session-list-toggle"
            onClick={() => toggleAuxiliary("list")}
            type="button"
          >
            {auxiliaryMode === "list" ? "목록 닫기" : `항목 목록 ${items.length}`}
          </button>
        </div>
      </header>

      {auxiliaryMode && (
        <div className="qa-session-auxiliary">
          {auxiliaryMode === "scope" ? scopePanel : (
            <section aria-label="확인 항목" className="qa-session-index">
              <header><h3>항목 선택</h3></header>
              <div className="qa-session-index-groups">
                <ul className="qa-item-list">
                  {items.map((item, index) => (
                    <QaItemRow
                      current={item.id === current.id}
                      index={index + 1}
                      item={item}
                      key={item.id}
                      onOpen={() => { setCurrentScenarioId(item.id); onAuxiliaryModeChange(null); }}
                      state={states.get(item.id) ?? "unchecked"}
                    />
                  ))}
                </ul>
              </div>
            </section>
          )}
        </div>
      )}

      <div className="qa-session-body">
        <article aria-label="현재 항목" className="qa-session-current" ref={panelRef} tabIndex={-1}>
          <header className="qa-current-header">
            <div className="qa-current-meta">
              <span>항목 {currentIndex + 1} / {items.length}</span>
              <span className={`qa-current-state qa-state-${states.get(current.id) ?? "unchecked"}`}>
                {ITEM_STATE_LABEL[states.get(current.id) ?? "unchecked"]}
              </span>
            </div>
            <h3>{current.title}</h3>
          </header>

          <div className="qa-current-content" ref={contentRef}>
            <section aria-label="화면에서 확인할 내용" className="qa-current-walkthrough">
              {current.body.trim()
                ? <MarkdownBody body={current.body} />
                : <p className="qa-current-note">화면에서 확인할 내용이 준비되지 않았습니다.</p>}
            </section>
          </div>

          <section aria-label="이 항목의 결과" className="qa-current-outcome">
            <div className="qa-outcome-heading">
              <p className="qa-outcome-label">이 항목은 기대대로 동작하나요?</p>
              {!showComment && <button className="text-button" onClick={() => setNoteOpen(true)} type="button">메모 추가</button>}
            </div>
            <div className="qa-outcome-actions">
              <button
                aria-pressed={entry?.outcome === "confirmed"}
                className="stamp-button qa-outcome-confirm"
                onClick={() => chooseConfirmed(current)}
                type="button"
              >
                {currentIndex === items.length - 1 ? "확인 완료" : "확인하고 다음"}
              </button>
              <button
                aria-pressed={wantsRevision}
                className="secondary-button qa-outcome-revision"
                onClick={() => chooseRevision(current)}
                type="button"
              >문제 있음</button>
            </div>

            {showComment && (
              <div className="qa-outcome-note">
                <label htmlFor="qa-item-comment">{wantsRevision ? "문제 설명" : "메모"}</label>
                <textarea
                  id="qa-item-comment"
                  maxLength={2_000}
                  onChange={(event) => changeComment(current, event.target.value)}
                  placeholder={wantsRevision ? "무엇이 기대와 달랐는지 적어주세요" : "남길 말이 있으면 적습니다"}
                  ref={commentRef}
                  value={entry?.comment ?? ""}
                />
                {wantsRevision && !(entry?.comment ?? "").trim() && (
                  <p className="qa-current-note" role="status">문제를 기록하려면 설명이 필요합니다.</p>
                )}
              </div>
            )}
          </section>

          <nav aria-label="항목 이동" className="qa-current-move">
            <button className="text-button" disabled={currentIndex === 0} onClick={() => move(-1)} type="button">이전 항목</button>
            <span>{currentIndex + 1} / {items.length}</span>
            <button className="text-button" disabled={currentIndex === items.length - 1} onClick={() => move(1)} type="button">다음 항목</button>
          </nav>
        </article>
      </div>

      <footer className="qa-session-footer">
        <p>결과는 이 기기에 임시 저장됩니다.</p>
        {withoutOutcome > 0 && <p className="qa-session-gate" role="status">{withoutOutcome}개를 더 확인하면 최종 검토로 넘어갈 수 있습니다.</p>}
        {withoutOutcome === 0 && <button className="stamp-button qa-session-review-button" onClick={onReview} type="button">최종 검토로 이동</button>}
        <button
          className={`text-button ${discard.armed ? "armed" : ""}`}
          disabled={savedCount === 0}
          onClick={() => discard.fire(discardDraft)}
          type="button"
        >{discard.armed ? "한 번 더 누르면 버리기" : "임시 검토 버리기"}</button>
        {discard.armed && <p className="confirm-warning" role="status">{feature.title}에 남긴 항목 {savedCount}개가 사라집니다.</p>}
      </footer>
    </section>
  );
}

function QaItemRow({ current, index, item, onOpen, state }: {
  current: boolean;
  index: number;
  item: WorkGroupQaScenario;
  onOpen(): void;
  state: QaItemState;
}) {
  return (
    <li>
      <button aria-current={current} className={`qa-item-row ${current ? "current" : ""}`} onClick={onOpen} type="button">
        <span aria-hidden="true" className="qa-item-number">{index}</span>
        <span className="qa-item-copy">
          <span className="qa-item-title">{item.title}</span>
          <span className={`qa-item-state qa-state-${state}`}>{ITEM_STATE_LABEL[state]}</span>
        </span>
      </button>
    </li>
  );
}

function newDraft(): QaReviewDraft {
  return { startedAt: new Date().toISOString(), requestId: createQaReviewRequestId(), entries: {} };
}

function itemState(feature: WorkGroupSummary, entry: QaReviewDraftEntry | undefined): QaItemState {
  if (!entry) return "unchecked";
  if (entry.expectedUpdatedAt !== feature.updatedAt) return "recheck";
  if (entry.outcome === "confirmed") return "confirmed";
  if (entry.outcome === "revision_requested") return "revision_requested";
  return "unchecked";
}

function resumeScenarioId(
  items: WorkGroupQaScenario[],
  draft: QaReviewDraft,
  memoryKey: string,
  startScenarioId?: string | null,
) {
  if (startScenarioId && items.some((item) => item.id === startScenarioId)) return startScenarioId;
  const remembered = lastViewedItems.get(memoryKey);
  if (remembered && items.some((item) => item.id === remembered)) return remembered;
  return (items.find((item) => !draft.entries[item.id]?.outcome) ?? items[0])?.id ?? "";
}

function without(source: ReadonlySet<string>, value: string) {
  const next = new Set(source);
  next.delete(value);
  return next;
}
