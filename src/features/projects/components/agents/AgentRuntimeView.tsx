import { Icon } from "../../../../shared/ui/Icon";
import type {
  AgentCompatibility,
  AgentInstallPlan,
  AgentInstallServiceAction,
  AgentProviderDiagnosis,
  AgentRuntimeActions,
  AgentRuntimeOperation,
  AgentRuntimeState,
} from "../../domain/types";
import { AgentRoleSettings } from "./AgentRoleSettings";
import { AgentRunDashboard } from "./AgentRunDashboard";

/**
 * 준비 상태 하나. 제목과 설명과 사용자가 할 다음 행동을 함께 든다. 상태마다 다음 행동이 다르므로
 * 사유를 하나로 접지 않는다.
 */
interface Readiness {
  tone: "ready" | "attention" | "blocked";
  title: string;
  detail: string;
  /** 앱이 대신 실행할 수 있는 조작. 없으면 사용자가 밖에서 할 일이라는 뜻이다. */
  operation: AgentRuntimeOperation | null;
  actionLabel: string | null;
}

/**
 * provider 진단 값의 뜻과 다음 행동. 런타임 계약이 정한 여섯 값이고, 그 밖의 값이 오면 화면은
 * 문자열을 그대로 보여준다 — 모르는 값을 숨기면 계약을 벗어난 런타임이 정상으로 보인다.
 */
const providerDiagnoses: Record<string, { title: string; action: string }> = {
  ready: { title: "실행 준비됨", action: "추가로 할 일이 없습니다." },
  executable_missing: {
    title: "CLI가 설치돼 있지 않음",
    action: "해당 도구의 CLI를 설치한 뒤 다시 조회해 주세요.",
  },
  login_required: {
    title: "로그인이 필요함",
    action: "터미널에서 그 도구에 로그인해 주세요. 앱은 토큰을 입력받지 않습니다.",
  },
  permission_denied: {
    title: "실행 권한이 없음",
    action: "실행 파일의 권한을 확인해 주세요.",
  },
  unsupported_version: {
    title: "지원하지 않는 버전",
    action: "그 도구를 지원 버전으로 올린 뒤 다시 조회해 주세요.",
  },
  billing_route_acknowledgement_required: {
    title: "API 과금 경로 확인이 필요함",
    action: "구독이 아닌 API 과금으로 실행될 수 있습니다. 도구 쪽에서 과금 경로를 확인해 주세요.",
  },
};

const installServiceActionLabels: Record<AgentInstallServiceAction, string> = {
  register: "새 서비스 등록",
  already_managed: "관리 중인 서비스 유지",
  migration_required: "기존 서비스 이전 필요",
  unknown: "서비스 상태 확인 필요",
};

function serviceFact(value: string | null | undefined, fallback = "확인 불가") {
  return value?.trim() ? value : fallback;
}

function triState(value: boolean | null | undefined) {
  if (value === true) return "예";
  if (value === false) return "아니요";
  return "확인 불가";
}

function installServiceGuidance(plan: AgentInstallPlan) {
  const label = serviceFact(plan.service?.label);
  const executable = serviceFact(plan.service?.executable);
  switch (plan.serviceAction) {
    case "register":
      return "등록된 서비스가 없어 런타임 파일과 stable launcher를 설치한 뒤 새 서비스를 한 번 등록합니다.";
    case "already_managed":
      return plan.service?.running === true
        ? "stable launcher를 가리키는 관리형 서비스가 이미 실행 중입니다. 기존 등록을 유지하고 중복 등록하지 않습니다."
        : "stable launcher를 가리키는 관리형 서비스가 등록돼 있지만 실행 중이 아닙니다. 기존 등록을 유지하고 등록을 반복하지 않으며, 적용 뒤 다시 읽어 복구 계획을 확인합니다.";
    case "migration_required":
      return `기존 서비스 ${label} (${executable})를 그대로 유지합니다. 이 계획은 런타임 파일과 launcher만 놓고 서비스를 삭제·중지·덮어쓰기·중복 등록하지 않습니다. 아래 ‘기존 역할 잡 이전’에서 이전 미리보기를 확인하세요.`;
    case "unknown":
      return "서비스 상태를 확인하지 못해 서비스는 변경하지 않습니다. 이 계획은 런타임 파일과 launcher만 놓고 서비스 단계를 남기며, 다시 읽은 뒤 새 계획을 만들어야 합니다.";
  }
}

