import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkGroupQaSubmission, WorkGroupQaSubmissionResult, WorkGroupSummary, WorkflowSummary } from "../../domain/types";
import { browserQaReviewDraftStore } from "../../infrastructure/browserQaReviewDraftStore";
import { QaReviewSubmit } from "./QaReviewSubmit";
import { QaSessionView } from "./QaSessionView";
import "./QaWorkbench.css";

interface Props {
  workflow: WorkflowSummary;
  initialFeatureKey?: string | null;
  onSubmit(submission: WorkGroupQaSubmission): Promise<WorkGroupQaSubmissionResult | null>;
}

export type QaAuxiliaryMode = "scope" | "list" | null;

/** 작업 그룹의 사용자 시나리오만 보여 주고 그룹 전체에 결정 하나를 기록하는 품질 확인 작업대. */
export function QaWorkbench({ initialFeatureKey = null, onSubmit, workflow }: Props) {
  const [openedKey, setOpenedKey] = useState<string | null>(initialFeatureKey);
  const [reviewing, setReviewing] = useState(false);
  const [editScenarioId, setEditScenarioId] = useState<string | null>(null);
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
    setReviewing(false);
    setEditScenarioId(null);
  }, [initialFeatureKey]);

  function leaveFeature() {
    setOpenedKey(null);
    setReviewing(false);
    setEditScenarioId(null);
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
      <QaFeatureScope feature={opened} onBack={leaveFeature}>
        {({ auxiliaryMode, onAuxiliaryModeChange, scopePanel }) => reviewing ? (
          <QaReviewSubmit
            feature={opened}
            onEditItem={(scenarioId) => {
              onAuxiliaryModeChange(null);
              setEditScenarioId(scenarioId);
              setReviewing(false);
            }}
            onRecorded={leaveFeature}
            onScopeOpenChange={(open) => onAuxiliaryModeChange(open ? "scope" : null)}
            onSubmit={onSubmit}
            scopeOpen={auxiliaryMode === "scope"}
            scopePanel={scopePanel}
            workflowDirectory={workflow.directory}
          />
        ) : (
          <QaSessionView
            auxiliaryMode={auxiliaryMode}
            feature={opened}
            key={`${workflow.directory}:${opened.id}:${opened.revision}`}
            onAuxiliaryModeChange={onAuxiliaryModeChange}
            onReview={() => {
              onAuxiliaryModeChange(null);
              setEditScenarioId(null);
              setReviewing(true);
            }}
            scopePanel={scopePanel}
            startScenarioId={editScenarioId}
            workflowDirectory={workflow.directory}
          />
        )}
      </QaFeatureScope>
    );
  }

  if (held) return <QaFeatureHeld feature={held} onBack={leaveFeature} />;

  const nothingToShow = ready.length === 0 && upcoming.length === 0;
  return (
    <section className="qa-workbench">
      <div className="view-heading">
        <div><p className="eyebrow">USER QA</p><h1>품질 확인</h1><p>모든 AI 검증이 끝난 기능만 확인합니다.</p></div>
        <span><strong>{ready.length}</strong><small>확인 가능</small></span>
      </div>

      {nothingToShow ? <p className="qa-queue-empty">지금 확인할 기능도 준비 중인 기능도 없습니다.</p> : (
        <div className="qa-queue-layout">
          <section aria-label="지금 확인할 기능" className="qa-queue-section">
            <header><h2>지금 확인할 기능</h2><p>기능을 구성하는 모든 구현과 AI 검증이 끝났습니다.</p></header>
            {ready.length > 0 ? (
              <ul className="qa-queue-list">
                {ready.map((group) => (
                  <li key={group.id}>
                    <button className="qa-queue-row" onClick={() => setOpenedKey(group.id)} type="button">
                      <span className="qa-queue-main">
                        <span className="qa-queue-title">{group.title}</span>
                        {group.description && <span className="qa-queue-goal">{group.description}</span>}
                        <span className="qa-queue-counts"><span>직접 확인 {group.scenarios.length}개</span></span>
                      </span>
                      <span className="qa-queue-state">{startedKeys.has(group.id) ? "계속" : "시작"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="qa-queue-empty">지금 확인할 기능이 없습니다.</p>}
          </section>

          <section aria-label="준비 중인 기능" className="qa-queue-section">
            <header><h2>준비 중인 기능</h2><p>아키텍트 구성이나 AI 작업이 끝나면 품질 확인을 요청합니다.</p></header>
            {upcoming.length > 0 ? (
              <ul className="qa-queue-list">
                {upcoming.map((group) => (
                  <li className="qa-queue-row qa-queue-row-upcoming" key={group.id}>
                    <span className="qa-queue-main">
                      <span className="qa-queue-title">{group.title}</span>
                      <span className="qa-queue-counts"><span>{groupStatusLabel(group.displayStatus)}</span></span>
                    </span>
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

function QaFeatureScope({ children, feature, onBack }: {
  children?: ReactNode | ((controls: QaFeatureScopeControls) => ReactNode);
  feature: WorkGroupSummary;
  onBack(): void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  const [auxiliaryMode, setAuxiliaryMode] = useState<QaAuxiliaryMode>(null);

  useEffect(() => { backRef.current?.focus(); }, []);

  const scopePanel = (
    <section aria-label="기능 설명과 전체 확인 범위" className="qa-scope-overview">
      <header><h2>기능 설명과 전체 확인 범위</h2></header>
      <div className="qa-scope-overview-body"><QaFeatureScopeBlocks feature={feature} /></div>
    </section>
  );

  return (
    <section className="qa-feature-scope qa-feature-scope-session">
      <header className="qa-feature-session-head">
        <button className="text-button qa-scope-back" onClick={onBack} ref={backRef} type="button">← 대기열로 돌아가기</button>
        <div>
          <p className="eyebrow">품질 확인 · {feature.scenarios.length}개 항목</p>
          <h1>{feature.title}</h1>
        </div>
      </header>

      {typeof children === "function"
        ? children({ auxiliaryMode, onAuxiliaryModeChange: setAuxiliaryMode, scopePanel })
        : children}
    </section>
  );
}

interface QaFeatureScopeControls {
  auxiliaryMode: QaAuxiliaryMode;
  onAuxiliaryModeChange(mode: QaAuxiliaryMode): void;
  scopePanel: ReactNode;
}

function QaFeatureScopeBlocks({ feature }: { feature: WorkGroupSummary }) {
  return (
    <>
      <section aria-label="바뀐 점" className="qa-scope-block">
        <h2>바뀐 점</h2>
        {feature.description ? <p>{feature.description}</p> : <p className="qa-scope-missing">기능 설명이 준비되지 않았습니다.</p>}
      </section>
      <section aria-label="사용자가 확인할 결과" className="qa-scope-block">
        <h2>사용자가 확인할 결과</h2>
        <ul className="qa-scope-outcomes">
          {feature.scenarios.map((scenario) => (
            <li key={scenario.id}><details><summary>{scenario.title}</summary>{scenario.body && <p>{scenario.body}</p>}</details></li>
          ))}
        </ul>
      </section>
    </>
  );
}

function QaFeatureHeld({ feature, onBack }: { feature: WorkGroupSummary; onBack(): void }) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { backRef.current?.focus(); }, []);
  return (
    <section className="qa-feature-scope">
      <button className="text-button qa-scope-back" onClick={onBack} ref={backRef} type="button">← 대기열로 돌아가기</button>
      <div className="view-heading"><div><p className="eyebrow">{groupStatusLabel(feature.displayStatus)}</p><h1>{feature.title}</h1></div></div>
      <section aria-label="준비 중인 이유" className="qa-scope-block">
        <h2>지금은 확인할 수 없습니다</h2>
        <p>이 기능이 {groupStatusLabel(feature.displayStatus)} 상태로 바뀌었습니다. 남긴 임시 검토는 삭제하지 않았으며, 다시 확인할 수 있게 되면 새 상태에서 시작합니다.</p>
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
    automatic_completed: "AI 검증 완료",
    configuration_error: "구성 확인 필요",
  }[status];
}
