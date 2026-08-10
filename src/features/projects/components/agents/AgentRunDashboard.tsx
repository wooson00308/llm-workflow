import { useEffect, useState } from "react";
import type {
  AgentRoleSlotRequest,
  AgentRunStatus,
  AgentRunSummary,
  AgentRuntimeActions,
  AgentRuntimeState,
} from "../../domain/types";

const ROLE_ORDER = ["planner", "architect", "developer"] as const;
const roleLabels: Record<string, string> = {
  planner: "기획자",
  architect: "아키텍트",
  developer: "개발자",
};
const stateLabels: Record<AgentRunStatus, string> = {
  reserved: "예약 중",
  queued: "대기",
  running: "실행 중",
  paused: "일시 정지",
  succeeded: "성공",
  failed: "실패",
  cancelled: "취소됨",
  recovery_required: "복구 필요",
  unrecognized: "알 수 없는 상태",
};
const activeStates = new Set<AgentRunStatus>(["reserved", "queued", "running", "paused"]);

interface Props {
  actions: AgentRuntimeActions;
  state: AgentRuntimeState;
}

export function AgentRunDashboard({ actions, state }: Props) {
  const [selectedRole, setSelectedRole] = useState<(typeof ROLE_ORDER)[number]>("planner");
  const [allocation, setAllocation] = useState<Record<string, "automatic" | "manual">>(() =>
    Object.fromEntries(ROLE_ORDER.map((role) => [role, "automatic"])),
  );
  const [slots, setSlots] = useState<Record<string, number>>(() =>
    Object.fromEntries(ROLE_ORDER.map((role) => [role, 1])),
  );
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [candidateTargets, setCandidateTargets] = useState<Record<string, string[]>>({});
  const [billingAccepted, setBillingAccepted] = useState(false);
  const [pauseArmed, setPauseArmed] = useState(false);
  const queue = state.queue;
  const plan = state.runPlan;
  const runs = queue?.runs ?? [];
  const active = runs.filter((run) => activeStates.has(run.state));
  const recent = runs.filter((run) => !activeStates.has(run.state));
  const totalGranted = plan?.roles.reduce((sum, role) => sum + role.granted, 0) ?? 0;
  const runningCount = runs.filter((run) => run.state === "running").length;
  const waitingCount = runs.filter(
    (run) => run.state === "queued" || run.state === "reserved",
  ).length;
  const latestResult = [...recent].reverse()[0];
  const queueNeedsAttention = Boolean(state.queueError || queue?.unavailable);

  useEffect(() => {
    if (!plan) return;
    setCandidateTargets((current) => ({
      ...current,
      ...Object.fromEntries(plan.roles.map((role) => [role.role, role.manualTargets])),
    }));
  }, [plan]);

  function requests(): AgentRoleSlotRequest[] {
    return ROLE_ORDER.map((role) => ({
      role,
      slots: Math.max(1, slots[role] ?? 1),
      targets:
        allocation[role] === "manual"
          ? (targets[role] ?? "")
              .split(",")
              .map((target) => target.trim())
              .filter(Boolean)
          : [],
    }));
  }

  const manualMissing = ROLE_ORDER.some(
    (role) => allocation[role] === "manual" && !(targets[role] ?? "").trim(),
  );

  return (
    <section aria-label="에이전트 실행 대시보드" className="agent-run-dashboard">
      <header className="agent-run-heading">
        <div>
          <h3>실행 계획과 큐</h3>
          <p>역할을 고르고 계획을 확인한 뒤에만 유료 CLI 세션을 시작합니다.</p>
        </div>
        {state.queueReading && !queue ? (
          <span className="agent-run-reading" role="status">실행 상태 확인 중</span>
        ) : (queueNeedsAttention || !queue) ? (
          <button
            className="secondary-button"
            disabled={state.queueReading}
            onClick={() => void actions.refreshRuns()}
            type="button"
          >
            실행 상태 다시 확인
          </button>
        ) : null}
      </header>

      <section aria-label="프로젝트 실행 현황" className="agent-run-summary">
        <Summary label="새 배정" value={queue?.paused ? "일시 정지" : "활성"} />
        <Summary label="실행 중" value={`${runningCount}건`} />
        <Summary label="대기" value={`${waitingCount}건`} />
        <Summary label="최근 결과" value={latestResult ? stateLabels[latestResult.state] : "없음"} />
      </section>

      {queue?.unavailable && <p className="agent-error">상태를 읽을 수 없음: {queue.unavailable}</p>}
      {state.queueError && !queue?.unavailable && <p className="agent-error">{state.queueError}</p>}

      <details className="agent-project-controls">
        <summary>
          <span>프로젝트 실행 제어</span>
          <small>{queue?.paused ? "새 배정 일시 정지 중" : "새 배정 활성"}</small>
        </summary>
        <div className="agent-project-controls-content">
          <p>현재 실행은 유지하고, 이 프로젝트의 새 에이전트 배정만 제어합니다.</p>
          {queue?.paused ? (
            <button
              className="secondary-button"
              disabled={state.pausing}
              onClick={() => void actions.setProjectPaused(false)}
              type="button"
            >
              새 배정 재개
            </button>
          ) : (
            <button
              className="secondary-button"
              disabled={state.pausing}
              onClick={() => setPauseArmed(true)}
              type="button"
            >
              새 배정 일시 정지
            </button>
          )}
          {pauseArmed && !queue?.paused && (
            <div className="agent-control-preview" role="status">
              <p>새 배정만 멈춥니다. 이미 실행 중인 항목과 다른 프로젝트의 상태는 유지됩니다.</p>
              <div className="agent-plan-actions">
                <button className="secondary-button" onClick={() => setPauseArmed(false)} type="button">
                  돌아가기
                </button>
                <button
                  className="stamp-button"
                  disabled={state.pausing}
                  onClick={() => {
                    setPauseArmed(false);
                    void actions.setProjectPaused(true);
                  }}
                  type="button"
                >
                  확인하고 일시 정지
                </button>
              </div>
            </div>
          )}
        </div>
      </details>

      <section aria-label="새 실행 설정" className="agent-run-builder">
        <h4>새 실행 설정</h4>
        <p>편집할 역할을 고르세요. 실행 방식과 상한은 위에서 저장한 역할 정책을 따릅니다.</p>
        <div aria-label="설정할 역할" className="agent-run-role-tabs">
          {ROLE_ORDER.map((role) => (
            <button
              aria-pressed={selectedRole === role}
              className={selectedRole === role ? "is-active" : undefined}
              key={role}
              onClick={() => setSelectedRole(role)}
              type="button"
            >
              {roleLabels[role]}
            </button>
          ))}
        </div>
        <div className="agent-run-request-grid">
          {(() => {
            const role = selectedRole;
            const policy = state.policy?.policy.roles[role];
            return (
              <fieldset key={role}>
                <legend>{roleLabels[role]} 실행 요청</legend>
                <p className="agent-run-role-policy">
                  {policy?.provider ?? "provider 미정"} · {policy?.model ?? "기본 모델"} · {policy?.runMode === "continuous" ? "반복" : "한 번"} · 최대 {policy?.maxParallel ?? "-"}명
                </p>
                <div className="agent-run-request-fields">
                  <label>
                    배정 방식
                    <select
                      aria-label={`${roleLabels[role]} 배정 방식`}
                      onChange={(event) => {
                        actions.cancelRunPlan();
                        setAllocation((current) => ({
                          ...current,
                          [role]: event.target.value as "automatic" | "manual",
                        }));
                      }}
                      value={allocation[role]}
                    >
                      <option value="automatic">자동 배정</option>
                      <option value="manual">직접 지정</option>
                    </select>
                  </label>
                  <label>
                    요청 인원
                    <input
                      aria-label={`${roleLabels[role]} 요청 인원`}
                      min={1}
                      onChange={(event) => {
                        actions.cancelRunPlan();
                        setSlots((current) => ({ ...current, [role]: Number(event.target.value) }));
                      }}
                      type="number"
                      value={slots[role]}
                    />
                  </label>
                </div>
                {allocation[role] === "manual" && (
                  <label>
                    대상 문서
                    <input
                      aria-label={`${roleLabels[role]} 수동 대상`}
                      list={`agent-targets-${role}`}
                      onChange={(event) => {
                        actions.cancelRunPlan();
                        setTargets((current) => ({ ...current, [role]: event.target.value }));
                      }}
                      placeholder="후보를 고르거나 쉼표로 구분"
                      value={targets[role] ?? ""}
                    />
                    <datalist id={`agent-targets-${role}`}>
                      {(candidateTargets[role] ?? []).map((target) => (
                        <option key={target} value={target} />
                      ))}
                    </datalist>
                    <small>
                      런타임 후보: {candidateTargets[role]?.length ? candidateTargets[role].join(", ") : "계획에서 확인"}. 직접 지정도 중복·lease·상태 검사를 우회하지 않습니다.
                    </small>
                    {policy?.runMode === "continuous" && (
                      <small>반복 직접 지정은 지정한 목록을 유지하며 이후 자동 배정으로 바뀌지 않습니다.</small>
                    )}
                  </label>
                )}
              </fieldset>
            );
          })()}
        </div>
        {manualMissing && <p className="agent-blocked-note">직접 지정 역할의 대상 문서를 선택해 주세요.</p>}
        <button
          className="stamp-button"
          disabled={state.runPlanning || manualMissing || !state.policy?.executionAllowed}
          onClick={() => {
            setBillingAccepted(false);
            void actions.planRun(requests());
          }}
          type="button"
        >
          {state.runPlanning ? "계획 확인 중" : "계획 확인"}
        </button>
      </section>

      {state.runError && <p className="agent-error">{state.runError}</p>}
      {plan && (
        <section aria-label="시작 확인" className="agent-run-plan">
          <h4>시작 확인</h4>
          <dl>
            <div><dt>적용 프로젝트</dt><dd>{plan.projectId}</dd></div>
            <div><dt>실제 시작 수</dt><dd>{totalGranted}개 세션</dd></div>
            <div><dt>프로젝트 제한</dt><dd>상한 {state.policy?.policy.projectMaxParallel ?? "-"}개 · 남음 {plan.projectRemaining}개</dd></div>
            <div><dt>기기 제한</dt><dd>상한 {state.policy?.policy.deviceMaxParallel ?? "-"}개 · 남음 {plan.deviceRemaining}개</dd></div>
            <div><dt>계획 만료</dt><dd>{plan.expiresAt}</dd></div>
          </dl>
          <table className="agent-run-plan-table">
            <thead><tr><th>역할</th><th>provider</th><th>실행 방식</th><th>요청/시작</th><th>대상</th><th>제외 사유</th></tr></thead>
            <tbody>
              {plan.roles.map((role) => (
                <tr key={role.role}>
                  <th data-label="역할">{roleLabels[role.role] ?? role.role}</th>
                  <td data-label="provider">{role.provider}</td>
                  <td data-label="실행 방식">{role.executionMode === "continuous" ? "반복" : "한 번"}</td>
                  <td data-label="요청/시작">{role.requested}/{role.granted}</td>
                  <td data-label="대상">{role.manualTargets.length ? role.manualTargets.join(", ") : "자동 배정"}</td>
                  <td data-label="제외 사유">{role.excluded.length ? role.excluded.join(", ") : "없음"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalGranted === 0 && (
            <p className="agent-blocked-note">시작할 수 있는 대상이 0건입니다. 제외 사유를 확인하고 직접 지정을 선택할 수 있습니다.</p>
          )}
          <p>확인하면 여러 유료 CLI 세션이 동시에 시작될 수 있습니다.</p>
          {plan.billingRouteRisk && (
            <label className="agent-billing-check">
              <input checked={billingAccepted} onChange={(event) => setBillingAccepted(event.target.checked)} type="checkbox" />
              Claude API 과금 경로로 실행될 수 있음을 확인했습니다. 키와 토큰 값은 표시하지 않습니다.
            </label>
          )}
          <div className="agent-plan-actions">
            <button className="secondary-button" onClick={() => actions.cancelRunPlan()} type="button">계획 취소</button>
            <button
              className="stamp-button"
              disabled={state.runStarting || totalGranted === 0 || (plan.billingRouteRisk && !billingAccepted)}
              onClick={() => void actions.startRun()}
              type="button"
            >
              {state.runStarting ? "시작 중" : "이 계획으로 시작"}
            </button>
          </div>
        </section>
      )}

      <RoleStatusTable runs={runs} state={state} />
      {active.length > 0 && <RunList actions={actions} runs={active} state={state} title="실행 중과 대기" />}
      {recent.length > 0 && <RunList actions={actions} runs={recent} state={state} title="최근 종료" />}
      {runs.length === 0 && <p className="agent-run-empty-state">아직 실행 기록이 없습니다.</p>}

      {state.cancelPreview && (
        <section aria-label="취소 확인" className="agent-control-preview">
          <h4>취소 확인</h4>
          <p>대상 {state.cancelPreview.targetId ?? "없음"} · 실행 {state.cancelPreview.runId}</p>
          <p>프로세스 {state.cancelPreview.pid ?? "없음"} · 자식 프로세스 {state.cancelPreview.childProcesses}개 · 생존 판정 {state.cancelPreview.processLiveness}</p>
          <p>lease {state.cancelPreview.leaseId ?? "없음"} · 정리 {state.cancelPreview.cleanup.join(", ") || "없음"}</p>
          <button className="secondary-button" onClick={() => actions.dismissCancel()} type="button">돌아가기</button>
          <button className="stamp-button" onClick={() => void actions.confirmCancel()} type="button">확인하고 취소</button>
        </section>
      )}
      {state.cancelResult?.kind === "partial" && (
        <p className="agent-error">취소했지만 정리가 남았습니다: {state.cancelResult.remaining.join(", ")}</p>
      )}
      {state.cancelResult?.kind === "applied" && <p className="agent-success">취소와 상태 정리가 모두 끝났습니다.</p>}
      {state.retryPreview && (
        <section aria-label="재시도 확인" className="agent-control-preview">
          <h4>새 재시도 계획 확인</h4>
          <p>이전 실행 {state.retryPreview.runId} · {state.retryPreview.reason ?? "종료 사유 없음"}</p>
          <p>새 실행 식별자를 사용하며 이전 실행은 기록에 그대로 남습니다.</p>
          <button className="secondary-button" onClick={() => actions.dismissRetry()} type="button">돌아가기</button>
          <button className="stamp-button" onClick={() => void actions.confirmRetry()} type="button">확인하고 재시도</button>
        </section>
      )}
      {state.controlError && <p className="agent-error">{state.controlError}</p>}
      {state.logError && <p className="agent-error">{state.logError}</p>}
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function RoleStatusTable({ runs, state }: { runs: AgentRunSummary[]; state: AgentRuntimeState }) {
  return (
    <section aria-label="역할별 실행 현황" className="agent-role-status">
      <h4>역할별 현황</h4>
      <table>
        <thead><tr><th>역할</th><th>provider</th><th>model</th><th>실행 방식</th><th>최대</th><th>실행</th><th>대기</th><th>마지막 결과</th></tr></thead>
        <tbody>
          {ROLE_ORDER.map((role) => {
            const policy = state.policy?.policy.roles[role];
            const rows = runs.filter((run) => run.role === role);
            const last = [...rows].reverse().find((run) => !activeStates.has(run.state));
            return (
              <tr key={role}>
                <th data-label="역할">{roleLabels[role]}</th>
                <td data-label="provider">{policy?.provider ?? "-"}</td>
                <td data-label="model">{policy?.model ?? "기본"}</td>
                <td data-label="실행 방식">{policy?.runMode === "continuous" ? "반복" : "한 번"}</td>
                <td data-label="최대">{policy?.maxParallel ?? "-"}</td>
                <td data-label="실행">{rows.filter((run) => run.state === "running").length}</td>
                <td data-label="대기">{rows.filter((run) => run.state === "queued" || run.state === "reserved").length}</td>
                <td data-label="마지막 결과">{last ? stateLabels[last.state] : "없음"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function RunList({ actions, runs, state, title }: { actions: AgentRuntimeActions; runs: AgentRunSummary[]; state: AgentRuntimeState; title: string }) {
  return (
    <section aria-label={title} className="agent-run-list">
      <h4>{title}</h4>
      {runs.length === 0 ? <p>표시할 항목이 없습니다.</p> : (
        <ul>{runs.map((run) => (
          <li key={run.runId}>
            <header><strong>{stateLabels[run.state]}</strong><span>{roleLabels[run.role] ?? run.role} · {run.provider}</span></header>
            <p>프로젝트 {run.projectId} · 대상 {run.targetId ?? "없음"}</p>
            <p>시작 {run.startedAt ?? "기록 없음"} · 경과 {elapsed(run.startedAt)}</p>
            {run.reason && <p>종료·대기 사유: {reasonLabel(run.reason)}</p>}
            {run.failureStage && <p>종료 단계: {run.failureStage}</p>}
            {run.previousRunId && <p>이전 실행: {run.previousRunId}</p>}
            <div className="agent-plan-actions">
              {(run.state === "running" || run.state === "queued" || run.state === "paused") && (
                <button disabled={state.controllingRunId === run.runId} onClick={() => void actions.previewCancel(run.runId)} type="button">취소 계획</button>
              )}
              {(run.state === "failed" || run.state === "cancelled" || run.state === "recovery_required") && (
                <button disabled={state.controllingRunId === run.runId} onClick={() => actions.previewRetry(run.runId)} type="button">재시도 계획</button>
              )}
              <button disabled={state.readingLogRunId === run.runId} onClick={() => void actions.readRunLog(run.runId)} type="button">{state.logs[run.runId] ? "로그 더 읽기" : "로그 보기"}</button>
            </div>
            {state.logs[run.runId] && (
              <ol aria-label={`${run.runId} 구조화 이벤트`} className="agent-run-events">
                {state.logs[run.runId].events.map((event, index) => <li key={index}>{safeEvent(event)}</li>)}
              </ol>
            )}
          </li>
        ))}</ul>
      )}
    </section>
  );
}

function elapsed(startedAt: string | null): string {
  if (!startedAt) return "계산 불가";
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return "계산 불가";
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1_000));
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

function reasonLabel(reason: string): string {
  const labels: Array<[RegExp, string]> = [
    [/no.?target|대상 없음/i, "대상 없음"],
    [/migration|마이그레이션/i, "마이그레이션 잠금"],
    [/quota|limit|한도/i, "실행 한도 소진"],
    [/auth|login|인증/i, "provider 인증 문제"],
    [/billing|usage|사용 제한/i, "provider 사용 제한"],
    [/paused|일시 정지/i, "프로젝트 일시 정지"],
    [/slot/i, "실행 슬롯 부족"],
  ];
  return labels.find(([pattern]) => pattern.test(reason))?.[1] ?? reason;
}

/** 로그는 화면에 필요한 구조화 진행 필드만 허용한다. prompt·인증·비밀 필드는 DOM에 닿지 않는다. */
function safeEvent(event: unknown): string {
  if (typeof event === "string") return "런타임 이벤트";
  if (!event || typeof event !== "object") return String(event ?? "이벤트");
  const row = event as Record<string, unknown>;
  const allowed = ["timestamp", "time", "stage", "status", "progress", "message", "detail", "kind"];
  const parts = allowed
    .filter((key) => row[key] !== undefined && typeof row[key] !== "object")
    .map((key) => `${key}: ${safeEventValue(row[key])}`);
  return parts.length ? parts.join(" · ") : "구조화 이벤트";
}

function safeEventValue(value: unknown): string {
  const text = String(value);
  return /prompt|api.?key|token|authorization|bearer|secret/i.test(text)
    ? "[민감정보 제거됨]"
    : text;
}