/**
 * 기기 상태에서 준비 영역의 문구와 버튼을 정한다.
 *
 * 앞의 사유가 뒤의 사유를 가린다. 런타임을 부르지 못한 상태에서 버전 이야기를 하지 않고, 설치되지
 * 않은 상태에서 재시작 이야기를 하지 않는다.
 */
export function readinessOf(state: AgentRuntimeState): Readiness {
  const { inspection } = state;
  if (!inspection) {
    return {
      tone: "attention",
      title: "준비 상태를 아직 읽지 않았습니다",
      detail: "다시 읽기를 눌러 이 기기의 상태를 확인해 주세요.",
      operation: null,
      actionLabel: null,
    };
  }
  if (inspection.unavailable !== null) {
    return {
      tone: "blocked",
      title: "실행 환경을 확인하지 못했습니다",
      detail: inspection.unavailable,
      operation: "install",
      actionLabel: "설치 계획 보기",
    };
  }
  if (!inspection.status) {
    return {
      tone: "attention",
      title: "실행 환경이 설치돼 있지 않습니다",
      detail: `앱이 들고 있는 버전 ${inspection.bundledVersion ?? "확인 불가"}을 설치할 수 있습니다.`,
      operation: "install",
      actionLabel: "설치 계획 보기",
    };
  }
  return readinessOfCompatibility(state.inspection?.compatibility, inspection.bundledVersion);
}

function readinessOfCompatibility(
  compatibility: AgentCompatibility | undefined,
  bundledVersion: string | null,
): Readiness {
  switch (compatibility?.kind) {
    case "compatible":
      return {
        tone: "ready",
        title: "실행 환경이 준비됐습니다",
        detail: "역할 정책을 저장하면 그대로 적용됩니다.",
        operation: "update",
        actionLabel: "업데이트 계획 보기",
      };
    case "restartRequired":
      return {
        tone: "attention",
        title: "설치된 버전과 도는 버전이 다릅니다",
        detail: `디스크는 ${compatibility.installed}이고 지금 도는 것은 ${compatibility.running}입니다. 복구를 실행하면 도는 쪽을 맞춥니다.`,
        operation: "repair",
        actionLabel: "복구 계획 보기",
      };
    case "unsupportedApiMajor":
      return {
        tone: "blocked",
        title: "이 앱과 통하지 않는 런타임입니다",
        detail: `런타임이 API ${compatibility.found}로 답했고 이 앱은 ${compatibility.supported}만 다룹니다. 업데이트로 맞춰야 합니다.`,
        operation: "update",
        actionLabel: "업데이트 계획 보기",
      };
    case "versionOutOfRange":
      return {
        tone: "blocked",
        title: "지원 범위 밖 버전입니다",
        detail: `설치본은 ${compatibility.found}이고 이 앱은 ${compatibility.minimum}부터 ${compatibility.maximum}까지 다룹니다.${
          bundledVersion ? ` 앱이 들고 있는 버전은 ${bundledVersion}입니다.` : ""
        }`,
        operation: "update",
        actionLabel: "업데이트 계획 보기",
      };
    case "undetermined":
      return {
        tone: "blocked",
        title: "호환 여부를 확인하지 못했습니다",
        detail: `런타임이 ${compatibility.reason}으로 답해 판정에 필요한 값을 읽지 못했습니다. 확인하지 못한 기기에서는 실행을 열지 않습니다.`,
        operation: "repair",
        actionLabel: "복구 계획 보기",
      };
    default:
      return {
        tone: "attention",
        title: "준비 상태를 아직 읽지 않았습니다",
        detail: "다시 읽기를 눌러 이 기기의 상태를 확인해 주세요.",
        operation: null,
        actionLabel: null,
      };
  }
}

interface Props {
  actions: AgentRuntimeActions;
  /** 이 화면이 설정을 저장할 프로젝트. 폼과 저장 대상이 같은 값을 본다. */
  projectName: string;
  state: AgentRuntimeState;
}

/**
 * 프로젝트의 에이전트 화면. 준비 상태와 역할 정책을 한 자리에서 다룬다.
 *
 * 화면에 들어오는 것과 다시 읽기는 조회 명령만 부른다. 설치·업데이트·복구·마이그레이션·저장은 모두
 * 사용자가 누른 자리에서만 시작하고, 계획을 보여 준 뒤에만 적용 버튼이 열린다.
 */
