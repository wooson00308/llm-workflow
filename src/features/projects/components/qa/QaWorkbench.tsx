import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkGroupQaSubmission, WorkGroupQaSubmissionResult, WorkGroupSummary, WorkflowSummary } from "../../domain/types";
import { browserQaReviewDraftStore } from "../../infrastructure/browserQaReviewDraftStore";
import { QaFlowReview } from "./QaFlowReview";
import "./QaWorkbench.css";

interface Props {
  workflow: WorkflowSummary;
  initialFeatureKey?: string | null;
  onSubmit(submission: WorkGroupQaSubmission): Promise<WorkGroupQaSubmissionResult | null>;
}

/** 작업 그룹의 통합 QA 플로우를 보여 주고 그룹 전체에 결정 하나를 기록하는 품질 확인 작업대. */
export function QaWorkbench({ initialFeatureKey = null, onSubmit, workflow }: Props) {
  const [openedKey, setOpenedKey] = useState<string | null>(initialFeatureKey);
  const groups = workflow.items.workGroups;
  const ready = useMemo(
    () => groups.filter((group) => group.qaMode === "user" && group.displayStatus === "qa_ready"),
    [groups],
  );
  const upcoming = useMemo(
    () => groups.filter((group) => group.qaMode === "user" && !["qa_ready", "completed"].includes(group.displayStatus)),
    [groups],
  );

  useEffect(() => {
    setOpenedKey(initialFeatureKey);
  }, [initialFeatureKey]);

  function leaveFeature() {
    setOpenedKey(null);
  }

  const startedKeys = useMemo(() => {
    void openedKey;
    const started = new Set<string>();
    for (const group of ready) {
      const draft = browserQaReviewDraftStore.load(workflow.directory, group.id, group.revision);
      if (draft && Object.keys(draft.entries).length > 0) started.add(group.id);
    }
    return started;
  }, [openedKey, ready, workflow.directory]);

  const opened = ready.find((group) => group.id === openedKey) ?? null;
  const held = opened ? null : groups.find((group) => group.id === openedKey) ?? null;

  if (opened) {
    return (
      <QaFeatureFrame feature={opened} onBack={leaveFeature}>
        <QaFlowReview
          feature={opened}
          key={`${workflow.directory}:${opened.id}:${opened.revision}:${opened.qaBaseCommit ?? ""}`}
          onRecorded={leaveFeature}
          onSubmit={onSubmit}
          workflowDirectory={workflow.directory}
        />
      </QaFeatureFrame>
    );
  }

  if (held) return <QaFeatureHeld feature={held} onBack={leaveFeature} />;

  const nothingToShow = ready.length === 0 && upcoming.length === 0;
  return (
    <section className="qa-workbench">
      <div className="view-heading">
        <div><p className="eyebrow">USER QA</p><h1>품질 확인</h1><p>모든 작업이 끝난 기능만 확인합니다.</p></div>
        <span><strong>{ready.length}</strong><small>확인 가능</small></span>
      </div>

      {nothingToShow ? <p className="qa-queue-empty">지금 확인할 기능도 준비 중인 기능도 없습니다.</p> : (
        <div className="qa-queue-layout">
          <section aria-label="지금 확인할 기능" className="qa-queue-section">
            <header><h2>지금 확인할 기능</h2><p>기능을 구성하는 모든 작업이 끝났습니다.</p></header>
            {ready.length > 0 ? (
              <ul className="qa-queue-list">
                {ready.map((group) => (
                  <li key={group.id}>
                    <button className="qa-queue-row" onClick={() => setOpenedKey(group.id)} type="button">
                      <span className="qa-queue-main">
                        <span className="qa-queue-title">{group.title}</span>
                        {group.description && <span className="qa-queue-goal">{group.description}</span>}
                      </span>
                      <span className="qa-queue-state">{startedKeys.has(group.id) ? "계속" : "시작"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="qa-queue-empty">지금 확인할 기능이 없습니다.</p>}
          </section>

          <section aria-label="준비 중인 기능" className="qa-queue-section qa-queue-section-upcoming">
            <header><h2>준비 중인 기능</h2><p>아키텍트 구성이나 AI 작업이 끝나면 품질 확인을 요청합니다.</p></header>
            {upcoming.length > 0 ? (
              <ul className="qa-queue-list">
                {upcoming.map((group) => (
                  <li className="qa-queue-row qa-queue-row-upcoming" key={group.id}>
                    <span className="qa-queue-main">
                      <span className="qa-queue-title">{group.title}</span>
                    </span>
                    <span className="qa-queue-counts"><span>{groupStatusLabel(group.displayStatus)}</span></span>
                  </li>
                ))}
              </ul>
            ) : <p className="qa-queue-empty">준비 중인 기능이 없습니다.</p>}
          </section>
        </div>
      )}
    </section>
  );
}

/** 열린 기능의 공통 틀: 돌아가기, 제목, 기능 설명 한 단락. 설명은 토글 없이 항상 보인다. */
function QaFeatureFrame({ children, feature, onBack }: {
  children?: ReactNode;
  feature: WorkGroupSummary;
  onBack(): void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { backRef.current?.focus(); }, []);

  return (
    <section className="qa-feature-scope qa-feature-scope-session">
      <header className="qa-feature-session-head">
        <button className="text-button qa-scope-back" onClick={onBack} ref={backRef} type="button">← 목록으로 돌아가기</button>
        <div>
          <p className="qa-feature-kicker">품질 확인</p>
          <h1>{feature.title}</h1>
          {feature.description && <p className="qa-feature-goal">{feature.description}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function QaFeatureHeld({ feature, onBack }: { feature: WorkGroupSummary; onBack(): void }) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { backRef.current?.focus(); }, []);
  return (
    <section className="qa-feature-scope">
      <button className="text-button qa-scope-back" onClick={onBack} ref={backRef} type="button">← 목록으로 돌아가기</button>
      <div className="view-heading"><div><p className="qa-feature-kicker">{groupStatusLabel(feature.displayStatus)}</p><h1>{feature.title}</h1></div></div>
      <section aria-label="준비 중인 이유" className="qa-scope-block">
        <h2>지금은 확인할 수 없습니다</h2>
        <p>이 기능이 {groupStatusLabel(feature.displayStatus)} 상태로 바뀌었습니다. 남긴 임시 결정은 삭제하지 않았으며, 다시 확인할 수 있게 되면 새 상태에서 시작합니다.</p>
      </section>
    </section>
  );
}

function groupStatusLabel(status: WorkGroupSummary["displayStatus"]) {
  return {
    completed: "완료",
    rework: "아키텍트 재분류 대기",
    preparing: "아키텍트 구성 중",
    preparing_stalled: "구성 중단 의심",
    blocked: "개발 막힘",
    developing: "개발 중",
    qa_ready: "사용자 QA 대기",
    automatic_completed: "완료",
    configuration_error: "구성 확인 필요",
  }[status];
}
