import { useEffect, useMemo, useState } from "react";
import type {
  AgentDiagnosticExport,
  AgentReportView,
  AgentRoleSlotRequest,
  AgentRunStatus,
  AgentRunSummary,
  AgentRuntimeActions,
  AgentRuntimeState,
  ProjectSummary,
  WorkflowItemSummary,
} from "../../domain/types";
import type { RunSignal, RunSignalKind, ToolCategory } from "../../domain/runActivity";
import { actionableQaFileNames } from "../DevelopmentBoard";
import {
  idleSeconds,
  isRunIdle,
  redactSecrets,
  summarizeRunActivity,
} from "../../domain/runActivity";

const ROLE_ORDER = ["planner", "architect", "developer"] as const;
const roleLabels: Record<string, string> = {
  planner: "기획자",
  architect: "아키텍트",
  developer: "개발자",
};
const stateLabels: Record<AgentRunStatus, string> = {
  reserved: "배정 중",
  queued: "시작 대기",
  running: "진행 중",
  paused: "일시 정지",
  succeeded: "완료",
  failed: "실패",
  cancelled: "취소됨",
  recovery_required: "복구 필요",
  unrecognized: "상태 확인 필요",
};
const activeStates = new Set<AgentRunStatus>(["reserved", "queued", "running", "paused"]);
const toolCategoryLabels: Record<ToolCategory, string> = {
  fileRead: "파일 읽기",
  fileEdit: "파일 편집",
  command: "명령 실행",
  search: "검색",
  other: "기타",
  unnamed: "이름 없음",
};
const signalLabels: Record<RunSignalKind, string> = {
  started: "시작",
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
  timed_out: "시간 초과",
};

interface Props {
  actions: AgentRuntimeActions;
  project: ProjectSummary;
  state: AgentRuntimeState;
  directAssignOpen: boolean;
  onCloseDirectAssign(): void;
}

interface QueueItem {
  id: string;
  role: string;
  title: string;
  verdict: string;
}

