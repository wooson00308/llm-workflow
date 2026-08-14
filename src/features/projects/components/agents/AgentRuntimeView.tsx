import { useEffect, useState } from "react";
import type {
  AgentProjectConsent,
  AgentProviderDiagnosis,
  AgentRuntimeActions,
  AgentRuntimeOperation,
  AgentRuntimeState,
  ProjectSummary,
} from "../../domain/types";
import { AgentRoleSettings } from "./AgentRoleSettings";
import { AgentRunDashboard, humanRuntimeMessage } from "./AgentRunDashboard";

/**
 * 사용자가 동의한 고지의 버전. 실행 환경이 요구하는 버전과 같아야 동의가 유효하다.
 *
 * 문구와 버전을 한자리에 두는 것은 동의 기록이 "이 문구를 읽었다"는 뜻이기 때문이다. 둘이 다른
 * 파일에 흩어지면 문구만 바뀌고 버전이 그대로 남아 기록과 실제 읽은 내용이 어긋난다. 문구의
 * 의미가 바뀌어 사용자가 다시 읽어야 할 때만 이 값을 올린다.
 */
export const EXECUTION_NOTICE_VERSION = 1;

/** 동의 화면이 반드시 알리는 다섯 가지 사실. 화면 배치가 달라도 이 다섯 개는 함께 나온다. */
export const EXECUTION_NOTICE_FACTS = [
  "역할 세션은 앱을 닫아도 백그라운드에서 병렬로 동작할 수 있습니다.",
  "세션은 작업마다 다시 묻지 않고 파일을 읽고 만들고 수정하거나 삭제하며 명령을 실행할 수 있습니다.",
  "세션은 운영체제 사용자 계정과 실행 도구가 허용하는 네트워크와 인증 환경을 사용할 수 있습니다.",
  "이 권한은 에이전트 기능의 필수 전제이며 제한 모드는 제공하지 않습니다.",
  "사용자 승인과 품질 확인처럼 워크플로가 사람에게 남긴 판단 관문은 계속 사람이 수행합니다.",
];

/**
 * 동의를 물어볼 수 없는 상태의 안내. 두 상태를 같은 문장으로 묶지 않는 것은 사용자가 할 일이
 * 다르기 때문이다. 어느 쪽도 동의한 것으로 다루지 않는다.
 */
export function consentBlockMessage(consent: AgentProjectConsent) {
  if (consent.status === "unsupported") return "실행 환경이 실행 권한 동의를 지원하지 않습니다. 실행 환경을 업데이트한 뒤 다시 시도해 주세요.";
  if (consent.status === "unreadable") return `실행 권한 동의 상태를 확인하지 못했습니다. ${consent.detail ?? "사유를 확인하지 못했습니다."} 실행 환경을 확인한 뒤 다시 시도해 주세요.`;
  return null;
}

/** 동의를 기록하지 못한 사유. 요구 버전이 앱의 고지 버전보다 높은 경우는 앱 업데이트로 안내한다. */
export function consentFailureMessage(message: string) {
  return /consent_notice_outdated/.test(message)
    ? "실행 환경이 더 최신 고지에 대한 동의를 요구합니다. 앱을 업데이트한 뒤 다시 동의해 주세요."
    : humanRuntimeMessage(message);
}

/** 고지 전문과 확인 항목. 자동 배정 켜기와 직접 배정 확정이 같은 문구를 읽는다. */
export function ExecutionNotice({ checked, onChange }: { checked: boolean; onChange(next: boolean): void }) {
  return (
    <section className="agent-consent-notice">
      <strong>실행 권한 고지</strong>
      <ul>{EXECUTION_NOTICE_FACTS.map((fact) => <li key={fact}>{fact}</li>)}</ul>
      <label className="agent-consent-check">
        <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
        <span>위 내용을 읽고 실행 권한에 동의합니다</span>
      </label>
    </section>
  );
}

interface Readiness {
  tone: "ready" | "attention" | "blocked";
  title: string;
  detail: string;
  operation: AgentRuntimeOperation | null;
  actionLabel: string | null;
}

