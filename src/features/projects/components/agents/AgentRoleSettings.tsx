import { useState } from "react";
import type { AgentPolicySnapshot, AgentProjectPolicy, AgentProviderDiagnosis, AgentRolePolicy } from "../../domain/types";

/** 화면이 보여주는 역할 차례. 계약의 세 역할이고 앱이 새 역할을 만들지 않는다. */
const ROLE_ORDER = ["planner", "architect", "developer"] as const;

const roleLabels: Record<string, string> = {
  planner: "기획자",
  architect: "아키텍트",
  developer: "개발자",
};

/** 첫 릴리스가 허용하는 provider. Dream은 이 목록에 없다. */
const providers = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex CLI" },
] as const;

const modelOptions: Record<string, Array<{ label: string; value: string }>> = {
  claude: [
    { value: "", label: "Claude 기본 모델 (권장)" },
    { value: "opus", label: "Opus · 복잡한 작업" },
    { value: "sonnet", label: "Sonnet · 균형" },
    { value: "haiku", label: "Haiku · 빠른 작업" },
    { value: "fable", label: "Fable" },
  ],
  codex: [
    { value: "", label: "Codex 기본 모델 (권장)" },
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol · 최고 성능" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra · 균형" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna · 빠르고 경제적" },
  ],
};

// 아는 모델에만 붙이는 안내 문구. 처음 보는 모델은 도구가 준 이름 그대로 나간다.
const modelHints: Record<string, string> = {
  opus: "복잡한 작업",
  sonnet: "균형",
  haiku: "빠른 작업",
  fable: "장기 자율 작업",
  "gpt-5.6-sol": "최고 성능",
  "gpt-5.6-terra": "균형",
  "gpt-5.6-luna": "빠르고 경제적",
};

// 모델 목록의 정본은 실행 도구가 진단 때 보고한 계정 기준 목록이다. 도구가 업데이트되면 이 목록이
// 저절로 따라가므로 앱이 이름을 외울 필요가 없다. 위 하드코딩 목록은 목록을 싣지 못한 응답
// (구버전 런타임, 목록 미지원 도구)의 대비일 뿐이다.
function modelChoices(provider: string, diagnoses: AgentProviderDiagnosis[]) {
  const catalog = diagnoses.find((entry) => entry.provider === provider)?.modelCatalog;
  if (catalog?.status === "available" && catalog.models?.length) {
    return {
      live: true,
      options: [
        { value: "", label: `${providerLabel(provider)} 기본 모델 (권장)` },
        ...catalog.models.map((model) => ({
          value: model.id,
          label: modelHints[model.id] ? `${model.label ?? model.id} · ${modelHints[model.id]}` : model.label ?? model.id,
        })),
      ],
    };
  }
  return { live: false, options: modelOptions[provider] ?? [{ value: "", label: "공급자 기본 모델" }] };
}

const runModes = [
  { value: "continuous", label: "반복" },
  { value: "once", label: "한 번" },
] as const;

function providerLabel(provider: string) {
  return providers.find((candidate) => candidate.value === provider)?.label ?? provider;
}

function memoryLabel(bytes: number | null) {
  if (bytes === null) return "메모리 정보 없음";
  return `${Math.round(bytes / 1024 / 1024 / 1024)}GB 메모리`;
}

interface Props {
  busy: boolean;
  /** 저장을 열어도 되는지. 호환되지 않는 런타임에서는 거짓이다. */
  executionAllowed: boolean;
  onSave(policy: AgentProjectPolicy): Promise<boolean>;
  saveError: string | null;
  saving: boolean;
  snapshot: AgentPolicySnapshot;
}

/**
 * 프로젝트 하나의 역할 정책을 편집한다.
 *
 * 폼의 초기값은 백엔드가 준 스냅샷이고, 저장은 읽을 때 받은 revision과 함께 나간다. 값의 기본치와
 * 허용 범위는 런타임 계약이 정한다. 기기 권장값은 사양에서 계산하지만 사용자의 선택을 막는 상한으로
 * 쓰지 않는다.
 */