export function AgentRunDashboard({
  actions,
  directAssignOpen,
  onCloseDirectAssign,
  project,
  state,
}: Props) {
  const [selectedRun, setSelectedRun] = useState<AgentRunSummary | null>(null);
  const [selectedQueue, setSelectedQueue] = useState<QueueItem | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const itemMap = useMemo(() => workflowItems(project), [project]);
  const queueItems = useMemo(() => eligibleQueue(project, itemMap), [itemMap, project]);
  const runs = state.queue?.runs ?? [];
  const active = runs.filter((run) => activeStates.has(run.state)).sort(activeOrder);
  const recent = runs.filter((run) => !activeStates.has(run.state)).slice(0, 3);
  const attention = attentionItems(project, state);
  const waitingForUser = userDecisions(project);

  return (
    <div className="agent-operations">
      {attention.length > 0 && (
        <section aria-labelledby="agent-attention-heading" className="agent-ops-section agent-ops-attention">
          <header><h2 id="agent-attention-heading">확인 필요</h2><span>{attention.length}</span></header>
          <ul>{attention.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      )}

      {waitingForUser.length > 0 && (
        <section aria-labelledby="agent-user-wait-heading" className="agent-ops-section">
          <header><h2 id="agent-user-wait-heading">내 선택 대기</h2><span>{waitingForUser.length}</span></header>
          <ul className="agent-plain-list">
            {waitingForUser.map((item) => <li key={item.id}><strong>{item.title}</strong><span>{item.kind}</span></li>)}
          </ul>
        </section>
      )}

      {active.length > 0 && (
        <section aria-labelledby="agent-running-heading" className="agent-ops-section">
          <header><h2 id="agent-running-heading">진행 중</h2><span>{active.length}</span></header>
          <ul className="agent-session-list">
            {active.map((run) => (
              <li key={run.runId}>
                <button onClick={() => setSelectedRun(run)} type="button">
                  <span className={`agent-state-dot state-${run.state}`} aria-hidden="true" />
                  <span className="agent-session-copy">
                    <strong>{titleOf(run.targetId, itemMap)}</strong>
                    <small>{roleLabels[run.role] ?? run.role} · {stateLabels[run.state]}</small>
                  </span>
                  <time>{run.state === "running" ? runningDuration(run.startedAt) : "시작 준비 중"}</time>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {queueItems.length > 0 && (
        <section aria-labelledby="agent-queue-heading" className="agent-ops-section">
          <header><h2 id="agent-queue-heading">배정 대기</h2><span>{queueItems.length}</span></header>
          <ul className="agent-session-list agent-queue-list">
            {queueItems.map((item) => (
              <li key={`${item.role}:${item.id}`}>
                <button onClick={() => setSelectedQueue(item)} type="button">
                  <span className="agent-role-chip">{roleLabels[item.role] ?? item.role}</span>
                  <span className="agent-session-copy"><strong>{item.title}</strong><small>자리가 나면 안전 조건을 다시 확인합니다</small></span>
                  <span aria-hidden="true" className="agent-row-chevron">›</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="agent-recent-heading" className="agent-ops-section agent-recent-section">
          <header><h2 id="agent-recent-heading">최근 종료</h2><button className="agent-text-button" onClick={() => setHistoryOpen(true)} type="button">전체 기록</button></header>
          <ul className="agent-session-list">
            {recent.map((run) => (
              <li key={run.runId}>
                <button onClick={() => setSelectedRun(run)} type="button">
                  <span className={`agent-state-dot state-${run.state}`} aria-hidden="true" />
                  <span className="agent-session-copy"><strong>{titleOf(run.targetId, itemMap)}</strong><small>{roleLabels[run.role] ?? run.role} · {reasonLabel(run.reason, run.state)}</small></span>
                  <time>{finishedDuration(run.startedAt, run.finishedAt)}</time>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {attention.length === 0 && waitingForUser.length === 0 && active.length === 0 && queueItems.length === 0 && recent.length === 0 && (
        <p className="agent-quiet-empty">새 작업을 기다리는 중 · 다음 안전 확인 {nextCheckLabel(state)}</p>
      )}

      {directAssignOpen && (
        <DirectAssignDialog actions={actions} itemMap={itemMap} onClose={onCloseDirectAssign} project={project} state={state} />
      )}
      {(selectedRun || selectedQueue) && (
        <DetailDrawer
          actions={actions}
          itemMap={itemMap}
          onClose={() => { setSelectedRun(null); setSelectedQueue(null); }}
          project={project}
          queueItem={selectedQueue}
          run={selectedRun}
          state={state}
        />
      )}
      {historyOpen && <HistoryDrawer itemMap={itemMap} onClose={() => setHistoryOpen(false)} runs={runs.filter((run) => !activeStates.has(run.state))} />}
      {state.cancelPreview && <CancelDialog actions={actions} state={state} />}
      {state.retryPreview && <RetryDialog actions={actions} state={state} />}
    </div>
  );
}

function DirectAssignDialog({ actions, itemMap, onClose, project, state }: {
  actions: AgentRuntimeActions;
  itemMap: Map<string, WorkflowItemSummary>;
  onClose(): void;
  project: ProjectSummary;
  state: AgentRuntimeState;
}) {
  const [role, setRole] = useState<(typeof ROLE_ORDER)[number]>("developer");
  const [target, setTarget] = useState("");
  const candidates = eligibleQueue(project, itemMap).filter((item) => item.role === role);
  const selected = target || candidates[0]?.id || "";
  const plannedRole = state.runPlan?.roles.find((item) => item.role === role);
  useDismissOnEscape(onClose);

  async function plan() {
    const request: AgentRoleSlotRequest = { role, slots: 1, targets: selected ? [selected] : [] };
    await actions.planRun([request]);
  }

  return (
    <div className="agent-overlay" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section aria-labelledby="direct-assign-title" aria-modal="true" className="agent-dialog" role="dialog">
        <header><div><p className="eyebrow">DIRECT ASSIGN</p><h2 id="direct-assign-title">직접 배정</h2></div><button aria-label="닫기" onClick={onClose} type="button">×</button></header>
        <label>역할<select onChange={(event) => { actions.cancelRunPlan(); setRole(event.target.value as typeof role); setTarget(""); }} value={role}>{ROLE_ORDER.map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}</select></label>
        <fieldset><legend>배정할 작업</legend>
          {candidates.length > 0 ? candidates.map((item) => (
            <label className="agent-candidate-option" key={item.id}><input checked={selected === item.id} name="target" onChange={() => { actions.cancelRunPlan(); setTarget(item.id); }} type="radio" /><span><strong>{item.title}</strong><small>{roleLabels[item.role]}가 지금 시작할 수 있습니다</small></span></label>
          )) : <p className="agent-dialog-note">현재 이 역할에 안전하게 배정할 작업이 없습니다.</p>}
        </fieldset>
        <details><summary>고급 직접 지정</summary><label>작업 ID<input onChange={(event) => { actions.cancelRunPlan(); setTarget(event.target.value); }} placeholder="TASK-…" value={target} /></label></details>
        {state.runError && <p className="agent-error" role="status">{humanRuntimeMessage(state.runError)}</p>}
        {plannedRole && <p className="agent-dialog-note">{plannedRole.granted > 0 ? "안전 조건 확인 완료" : exclusionLabel(plannedRole.excluded)}</p>}
        <footer><button className="secondary-button" onClick={onClose} type="button">취소</button>{plannedRole?.granted ? <button className="stamp-button" disabled={state.runStarting} onClick={() => void actions.startRun().then((ok) => { if (ok) onClose(); })} type="button">{state.runStarting ? "배정 중" : "배정 시작"}</button> : <button className="stamp-button" disabled={!selected || state.runPlanning} onClick={() => void plan()} type="button">{state.runPlanning ? "확인 중" : "시작 조건 확인"}</button>}</footer>
      </section>
    </div>
  );
}

function DetailDrawer({ actions, itemMap, onClose, project, queueItem, run, state }: {
  actions: AgentRuntimeActions;
  itemMap: Map<string, WorkflowItemSummary>;
  onClose(): void;
  project: ProjectSummary;
  queueItem: QueueItem | null;
  run: AgentRunSummary | null;
  state: AgentRuntimeState;
}) {
  // 보고서를 열어 둔 동안에는 상세가 닫히지 않는다. 그 키는 보고서 화면이 받는다.
  useDismissOnEscape(() => { if (!state.reportView) onClose(); });
  const runId = run?.runId ?? null;
  const { readRunReports, watchRunLog } = actions;
  // 상세가 열려 있는 동안만 이벤트를 이어 읽는다. 닫으면 그 자리에서 멈춘다.
  useEffect(() => {
    if (!runId) return;
    watchRunLog(runId);
    return () => watchRunLog(null);
  }, [runId, watchRunLog]);

  // 실행이 남긴 보고서를 담고 있는 워크플로. 대상 문서를 어느 워크플로에서도 찾지 못하면 이 실행의
  // 연결을 확인할 방법이 없다는 뜻이므로, 다른 워크플로를 대신 넣지 않고 바로가기를 만들지 않는다.
  const workflowDirectory = useMemo(
    () => (run ? workflowDirectoryOf(project, run.targetId) : null),
    [project, run],
  );
  useEffect(() => {
    if (!run || !workflowDirectory) return;
    void readRunReports(run, workflowDirectory);
  }, [readRunReports, run, workflowDirectory]);

  const page = runId ? state.logs[runId] : undefined;
  // 읽은 기록이 없으면 집계 자체가 없다. 지난 실행의 값을 이 실행의 사실로 보여주지 않는다.
  const activity = useMemo(() => (page ? summarizeRunActivity(page.events) : null), [page]);
  const idle = Boolean(
    run && activity && activeStates.has(run.state) && isRunIdle(activity.lastActivityAt, Date.now()),
  );
  // 이 실행의 자리에 있는 목록만 쓴다. 자리가 비어 있으면 다른 실행의 목록으로 메우지 않는다.
  const reports = runId ? state.runReports[runId] ?? [] : [];

  return (
    <>
    <div className="agent-drawer-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside aria-label="에이전트 상세" className="agent-detail-drawer">
        <header><div><p className="eyebrow">DETAILS</p><h2>{run ? stateLabels[run.state] : "배정 대기"}</h2></div><button aria-label="닫기" onClick={onClose} type="button">×</button></header>
        {run ? (
          <>
            <dl className="agent-run-card">
              <div><dt>대상</dt><dd><strong>{titleOf(run.targetId, itemMap)}</strong><small>{run.targetId ?? "확인 중"}</small></dd></div>
              <div><dt>역할</dt><dd>{roleLabels[run.role] ?? run.role} · {run.provider}</dd></div>
              <div><dt>시작</dt><dd>{clockLabel(run.startedAt)}</dd></div>
              <div><dt>{run.finishedAt ? "소요" : "경과"}</dt><dd>{run.finishedAt ? finishedDuration(run.startedAt, run.finishedAt) : runningDuration(run.startedAt)}</dd></div>
              <div><dt>상태</dt><dd>{stateLabels[run.state]}</dd></div>
              <div><dt>사유</dt><dd>{run.reason ? reasonLabel(run.reason, run.state) : "기록 없음"}</dd></div>
              <div><dt>도구 사용</dt><dd>{activity ? <ToolUsage counts={activity.usage} total={activity.toolTotal} /> : "모름"}</dd></div>
              <div><dt>마지막 활동</dt><dd>{activity ? clockLabel(activity.lastActivityAt) : "모름"}</dd></div>
              {workflowDirectory && reports.length > 0 && (
                <div><dt>결과 보고서</dt><dd>
                  <ul className="agent-report-links">
                    {reports.map((report) => (
                      <li key={report.fileName}>
                        <button className="agent-text-button" onClick={() => void actions.openReport(workflowDirectory, report)} type="button">{report.title}</button>
                      </li>
                    ))}
                  </ul>
                </dd></div>
              )}
              <div><dt>실행 ID</dt><dd>{run.runId}</dd></div>
            </dl>
            <div className="agent-drawer-actions">
              {activeStates.has(run.state) && <button onClick={() => void actions.previewCancel(run.runId)} type="button">취소</button>}
              {["failed", "cancelled", "recovery_required"].includes(run.state) && <button onClick={() => actions.previewRetry(run.runId)} type="button">재시도</button>}
              {/* 진단 자료는 활성 실행과 종료된 실행 양쪽에서 내보낼 수 있다. 상태로 막지 않는다. */}
              <button onClick={() => void actions.exportRunDiagnostics(run.runId, "save")} type="button">진단 자료 저장</button>
              <button onClick={() => void actions.exportRunDiagnostics(run.runId, "copy")} type="button">진단 자료 복사</button>
            </div>
            {state.diagnosticExport?.runId === run.runId && <DiagnosticExportStatus report={state.diagnosticExport} />}
            {state.logError && <p className="agent-detail-message">실행 기록을 읽지 못했습니다 · {redactSecrets(state.logError)}</p>}
            {(activity && (activity.signals.length > 0 || idle)) && (
              <ol className="agent-run-events">
                {activity.signals.map((signal, index) => <SignalRow key={index} signal={signal} />)}
                {idle && (
                  <li className="agent-run-signal alert">
                    <span>활동 없음</span>
                    <time>{idleLabel(activity.lastActivityAt)}</time>
                  </li>
                )}
              </ol>
            )}
            {!activity && !state.logError && <p className="agent-dialog-note">실행 기록을 읽는 중입니다.</p>}
          </>
        ) : (
          <dl><div><dt>역할</dt><dd>{roleLabels[queueItem?.role ?? ""] ?? queueItem?.role}</dd></div><div><dt>작업</dt><dd>{queueItem?.id}</dd></div></dl>
        )}
      </aside>
    </div>
    {state.reportView && <ReportViewer onClose={actions.closeReport} view={state.reportView} />}
    </>
  );
}

/**
 * 보고서 본문을 읽기 전용으로 보여 준다. 편집 입력도 저장 수단도 두지 않으므로, 이 화면을 거쳐
 * 보고서 파일이 바뀌는 경로가 없다. 본문을 읽지 못하면 그 사실만 알리고 빈 본문을 대신 싣지 않는다.
 */
function ReportViewer({ onClose, view }: { onClose(): void; view: AgentReportView }) {
  useDismissOnEscape(onClose);
  return (
    <div className="agent-overlay" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section aria-labelledby="agent-report-title" aria-modal="true" className="agent-dialog agent-report-dialog" role="dialog">
        <header><div><p className="eyebrow">REPORT</p><h2 id="agent-report-title">{view.title}</h2></div><button aria-label="닫기" autoFocus onClick={onClose} type="button">×</button></header>
        {view.reading && <p className="agent-dialog-note">보고서를 읽는 중입니다.</p>}
        {view.error && <p className="agent-detail-message">보고서를 읽지 못했습니다 · {redactSecrets(view.error)}</p>}
        {view.body !== null && <pre className="agent-report-body">{view.body}</pre>}
      </section>
    </div>
  );
}

/**
 * 진단 자료 내보내기 한 번의 진행·성공·실패 표시. 사용자가 저장이나 복사를 고른 뒤에만 나온다.
 *
 * 성공 문구가 어디에 놓였는지를 함께 말한다 — 저장은 사용자가 고른 파일에, 복사는 클립보드에
 * 들어갔고, 두 경우 모두 앱 밖으로 나간 곳이 없다.
 */
function DiagnosticExportStatus({ report }: { report: AgentDiagnosticExport }) {
  const target = report.mode === "save" ? "파일" : "클립보드";
  if (report.status === "working") {
    return <p className="agent-export-status" role="status">진단 자료를 모으는 중입니다.</p>;
  }
  if (report.status === "failed") {
    return (
      <p className="agent-export-status failed" role="status">
        진단 자료를 내보내지 못했습니다 · {redactSecrets(report.error ?? "")}
      </p>
    );
  }
  return <p className="agent-export-status done" role="status">진단 자료를 {target}에 담았습니다.</p>;
}

/** 도구 사용 총 횟수와 유형별 집계. 도구 이름 원문은 여기에도 다른 어디에도 나가지 않는다. */
function ToolUsage({ counts, total }: { counts: { category: ToolCategory; count: number }[]; total: number }) {
  return (
    <>
      <strong>총 {total}회</strong>
      {counts.length > 0 && (
        <span className="agent-tool-usage">
          {counts.map((usage) => (
            <span key={usage.category}>{toolCategoryLabels[usage.category]} {usage.count}</span>
          ))}
        </span>
      )}
    </>
  );
}

/** 줄로 남는 신호 하나. 실패 상세는 런타임이 준 문장을 그대로 싣는다. */
function SignalRow({ signal }: { signal: RunSignal }) {
  const alert = signal.kind === "failed" || signal.kind === "cancelled" || signal.kind === "timed_out";
  return (
    <li className={alert ? "agent-run-signal alert" : "agent-run-signal"}>
      <span>{signalLabels[signal.kind]}</span>
      <time>{clockLabel(signal.at)}</time>
      {signal.detail && <p>{redactSecrets(signal.detail)}</p>}
    </li>
  );
}

function HistoryDrawer({ itemMap, onClose, runs }: {
  itemMap: Map<string, WorkflowItemSummary>;
  onClose(): void;
  runs: AgentRunSummary[];
}) {
  useDismissOnEscape(onClose);
  return (
    <div className="agent-drawer-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside aria-label="전체 실행 기록" aria-modal="true" className="agent-detail-drawer" role="dialog">
        <header><div><p className="eyebrow">HISTORY</p><h2>전체 실행 기록</h2></div><button aria-label="닫기" autoFocus onClick={onClose} type="button">×</button></header>
        {runs.length > 0 ? <ul className="agent-session-list agent-history-list">{runs.map((run) => <li key={run.runId}><div className="agent-history-row"><span className={`agent-state-dot state-${run.state}`} aria-hidden="true" /><span className="agent-session-copy"><strong>{titleOf(run.targetId, itemMap)}</strong><small>{roleLabels[run.role] ?? run.role} · {reasonLabel(run.reason, run.state)}</small></span><time>{finishedDuration(run.startedAt, run.finishedAt)}</time></div></li>)}</ul> : <p className="agent-dialog-note">아직 종료된 실행이 없습니다.</p>}
      </aside>
    </div>
  );
}

function CancelDialog({ actions, state }: { actions: AgentRuntimeActions; state: AgentRuntimeState }) {
  useDismissOnEscape(actions.dismissCancel);
  const preview = state.cancelPreview!;
  return <div className="agent-overlay"><section aria-label="실행 취소 확인" aria-modal="true" className="agent-dialog" role="dialog"><header><div><p className="eyebrow">STOP</p><h2>이 실행을 취소할까요?</h2></div><button aria-label="닫기" autoFocus onClick={actions.dismissCancel} type="button">×</button></header><p className="agent-dialog-note">진행 중인 세션을 끝내고 이 작업의 선점을 안전하게 해제합니다.</p>{preview.childProcesses > 0 && <p className="agent-detail-message">함께 종료할 하위 프로세스 {preview.childProcesses}개</p>}{state.controlError && <p className="agent-error">{humanRuntimeMessage(state.controlError)}</p>}<footer><button className="secondary-button" onClick={actions.dismissCancel} type="button">계속 실행</button><button className="stamp-button" disabled={state.controllingRunId !== null} onClick={() => void actions.confirmCancel()} type="button">취소 실행</button></footer></section></div>;
}

function RetryDialog({ actions, state }: { actions: AgentRuntimeActions; state: AgentRuntimeState }) {
  useDismissOnEscape(actions.dismissRetry);
  return <div className="agent-overlay"><section aria-label="실행 재시도 확인" aria-modal="true" className="agent-dialog" role="dialog"><header><div><p className="eyebrow">RETRY</p><h2>이 작업을 다시 배정할까요?</h2></div><button aria-label="닫기" autoFocus onClick={actions.dismissRetry} type="button">×</button></header><p className="agent-dialog-note">현재 자격과 실행 한도를 다시 확인한 뒤 새 세션으로 시작합니다.</p>{state.controlError && <p className="agent-error">{humanRuntimeMessage(state.controlError)}</p>}<footer><button className="secondary-button" onClick={actions.dismissRetry} type="button">취소</button><button className="stamp-button" disabled={state.controllingRunId !== null} onClick={() => void actions.confirmRetry()} type="button">다시 배정</button></footer></section></div>;
}

function workflowItems(project: ProjectSummary) {
  const items = new Map<string, WorkflowItemSummary>();
  for (const workflow of project.workflows) {
    for (const group of [workflow.items.ideas, workflow.items.specs, workflow.items.tasks]) {
      for (const item of group) items.set(item.id, item);
    }
  }
  return items;
}

/**
 * 실행의 대상 문서를 담고 있는 워크플로의 디렉터리. 앱이 매니페스트에서 읽어 둔 값을 그대로 돌려
 * 주며 화면이 조립하지 않는다. 대상이 없거나 어느 워크플로에도 없으면 null이다.
 */
function workflowDirectoryOf(project: ProjectSummary, targetId: string | null) {
  if (!targetId) return null;
  const owner = project.workflows.find((workflow) =>
    [workflow.items.ideas, workflow.items.specs, workflow.items.tasks]
      .some((group) => group.some((item) => item.id === targetId)),
  );
  return owner?.directory ?? null;
}

function eligibleQueue(project: ProjectSummary, items: Map<string, WorkflowItemSummary>): QueueItem[] {
  const detail = project.pendingDetail;
  if (!detail) return [];
  return ROLE_ORDER.flatMap((role) => detail[role].candidates
    .filter((candidate) => candidate.verdict === "eligible")
    .map((candidate) => ({ id: candidate.id, role, title: titleOf(candidate.id, items), verdict: candidate.verdict })));
}

function userDecisions(project: ProjectSummary) {
  // "내 선택 대기"는 지금 누를 수 있는 것만 센다. 통째 QA 관문에 잠긴 작업까지 세면 개발
  // 화면은 "할 QA 없음"이라 답해 두 화면이 어긋난다. 잠긴 묶음은 개발 화면이 예고 카드로 보인다.
  return project.workflows.flatMap((workflow) => {
    const actionableQa = actionableQaFileNames(workflow.items.tasks);
    return [
      ...workflow.items.specs.filter((item) => item.status === "user_review").map((item) => ({ id: item.id, title: item.title, kind: "기획 승인" })),
      ...workflow.items.tasks
        .filter((item) => item.status === "qa_waiting" && actionableQa.has(item.fileName))
        .map((item) => ({ id: item.id, title: item.title, kind: "QA 확인" })),
    ];
  });
}

function attentionItems(project: ProjectSummary, state: AgentRuntimeState) {
  const items: string[] = [];
  if (state.queueError) items.push(humanRuntimeMessage(state.queueError));
  if (state.queue?.unavailable) items.push(humanRuntimeMessage(state.queue.unavailable));
  if (state.queue?.automation?.watcher?.status === "degraded") items.push("파일 감시가 중단되어 안전 확인 주기로 동작 중입니다.");
  for (const role of state.queue?.automation?.roles ?? []) if (role.status === "attention") items.push(`${roleLabels[role.role] ?? role.role}: ${reasonLabel(role.lastResult, "failed")}`);
  for (const provider of state.policy?.providers ?? []) if (provider.status !== "ready") items.push(`${provider.provider}: ${providerReadinessLabel(provider.status)}`);
  void project;
  return [...new Set(items)];
}

// 진행 중 목록의 자리 고정용 정렬. 런타임은 마지막 갱신 순으로 주므로 병렬 실행이 폴링마다
// 서로 자리를 바꾼다. 시작 시각 오름차순(미시작은 뒤, 동률은 runId)이면 행이 움직이지 않는다.
function activeOrder(a: AgentRunSummary, b: AgentRunSummary) {
  if (a.startedAt !== b.startedAt) {
    if (a.startedAt === null) return 1;
    if (b.startedAt === null) return -1;
    return a.startedAt < b.startedAt ? -1 : 1;
  }
  return a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0;
}

function titleOf(id: string | null, items: Map<string, WorkflowItemSummary>) { return id ? items.get(id)?.title ?? id : "작업 확인 중"; }
function nextCheckLabel(state: AgentRuntimeState) { const next = state.queue?.automation?.roles.map((role) => role.nextPollAt).filter((value): value is string => Boolean(value)).sort()[0]; return next ? new Date(next).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "자동"; }
function runningDuration(startedAt: string | null) { if (!startedAt) return "시작 중"; const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000)); return seconds < 60 ? "1분 미만" : `${Math.floor(seconds / 60)}분`; }
function finishedDuration(startedAt: string | null, finishedAt: string | null) { if (!startedAt || !finishedAt) return "시간 기록 없음"; const seconds = Math.max(0, Math.floor((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000)); return seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분`; }
function exclusionLabel(reasons: string[]) { if (reasons.some((reason) => /no.?target/.test(reason))) return "지금은 배정할 작업이 없습니다."; if (reasons.includes("limit_reached")) return "현재 실행 자리가 모두 사용 중입니다."; if (reasons.includes("model_unavailable")) return "선택한 모델을 현재 계정에서 사용할 수 없습니다."; return "현재 안전 조건을 충족하지 않습니다."; }
function reasonLabel(reason: string | null, state: string) { if (!reason) return stateLabels[state as AgentRunStatus] ?? state; if (/model_unavailable/.test(reason)) return "선택한 모델을 현재 계정에서 사용할 수 없습니다"; if (/no.?target/.test(reason)) return "새 작업을 기다리는 중"; if (/limit/.test(reason)) return "실행 자리가 모두 사용 중입니다"; if (/login|auth/.test(reason)) return "실행 도구 로그인이 필요합니다"; return humanRuntimeMessage(reason); }
function clockLabel(value: string | null) { if (!value) return "기록 없음"; const parsed = Date.parse(value); return Number.isNaN(parsed) ? "기록 없음" : new Date(parsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function idleLabel(lastActivityAt: string | null) { const seconds = idleSeconds(lastActivityAt, Date.now()); return seconds === null ? "확인 필요" : `${Math.floor(seconds / 60)}분째 조용함`; }

// 진단 상태 중 사용자가 행동할 수 있는 것만 문장으로 옮기고, 나머지는 원문 코드 대신 일반 안내를
// 쓴다. 상태 코드는 런타임 계약(provider-lifecycle-contract.md)의 것이라 화면이 다 알 수 없다.
function providerReadinessLabel(status: string) {
  return /executable_missing|unsupported_version|permission_denied|login|auth/.test(status)
    ? humanRuntimeMessage(status)
    : "실행 도구 확인이 필요합니다.";
}

export function humanRuntimeMessage(message: string) {
  if (/project_not_configured/.test(message)) return "이 프로젝트의 에이전트 설정을 먼저 저장해 주세요.";
  if (/model_unavailable|model.+(?:not available|unsupported)/i.test(message)) return "선택한 모델을 현재 계정에서 사용할 수 없습니다.";
  if (/limit_reached/.test(message)) return "현재 실행 자리가 모두 사용 중입니다.";
  if (/no.?target/.test(message)) return "새 작업을 기다리는 중입니다.";
  if (/login|auth/i.test(message)) return "실행 도구 로그인이 필요합니다.";
  if (/executable_missing/.test(message)) return "실행 도구가 설치되어 있지 않거나 찾을 수 없습니다. 설치를 확인해 주세요.";
  if (/unsupported_version/.test(message)) return "실행 도구 버전이 낮습니다. 실행 도구를 업데이트해 주세요.";
  if (/permission_denied/.test(message)) return "실행 도구를 실행할 권한이 없습니다.";
  if (/^diagnostic$/.test(message)) return "실행 도구 점검에 실패했습니다. 실행 도구 설치와 로그인 상태를 확인해 주세요.";
  if (/\{[\s\S]*\}|contract|계약 밖|provider error/i.test(message)) return "실행 환경 응답을 확인하지 못했습니다. 고급 설정에서 실행 환경을 복구해 주세요.";
  return message.replace(/(?:token|secret|api.?key)\s*[:=]\s*\S+/gi, "[민감정보 제거됨]");
}

function useDismissOnEscape(onDismiss: () => void) {
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [onDismiss]);
}