export function readinessOf(state: AgentRuntimeState): Readiness {
  const inspection = state.inspection;
  if (!inspection) return { tone: "attention", title: "실행 환경 확인 중", detail: "기기 상태를 읽고 있습니다.", operation: null, actionLabel: null };
  if (inspection.unavailable) return { tone: "blocked", title: "실행 환경 복구 필요", detail: inspection.unavailable, operation: "install", actionLabel: "설치 계획" };
  if (!inspection.status) return { tone: "attention", title: "실행 환경 설치 필요", detail: "앱에 포함된 런타임을 설치하면 자동 배정을 사용할 수 있습니다.", operation: "install", actionLabel: "설치 계획" };
  switch (inspection.compatibility?.kind) {
    case "compatible": {
      const service = inspection.status.service;
      const launcher = `${inspection.installRoot.replace(/[\\/]+$/, "")}/bin/heartbeat`;
      const executable = service.executable?.replace(/\\/g, "/").replace(/\.exe$/i, "") ?? null;
      const managed = executable === launcher.replace(/\\/g, "/");
      if (service.registered !== true) return { tone: "attention", title: "자동 배정 서비스 연결 필요", detail: "직접 배정은 사용할 수 있습니다. 자동 배정을 계속 실행하려면 관리형 서비스를 연결해 주세요.", operation: "install", actionLabel: "연결 계획" };
      if (!managed) return { tone: "attention", title: "자동 배정 서비스 전환 필요", detail: "기존 Heartbeat 서비스는 그대로 보존했습니다. 고급 설정의 기존 설정 이전에서 중복 없이 전환해 주세요.", operation: null, actionLabel: null };
      if (service.running !== true) return { tone: "attention", title: "자동 배정 서비스 복구 필요", detail: "직접 배정은 사용할 수 있습니다. 관리형 서비스가 다시 실행되도록 복구해 주세요.", operation: "repair", actionLabel: "복구 계획" };
      return { tone: "ready", title: "실행 환경 정상", detail: "자동 배정과 직접 배정을 사용할 수 있습니다.", operation: null, actionLabel: null };
    }
    case "restartRequired": return { tone: "attention", title: "실행 환경 재시작 필요", detail: "설치된 버전과 실행 중인 버전이 다릅니다.", operation: "repair", actionLabel: "복구 계획" };
    case "unsupportedApiMajor":
    case "versionOutOfRange": return { tone: "blocked", title: "실행 환경 업데이트 필요", detail: "이 앱과 맞는 런타임으로 업데이트해야 합니다.", operation: "install", actionLabel: "업데이트 계획" };
    case "undetermined": return { tone: "blocked", title: "실행 환경 확인 필요", detail: inspection.compatibility.reason, operation: "repair", actionLabel: "복구 계획" };
    default: return { tone: "attention", title: "실행 환경 확인 중", detail: "호환 상태를 읽고 있습니다.", operation: null, actionLabel: null };
  }
}

interface Props {
  actions: AgentRuntimeActions;
  project?: ProjectSummary;
  /** 구형 임베더 호환. 새 화면은 project의 실제 후보를 사용한다. */
  projectName?: string;
  state: AgentRuntimeState;
}