export function AgentRoleSettings({
  busy,
  executionAllowed,
  onSave,
  saveError,
  saving,
  snapshot,
}: Props) {
  // 스냅샷이 바뀌면(저장 성공, 프로젝트 전환, 마이그레이션 적용) 폼을 그 값으로 다시 세운다.
  const [draft, setDraft] = useState<AgentProjectPolicy>(snapshot.policy);
  const [baseline, setBaseline] = useState(snapshot.revision);
  const [selectedRole, setSelectedRole] = useState<(typeof ROLE_ORDER)[number]>("planner");
  if (baseline !== snapshot.revision) {
    setBaseline(snapshot.revision);
    setDraft(snapshot.policy);
  }

  const locked = saving || busy || !executionAllowed;
  const hasChanges = !snapshot.stored || JSON.stringify(draft) !== JSON.stringify(snapshot.policy);
  const roleLimits = ROLE_ORDER.map((role) => ({
    label: roleLabels[role],
    value: draft.roles[role]?.maxParallel ?? 0,
  }));
  const roleLimitTotal = roleLimits.reduce((sum, role) => sum + role.value, 0);
  const otherProjects = snapshot.deviceCapacity.projects.filter(
    (project) => project.projectId !== draft.projectId,
  );
  const otherProjectLimitTotal = otherProjects.reduce(
    (sum, project) => sum + project.projectMaxParallel,
    0,
  );
  const allProjectLimitTotal = otherProjectLimitTotal + draft.projectMaxParallel;
  const aboveRecommendation = snapshot.deviceCapacity.observed
    && draft.deviceMaxParallel > snapshot.deviceCapacity.recommendedMaxParallel;

  function editRole(role: string, change: Partial<AgentRolePolicy>) {
    setDraft((current) => ({
      ...current,
      roles: { ...current.roles, [role]: { ...current.roles[role], ...change } },
    }));
  }

  function editPolicy(change: Partial<AgentProjectPolicy>) {
    setDraft((current) => ({ ...current, ...change }));
  }

  return (
    <section aria-label="역할 정책" className="agent-roles">
      <header className="agent-role-settings-heading">
        <h3>역할 정책</h3>
        <p>역할을 하나씩 선택해 실행 도구와 방식을 정합니다.</p>
      </header>

      <div aria-label="정책 역할 선택" className="agent-policy-role-tabs" role="tablist">
        {ROLE_ORDER.map((role) => {
          const value = draft.roles[role];
          return (
            <button
              aria-controls="agent-selected-role-policy"
              aria-selected={selectedRole === role}
              className={selectedRole === role ? "is-active" : undefined}
              key={role}
              onClick={() => setSelectedRole(role)}
              role="tab"
              type="button"
            >
              <strong>{roleLabels[role]}</strong>
              <small>
                {value ? providerLabel(value.provider) : "도구 미정"} · {value?.runMode === "once" ? "한 번" : "반복"} · 최대 {value?.maxParallel ?? "-"}명
              </small>
            </button>
          );
        })}
      </div>

      {(() => {
        const role = selectedRole;
        const value = draft.roles[role];
        if (!value) return null;
        const label = roleLabels[role] ?? role;
        const models = modelChoices(value.provider, snapshot.providers);
        const staleModel = Boolean(value.model) && !models.options.some((option) => option.value === value.model);
        return (
          <section
            aria-label={`${label} 역할 정책`}
            className="agent-role-card"
            data-role={role}
            id="agent-selected-role-policy"
            role="tabpanel"
          >
            <header>
              <div>
                <h4>{label}</h4>
                <p>{providerLabel(value.provider)} · {value.model ?? "공급자 기본 모델"}</p>
              </div>
              <span className="agent-role-enabled">
                {value.enabled ? "사용 중" : "사용 안 함"}
              </span>
            </header>
            <div className="agent-role-primary-fields">
              <label htmlFor={`agent-provider-${role}`}>
                <span>실행 도구</span>
                <select
                  aria-label={`${label} 실행 도구`}
                  disabled={locked}
                  id={`agent-provider-${role}`}
                  onChange={(event) => editRole(role, { provider: event.target.value, model: null })}
                  value={value.provider}
                >
                  {providers.map((provider) => (
                    <option key={provider.value} value={provider.value}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor={`agent-model-${role}`}>
                <span>모델</span>
                <select
                  aria-label={`${label} 모델`}
                  disabled={locked}
                  id={`agent-model-${role}`}
                  onChange={(event) => editRole(role, { model: event.target.value || null })}
                  value={value.model ?? ""}
                >
                  {staleModel && value.model && (
                    <option value={value.model}>현재 설정 · {value.model}{models.live ? " — 계정 목록에 없음" : ""}</option>
                  )}
                  {models.options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {staleModel && models.live && (
                  <small className="agent-model-stale-note">이 모델은 더 이상 계정 목록에 없어, 실행은 기본 모델로 진행됩니다.</small>
                )}
              </label>
              <label htmlFor={`agent-run-mode-${role}`}>
                <span>실행 방식</span>
                <select
                  aria-label={`${label} 실행 방식`}
                  disabled={locked}
                  id={`agent-run-mode-${role}`}
                  onChange={(event) => editRole(role, { runMode: event.target.value })}
                  value={value.runMode}
                >
                  {runModes.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor={`agent-max-parallel-${role}`}>
                <span>최대 인원</span>
                <input
                  aria-label={`${label} 최대 인원`}
                  disabled={locked}
                  id={`agent-max-parallel-${role}`}
                  min={1}
                  onChange={(event) =>
                    editRole(role, { maxParallel: Math.max(1, Number(event.target.value)) })
                  }
                  type="number"
                  value={value.maxParallel}
                />
              </label>
            </div>
            <details className="agent-role-advanced">
              <summary>고급 실행 설정</summary>
              <div>
                <label htmlFor={`agent-interval-${role}`}>
                  <span>판정 간격(초)</span>
                  <input
                    aria-label={`${label} 판정 간격`}
                    disabled={locked}
                    id={`agent-interval-${role}`}
                    min={1}
                    onChange={(event) => editRole(role, { intervalSeconds: Number(event.target.value) })}
                    type="number"
                    value={value.intervalSeconds}
                  />
                </label>
                <label htmlFor={`agent-max-per-${role}`}>
                  <span>실행 한도</span>
                  <input
                    aria-label={`${label} 실행 한도`}
                    disabled={locked}
                    id={`agent-max-per-${role}`}
                    min={0}
                    onChange={(event) =>
                      editRole(role, {
                        maxPer: event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                    placeholder="한도 없음"
                    type="number"
                    value={value.maxPer ?? ""}
                  />
                </label>
              </div>
              <small>역할은 현재 사용 중이며 이 버전에서는 역할 끄기를 지원하지 않습니다.</small>
            </details>
          </section>
        );
      })()}

      <section aria-label="동시 실행 용량" className="agent-capacity">
        <header>
          <div>
            <h4>동시 실행 용량</h4>
            <p>권장값을 시작점으로 쓰고, 이 기기와 프로젝트에 맞게 직접 조정할 수 있습니다.</p>
          </div>
          <span className="agent-capacity-recommendation">
            {snapshot.deviceCapacity.observed
              ? `이 기기 권장 ${snapshot.deviceCapacity.recommendedMaxParallel}명`
              : "기기 사양 확인 전"}
          </span>
        </header>
        <div className="agent-capacity-controls">
          <label htmlFor="agent-device-max">
            <span>이 기기 전체</span>
            <div className="agent-capacity-input">
              <input
                aria-label="기기 전체 동시 실행"
                disabled={locked}
                id="agent-device-max"
                min={1}
                onChange={(event) =>
                  editPolicy({ deviceMaxParallel: Math.max(1, Number(event.target.value)) })
                }
                type="number"
                value={draft.deviceMaxParallel}
              />
              <span>명</span>
            </div>
            <small>
              {snapshot.deviceCapacity.observed
                ? `논리 CPU ${snapshot.deviceCapacity.logicalCpuCount ?? "-"}개 · ${memoryLabel(snapshot.deviceCapacity.totalMemoryBytes)}`
                : "현재 저장값을 유지합니다. 새 런타임에서 사양 기반 권장값을 계산합니다."}
            </small>
          </label>
          <label htmlFor="agent-project-max">
            <span>이 프로젝트</span>
            <div className="agent-capacity-input">
              <input
                aria-label="프로젝트 동시 실행"
                disabled={locked}
                id="agent-project-max"
                min={1}
                onChange={(event) =>
                  editPolicy({ projectMaxParallel: Math.max(1, Number(event.target.value)) })
                }
                type="number"
                value={draft.projectMaxParallel}
              />
              <span>명</span>
            </div>
            <small>역할별 최대 합 {roleLimitTotal}명</small>
          </label>
        </div>

        {snapshot.deviceCapacity.observed ? (
          <div className="agent-capacity-allocation">
            <div>
              <span>프로젝트별 설정 합</span>
              <strong>{allProjectLimitTotal}명</strong>
            </div>
            <div>
              <span>현재 실행·대기</span>
              <strong>{snapshot.deviceCapacity.activeRuns}명</strong>
            </div>
            <div>
              <span>다른 프로젝트</span>
              <strong>{otherProjects.length}개 · 최대 합 {otherProjectLimitTotal}명</strong>
            </div>
          </div>
        ) : (
          <p className="agent-capacity-observation-note">
            현재 런타임은 다른 프로젝트의 배정과 사용량을 제공하지 않습니다. 값은 제한 없이 저장할 수 있고, 런타임 업데이트 후 비교 정보가 표시됩니다.
          </p>
        )}

        <ul aria-label="역할별 최대 인원" className="agent-capacity-roles">
          {roleLimits.map((role) => (
            <li key={role.label}><span>{role.label}</span><strong>{role.value}명</strong></li>
          ))}
        </ul>

        {aboveRecommendation && (
          <p className="agent-capacity-warning" role="status">
            권장값보다 {draft.deviceMaxParallel - snapshot.deviceCapacity.recommendedMaxParallel}명 높습니다. 저장은 막지 않지만 앱 반응 저하, 메모리 압박, CLI 사용량 증가는 사용자가 감수해야 합니다.
          </p>
        )}
        <p className="agent-capacity-note">
          프로젝트별 숫자는 예약 인원이 아니라 각각의 최대치입니다. 여러 프로젝트가 동시에 실행되면 기기 전체 빈자리를 나눠 사용합니다.
        </p>
      </section>

      {!executionAllowed && (
        <p className="agent-blocked-note" role="status">
          이 런타임에서는 설정을 저장할 수 없습니다. 위의 준비 상태를 먼저 해결해 주세요.
        </p>
      )}

      {saveError !== null && (
        <p className="agent-save-error" role="status">
          {saveError}
        </p>
      )}

      <footer className="agent-settings-actions">
        <p>
          {snapshot.stored
            ? "변경 내용은 이 프로젝트에만 적용됩니다."
            : "저장하면 이 프로젝트에서 에이전트 작업을 시작할 수 있습니다."}
        </p>
        <button
          className="stamp-button agent-role-save"
          disabled={locked || !hasChanges}
          onClick={() => void onSave(draft)}
          type="button"
        >
          {saving ? "저장하는 중" : snapshot.stored ? "변경 내용 저장" : "기본 설정 저장"}
        </button>
      </footer>
    </section>
  );
}