export function AgentRuntimeView({ actions, projectName, state }: Props) {
  const readiness = readinessOf(state);
  const pending = state.plan;

  return (
    <section className="agents-view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">AGENTS</p>
          <h1>에이전트</h1>
          <p>{projectName}에서 어떤 역할을 어떤 도구로 돌릴지 정합니다.</p>
        </div>
        <button
          className="secondary-button"
          disabled={state.reading}
          onClick={() => void actions.refresh()}
          type="button"
        >
          {state.reading ? "읽는 중" : "다시 읽기"}
        </button>
      </div>

      <section aria-label="실행 환경 준비 상태" className={`agent-readiness tone-${readiness.tone}`}>
        <Icon name={readiness.tone === "ready" ? "spark" : "board"} />
        <div>
          <strong>{readiness.title}</strong>
          <p>{readiness.detail}</p>
          {state.inspection?.status && (
            <p className="agent-versions">
              설치 {state.inspection.status.installedVersion ?? "확인 불가"} · 실행{" "}
              {state.inspection.status.runningVersion ?? "확인 불가"} · 앱 번들{" "}
              {state.inspection.bundledVersion ?? "확인 불가"}
            </p>
          )}
        </div>
        {readiness.operation && readiness.actionLabel && (
          <button
            className="secondary-button"
            disabled={state.planning !== null || state.applying}
            onClick={() => void actions.plan(readiness.operation as AgentRuntimeOperation)}
            type="button"
          >
            {state.planning === readiness.operation ? "계획을 만드는 중" : readiness.actionLabel}
          </button>
        )}
      </section>

      {state.readError !== null && (
        <p className="agent-error" role="status">
          {state.readError}
        </p>
      )}
      {state.planError !== null && (
        <p className="agent-error" role="status">
          {state.planError}
        </p>
      )}

      {pending && (
        <section aria-label="확인 대기 중인 계획" className="agent-plan">
          <strong>
            {pending.kind === "install"
              ? "설치 계획"
              : pending.kind === "update"
                ? "업데이트 계획"
                : "복구 계획"}
          </strong>
          <dl>
            {pending.kind === "install" ? (
              <>
                <div>
                  <dt>설치할 버전</dt>
                  <dd>{pending.plan.bundledVersion}</dd>
                </div>
                <div>
                  <dt>설치 위치</dt>
                  <dd>{pending.plan.versionDirectory}</dd>
                </div>
                <div>
                  <dt>서비스 전환</dt>
                  <dd>{pending.plan.serviceTransitionRequired ? "필요함" : "필요 없음"}</dd>
                </div>
                <div>
                  <dt>처리 방법</dt>
                  <dd>{installServiceActionLabels[pending.plan.serviceAction]}</dd>
                </div>
                <div>
                  <dt>서비스 신원</dt>
                  <dd>
                    {pending.plan.serviceAction === "register"
                      ? "등록된 서비스 없음"
                      : `${serviceFact(pending.plan.service?.label)} · ${serviceFact(pending.plan.service?.executable)}`}
                  </dd>
                </div>
                <div>
                  <dt>등록 / 실행</dt>
                  <dd>
                    {triState(pending.plan.service?.registered)} / {triState(pending.plan.service?.running)}
                  </dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt>목표 버전</dt>
                  <dd>{pending.plan.targetVersion ?? "확인 불가"}</dd>
                </div>
                <div>
                  <dt>실행 중인 작업</dt>
                  <dd>
                    {pending.plan.activeRuns}건
                    {pending.plan.activeRuns > 0 && " · 적용하면 그 세션이 끊길 수 있습니다"}
                  </dd>
                </div>
                <div>
                  <dt>영향받는 프로젝트</dt>
                  <dd>
                    {pending.plan.projects.length === 0
                      ? "없음"
                      : `${pending.plan.projects.length}개 · ${pending.plan.projects.join(", ")}`}
                  </dd>
                </div>
                <div>
                  <dt>실패 시 되돌리기</dt>
                  <dd>{pending.plan.recoverableOnFailure ? "가능" : "불가"}</dd>
                </div>
              </>
            )}
          </dl>
          {pending.kind === "install" && (
            <p
              className={
                pending.plan.serviceAction === "migration_required" ||
                pending.plan.serviceAction === "unknown"
                  ? "agent-blocked-note"
                  : "agent-migration-note"
              }
            >
              {installServiceGuidance(pending.plan)}
            </p>
          )}
          <div className="agent-plan-actions">
            <button
              className="secondary-button"
              disabled={state.applying}
              onClick={() => actions.cancelPlan()}
              type="button"
            >
              취소
            </button>
            <button
              className="stamp-button"
              disabled={state.applying}
              onClick={() => void actions.apply()}
              type="button"
            >
              {state.applying ? "적용하는 중" : "이 계획을 적용"}
            </button>
          </div>
        </section>
      )}

      {state.applyError !== null && (
        <p className="agent-error" role="status">
          {state.applyError}
        </p>
      )}

      {state.application && (
        <section aria-label="마지막 적용 결과" className="agent-application">
          <strong>마지막 적용 결과: {state.application.result.result}</strong>
          <ul>
            {state.application.result.stages.map((stage, index) => (
              <li key={`${stage.stage}:${index}`}>
                {stage.stage} · {stage.status}
                {stage.detail ? ` · ${stage.detail}` : ""}
              </li>
            ))}
          </ul>
          {state.application.kind !== "install" &&
            state.application.result.recoveryActions.length > 0 && (
              <p>복구 행동: {state.application.result.recoveryActions.join(", ")}</p>
            )}
        </section>
      )}

      {state.policy && (
        <section aria-label="실행 도구 준비 상태" className="agent-providers">
          <h3>실행 도구</h3>
          <ul>
            {state.policy.providers.map((provider) => (
              <li key={provider.provider}>
                <ProviderRow diagnosis={provider} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.policy && <AgentRunDashboard actions={actions} state={state} />}

      <section aria-label="기존 역할 잡 이전" className="agent-migration">
        <h3>기존 역할 잡 이전</h3>
        <p>기존 하트비트 역할 잡이 있으면 이 프로젝트의 역할 정책으로 옮길 수 있습니다.</p>
        <button
          className="secondary-button"
          disabled={state.migrationBusy}
          onClick={() => void actions.previewMigration()}
          type="button"
        >
          {state.migrationBusy ? "확인하는 중" : "이전 미리보기"}
        </button>
        {state.migrationError !== null && (
          <p className="agent-error" role="status">
            {state.migrationError}
          </p>
        )}
        {state.migration && (
          <div className="agent-migration-preview">
            <strong>확인 전에는 아무것도 저장되지 않습니다</strong>
            <ul>
              {Object.entries(state.migration.proposed.roles).map(([role, value]) => (
                <li key={role}>
                  {role}: {value.provider} · {value.model ?? "기본 모델"} · 최대 {value.maxParallel}명
                </li>
              ))}
            </ul>
            {state.migration.untouchedRoles.length > 0 && (
              <p>기존 잡이 없어 기본값으로 두는 역할: {state.migration.untouchedRoles.join(", ")}</p>
            )}
            {state.migration.unresolved.length > 0 && (
              <div className="agent-migration-unresolved">
                <strong>옮기지 못한 값</strong>
                <ul>
                  {state.migration.unresolved.map((entry, index) => (
                    <li key={`${entry.role}:${entry.field}:${index}`}>
                      {entry.role} · {entry.field} · {entry.value} · {entry.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="agent-migration-note">Dream은 이 이전 대상이 아닙니다.</p>
            <div className="agent-plan-actions">
              <button
                className="secondary-button"
                disabled={state.migrationBusy}
                onClick={() => actions.dismissMigration()}
                type="button"
              >
                취소
              </button>
              <button
                className="stamp-button"
                disabled={state.migrationBusy}
                onClick={() => void actions.applyMigration()}
                type="button"
              >
                이 내용으로 이전
              </button>
            </div>
          </div>
        )}
      </section>

      {state.policy ? (
        <AgentRoleSettings
          busy={state.reading}
          executionAllowed={state.policy.executionAllowed}
          onSave={actions.save}
          saveError={state.saveError}
          saving={state.saving}
          snapshot={state.policy}
        />
      ) : (
        <p className="agent-empty">이 프로젝트의 역할 정책을 아직 읽지 못했습니다.</p>
      )}
    </section>
  );
}

function ProviderRow({ diagnosis }: { diagnosis: AgentProviderDiagnosis }) {
  const known = providerDiagnoses[diagnosis.status];
  return (
    <>
      <strong>{diagnosis.provider}</strong>
      <span className={`agent-provider-status status-${diagnosis.status}`}>
        {known ? known.title : diagnosis.status}
      </span>
      <p>{known ? known.action : "앱이 모르는 상태입니다. 값을 그대로 보여드립니다."}</p>
      {diagnosis.version && <small>버전 {diagnosis.version}</small>}
    </>
  );
}