export function AgentRuntimeView({ actions, project, projectName, state }: Props) {
  const [directAssignOpen, setDirectAssignOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [enableConfirmOpen, setEnableConfirmOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const readiness = readinessOf(state);
  const currentProject = project ?? emptyProject(projectName ?? "프로젝트");
  const policy = state.policy?.policy;
  const consent = state.policy?.consent ?? null;
  const automationEnabled = policy?.automationEnabled ?? false;
  const automationReady = readiness.tone === "ready";
  const runtimeVersion = state.inspection?.status?.runningVersion
    ?? state.inspection?.status?.installedVersion
    ?? state.inspection?.bundledVersion;

  useEffect(() => {
    actions.setViewActive?.(true);
    return () => actions.setViewActive?.(false);
  }, [actions]);

  async function disableAutomation() {
    if (!policy) return;
    await actions.save({ ...policy, automationEnabled: false });
  }

  return (
    <section className="agents-view agent-cockpit">
      <header className="agent-cockpit-heading">
        <div>
          <p className="eyebrow">AGENTS</p>
          <h1>에이전트</h1>
          <p>{currentProject.name}의 작업 배정과 진행 상황</p>
        </div>
        <div className="agent-cockpit-actions">
          <span className={`agent-runtime-pill tone-${readiness.tone}`} title={readiness.detail}>
            <i aria-hidden="true" />{readiness.title}{runtimeVersion && <small>{runtimeVersion}</small>}
          </span>
          <button className="secondary-button agent-compact-action" disabled={!state.policy?.executionAllowed} onClick={() => setDirectAssignOpen(true)} type="button">직접 배정</button>
          <button className="secondary-button agent-compact-action" onClick={() => setAdvancedOpen(true)} type="button">고급 설정</button>
        </div>
      </header>

      <section aria-label="자동 배정" className={`agent-automation-master ${automationEnabled ? "is-on" : ""}`}>
        <div><strong>자동 배정</strong><p>{automationEnabled ? "새 작업을 감지하면 빈 자리에 안전하게 배정합니다." : "직접 배정만 사용합니다. 켜기 전에는 자동으로 시작하지 않습니다."}</p></div>
        <label className="agent-switch" title={automationReady ? undefined : "실행 환경 전환을 마친 뒤 켤 수 있습니다."}><input aria-label="자동 배정 켜기" checked={automationEnabled} disabled={!policy || state.saving || (!automationEnabled && !automationReady)} onChange={(event) => { if (event.target.checked) setEnableConfirmOpen(true); else void disableAutomation(); }} type="checkbox" /><span aria-hidden="true" /></label>
      </section>

      {automationEnabled && consent?.status === "required" && (
        <section className="agent-runtime-attention" role="status">
          <div><strong>실행 권한 동의 필요</strong><p>자동 배정이 켜져 있지만 실행 권한에 동의하기 전에는 새 세션을 시작하지 않습니다.</p></div>
          <button className="secondary-button agent-compact-action" onClick={() => setConsentOpen(true)} type="button">고지 읽고 동의</button>
        </section>
      )}

      {readiness.tone !== "ready" && (
        <section className="agent-runtime-attention" role="status">
          <div><strong>{readiness.title}</strong><p>{readiness.detail}</p></div>
          {readiness.operation && <button className="secondary-button agent-compact-action" onClick={() => void actions.plan(readiness.operation!)} type="button">{readiness.actionLabel}</button>}
          {!readiness.operation && readiness.title === "자동 배정 서비스 전환 필요" && <button className="secondary-button agent-compact-action" onClick={() => setAdvancedOpen(true)} type="button">전환 준비</button>}
        </section>
      )}
      {state.readError && <p className="agent-error" role="status">실행 환경 상태를 읽지 못했습니다. 잠시 후 자동으로 다시 확인합니다.</p>}
      {state.planError && <p className="agent-error" role="status">{humanRuntimeMessage(state.planError)}</p>}
      {state.applyError && <p className="agent-error" role="status">{humanRuntimeMessage(state.applyError)}</p>}

      {state.policy ? (
        <AgentRunDashboard actions={actions} directAssignOpen={directAssignOpen} onCloseDirectAssign={() => setDirectAssignOpen(false)} project={currentProject} state={state} />
      ) : (
        <p className="agent-quiet-empty">에이전트 설정을 읽는 중입니다.</p>
      )}

      {enableConfirmOpen && policy && (
        <AutomationConfirm actions={actions} onClose={() => setEnableConfirmOpen(false)} policy={policy} state={state} />
      )}
      {consentOpen && consent && (
        <ExecutionConsentDialog actions={actions} consent={consent} onClose={() => setConsentOpen(false)} state={state} />
      )}
      {advancedOpen && (
        <AdvancedDrawer actions={actions} onClose={() => setAdvancedOpen(false)} projectName={currentProject.name} readiness={readiness} state={state} />
      )}
      {state.plan && <RuntimePlanDialog actions={actions} state={state} />}
    </section>
  );
}

function AutomationConfirm({ actions, onClose, policy, state }: {
  actions: AgentRuntimeActions;
  onClose(): void;
  policy: NonNullable<AgentRuntimeState["policy"]>["policy"];
  state: AgentRuntimeState;
}) {
  const [roles, setRoles] = useState<Record<string, boolean>>(() => Object.fromEntries(Object.keys(policy.roles).map((role) => [role, true])));
  const [agreed, setAgreed] = useState(false);
  const consent = state.policy?.consent ?? null;
  const blocked = consent ? consentBlockMessage(consent) : null;
  const consentRequired = consent?.status === "required";
  useDismissOnEscape(onClose);
  async function enable() {
    // 동의를 기록하지 못하면 저장으로 넘어가지 않는다. 실행을 여는 것은 저장이므로, 여기서 이어
    // 가면 사용자가 읽지 않은 권한으로 세션이 시작된다.
    if (consentRequired && !(await actions.grantConsent(EXECUTION_NOTICE_VERSION))) return;
    const changed = {
      ...policy,
      automationEnabled: true,
      roles: Object.fromEntries(Object.entries(policy.roles).map(([role, value]) => [role, {
        ...value,
        enabled: roles[role],
        runMode: roles[role] ? "continuous" : "once",
      }])),
    };
    if (await actions.save(changed)) onClose();
  }
  return (
    <div className="agent-overlay">
      <section aria-labelledby="automation-confirm-title" aria-modal="true" className="agent-dialog" role="dialog">
        <header><div><p className="eyebrow">AUTO ASSIGN</p><h2 id="automation-confirm-title">자동 배정 켜기</h2></div><button aria-label="닫기" onClick={onClose} type="button">×</button></header>
        {blocked && <p className="agent-error" role="status">{blocked}</p>}
        {consentRequired && <ExecutionNotice checked={agreed} onChange={setAgreed} />}
        <p className="agent-dialog-note">선택한 역할이 작업을 감지하면 프로젝트와 기기 한도 안에서 세션을 시작합니다. 여러 유료 세션이 동시에 실행될 수 있습니다.</p>
        <fieldset><legend>참여 역할</legend>{Object.keys(policy.roles).map((role) => <label className="agent-role-toggle" key={role}><input checked={roles[role]} onChange={(event) => setRoles((current) => ({ ...current, [role]: event.target.checked }))} type="checkbox" /><span>{roleName(role)}</span><small>최대 {policy.roles[role].maxParallel}명</small></label>)}</fieldset>
        {state.consentError && <p className="agent-error" role="status">{consentFailureMessage(state.consentError)}</p>}
        <footer><button className="secondary-button" onClick={onClose} type="button">취소</button>{!blocked && <button className="stamp-button" disabled={!Object.values(roles).some(Boolean) || (consentRequired && !agreed) || state.consentBusy} onClick={() => void enable()} type="button">{consentRequired ? "동의하고 자동 배정 켜기" : "자동 배정 켜기"}</button>}</footer>
      </section>
    </div>
  );
}

/**
 * 이어질 행동 없이 동의만 남기는 화면. 자동 배정이 이미 켜진 프로젝트에서 동의만 다시 받는 자리와,
 * 실행 환경이 동의 부족으로 시작을 거절한 자리에서 함께 쓴다. 설정을 저장하지 않는다.
 */
export function ExecutionConsentDialog({ actions, consent, onClose, state }: {
  actions: AgentRuntimeActions;
  consent: AgentProjectConsent;
  onClose(): void;
  state: AgentRuntimeState;
}) {
  const [agreed, setAgreed] = useState(false);
  const blocked = consentBlockMessage(consent);
  useDismissOnEscape(onClose);
  async function grant() {
    if (await actions.grantConsent(EXECUTION_NOTICE_VERSION)) onClose();
  }
  return (
    <div className="agent-overlay">
      <section aria-labelledby="execution-consent-title" aria-modal="true" className="agent-dialog" role="dialog">
        <header><div><p className="eyebrow">CONSENT</p><h2 id="execution-consent-title">실행 권한 동의</h2></div><button aria-label="닫기" onClick={onClose} type="button">×</button></header>
        {blocked ? <p className="agent-error" role="status">{blocked}</p> : <ExecutionNotice checked={agreed} onChange={setAgreed} />}
        {state.consentError && <p className="agent-error" role="status">{consentFailureMessage(state.consentError)}</p>}
        <footer><button className="secondary-button" onClick={onClose} type="button">취소</button>{!blocked && <button className="stamp-button" disabled={!agreed || state.consentBusy} onClick={() => void grant()} type="button">동의하고 계속</button>}</footer>
      </section>
    </div>
  );
}

function AdvancedDrawer({ actions, onClose, projectName, readiness, state }: {
  actions: AgentRuntimeActions;
  onClose(): void;
  projectName: string;
  readiness: Readiness;
  state: AgentRuntimeState;
}) {
  const providerAttention = state.policy?.providers.some((provider) => provider.status !== "ready") ?? false;
  const migrationRequired = readiness.title === "자동 배정 서비스 전환 필요";
  useDismissOnEscape(onClose);
  return (
    <div className="agent-drawer-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside aria-label="고급 설정" aria-modal="true" className="agent-detail-drawer agent-settings-drawer" role="dialog">
        <header><div><p className="eyebrow">ADVANCED</p><h2>고급 설정</h2><small>{projectName}</small></div><button aria-label="닫기" onClick={onClose} type="button">×</button></header>
        {state.policy && <AgentRoleSettings busy={state.reading} executionAllowed={state.policy.executionAllowed} onSave={actions.save} saveError={state.saveError} saving={state.saving} snapshot={state.policy} />}
        {state.policy && <ConsentSettings actions={actions} consent={state.policy.consent} state={state} />}
        <details open={readiness.tone !== "ready"}><summary>실행 환경</summary><div className="agent-secondary-content"><p>{readiness.detail}</p>{readiness.operation && <button className="secondary-button agent-compact-action" onClick={() => void actions.plan(readiness.operation!)} type="button">{readiness.actionLabel}</button>}</div></details>
        <details open={providerAttention}><summary>실행 도구</summary><ul className="agent-provider-list">{state.policy?.providers.map((provider) => <li key={provider.provider}><ProviderRow diagnosis={provider} /></li>)}</ul></details>
        <details open={migrationRequired || state.migration !== null || state.migrationError !== null}><summary>기존 설정 이전</summary><div className="agent-secondary-content"><p>앱이 관리하던 역할 잡은 중지하고, 기존 외부 서비스 파일은 그대로 보존한 채 새 자동 배정 서비스로 전환합니다. 검증에 실패하면 역할 잡과 서비스를 원래대로 복구합니다.</p><button className="secondary-button agent-compact-action" disabled={state.migrationBusy} onClick={() => void actions.previewMigration()} type="button">전환할 설정 확인</button>{state.migrationError && <p className="agent-error">{state.migrationError}</p>}{state.migration && <div className="agent-migration-preview"><strong>전환할 역할 설정</strong><ul>{Object.entries(state.migration.proposed.roles).map(([role, value]) => <li key={role}>{roleName(role)} · {value.provider} · 최대 {value.maxParallel}명</li>)}</ul><div className="agent-plan-actions"><button onClick={() => actions.dismissMigration()} type="button">취소</button><button className="stamp-button" onClick={() => void actions.applyMigration()} type="button">검증하고 전환</button></div></div>}</div></details>
      </aside>
    </div>
  );
}

/** 고급 설정의 동의 상태 자리. 지금 동의가 어떤 상태인지 보여 주고 철회를 여기서만 받는다. */
function ConsentSettings({ actions, consent, state }: {
  actions: AgentRuntimeActions;
  consent: AgentProjectConsent;
  state: AgentRuntimeState;
}) {
  const [revokeOpen, setRevokeOpen] = useState(false);
  const granted = consent.status === "granted";
  return (
    <details open={consent.status !== "granted"}>
      <summary>실행 권한 동의</summary>
      <div className="agent-secondary-content">
        <ul className="agent-consent-facts">
          <li><strong>동의 여부</strong><span>{consentStatusLabel(consent.status)}</span></li>
          <li><strong>동의 시각</strong><span>{consent.grantedAt ? new Date(consent.grantedAt).toLocaleString() : "기록 없음"}</span></li>
          <li><strong>고지 버전</strong><span>{consent.noticeVersion ?? "기록 없음"}</span></li>
        </ul>
        <details><summary>고지 전문 다시 읽기</summary><ul className="agent-consent-notice-list">{EXECUTION_NOTICE_FACTS.map((fact) => <li key={fact}>{fact}</li>)}</ul></details>
        {granted && <button className="secondary-button agent-compact-action" disabled={state.consentBusy} onClick={() => setRevokeOpen(true)} type="button">동의 철회</button>}
        {state.consentError && <p className="agent-error">{consentFailureMessage(state.consentError)}</p>}
      </div>
      {revokeOpen && (
        <div className="agent-overlay">
          <section aria-labelledby="consent-revoke-title" aria-modal="true" className="agent-dialog" role="dialog">
            <header><div><p className="eyebrow">CONSENT</p><h2 id="consent-revoke-title">실행 권한 동의 철회</h2></div><button aria-label="닫기" onClick={() => setRevokeOpen(false)} type="button">×</button></header>
            <p className="agent-dialog-note">이미 실행 중인 세션은 그대로 이어집니다. 끝내려면 실행마다 실행 취소를 사용해 주세요.</p>
            <p className="agent-dialog-note">철회한 뒤에는 자동 배정과 직접 배정이 시작되지 않으며, 다시 실행하려면 최신 고지에 다시 동의해야 합니다.</p>
            <footer><button className="secondary-button" onClick={() => setRevokeOpen(false)} type="button">취소</button><button className="stamp-button" disabled={state.consentBusy} onClick={() => void actions.revokeConsent().then((ok) => { if (ok) setRevokeOpen(false); })} type="button">동의 철회</button></footer>
          </section>
        </div>
      )}
    </details>
  );
}

function consentStatusLabel(status: AgentProjectConsent["status"]) {
  return { granted: "동의함", required: "동의 필요", unsupported: "실행 환경이 지원하지 않음", unreadable: "확인하지 못함" }[status];
}

function RuntimePlanDialog({ actions, state }: { actions: AgentRuntimeActions; state: AgentRuntimeState }) {
  useDismissOnEscape(actions.cancelPlan);
  const plan = state.plan!;
  return (
    <div className="agent-overlay">
      <section aria-label="실행 환경 변경 확인" aria-modal="true" className="agent-dialog" role="dialog">
        <header><div><p className="eyebrow">RUNTIME</p><h2>실행 환경 변경</h2></div><button aria-label="닫기" onClick={() => actions.cancelPlan()} type="button">×</button></header>
        <p className="agent-dialog-note">실행 중인 세션은 유지하고 앱이 관리하는 런타임만 변경합니다.</p>
        <ul className="agent-runtime-plan-summary">
          {plan.kind === "install" ? (
            <>
              <li><strong>버전</strong><span>{plan.plan.installedVersion ?? "설치 안 됨"} → {plan.plan.bundledVersion}</span></li>
              <li><strong>서비스</strong><span>{serviceActionLabel(plan.plan.serviceAction)}</span></li>
            </>
          ) : (
            <>
              <li><strong>버전</strong><span>{plan.plan.installedVersion ?? "확인 안 됨"} → {plan.plan.targetVersion ?? "현재 버전 복구"}</span></li>
              <li><strong>실행 중 세션</strong><span>{plan.plan.activeRuns}개 유지</span></li>
            </>
          )}
        </ul>
        {plan.kind === "install" && plan.plan.serviceAction === "migration_required" && (
          <p className="agent-detail-message">기존 외부 Heartbeat 서비스는 중복 등록하거나 삭제하지 않습니다. 런타임을 교체한 뒤 기존 설정 이전에서 안전한 전환을 이어갑니다.</p>
        )}
        {state.planError && <p className="agent-error">{humanRuntimeMessage(state.planError)}</p>}
        {state.applyError && <p className="agent-error">{humanRuntimeMessage(state.applyError)}</p>}
        <footer><button className="secondary-button" onClick={() => actions.cancelPlan()} type="button">취소</button><button className="stamp-button" disabled={state.applying} onClick={() => void actions.apply()} type="button">{state.applying ? "적용 중" : "적용"}</button></footer>
      </section>
    </div>
  );
}

function serviceActionLabel(action: "register" | "already_managed" | "migration_required" | "unknown") {
  return {
    register: "관리형 서비스를 새로 연결",
    already_managed: "현재 관리형 서비스를 유지",
    migration_required: "기존 외부 서비스를 보존하고 전환 준비",
    unknown: "상태를 다시 확인한 뒤 전환",
  }[action];
}

function ProviderRow({ diagnosis }: { diagnosis: AgentProviderDiagnosis }) {
  const labels: Record<string, string> = { ready: "사용 가능", executable_missing: "CLI 설치 필요", login_required: "로그인 필요", permission_denied: "권한 확인 필요", unsupported_version: "업데이트 필요", billing_route_acknowledgement_required: "과금 경로 확인 필요" };
  return <><strong>{diagnosis.provider}</strong><span>{labels[diagnosis.status] ?? diagnosis.status}</span>{diagnosis.version && <small>{diagnosis.version}</small>}</>;
}

function roleName(role: string) { return ({ planner: "기획자", architect: "아키텍트", developer: "개발자" } as Record<string, string>)[role] ?? role; }

function emptyProject(name: string): ProjectSummary {
  return { rootPath: "", initialized: true, projectId: null, name, compatibility: "current", activeLeases: [], workflows: [], pendingWork: { planner: false, architect: false, developer: false } };
}

function useDismissOnEscape(onDismiss: () => void) {
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [onDismiss]);
}
