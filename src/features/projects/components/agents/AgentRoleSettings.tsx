import { useState } from "react";
import { useArmedConfirm } from "../../../../shared/ui/useArmedConfirm";
import type { AgentPolicySnapshot, AgentProjectPolicy, AgentRolePolicy } from "../../domain/types";

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

const runModes = [
  { value: "continuous", label: "반복" },
  { value: "once", label: "한 번" },
] as const;

/** 기기 상한의 상한. 첫 릴리스는 낮추기만 제공한다. */
export const DEVICE_MAX_PARALLEL_CEILING = 16;

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
 * 허용 범위는 런타임 계약이 정하므로 이 화면이 다시 정하지 않는다 — 기기 상한의 천장 하나만 화면이
 * 막는다(첫 릴리스는 낮추기만 제공한다).
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
  const confirm = useArmedConfirm();
  if (baseline !== snapshot.revision) {
    setBaseline(snapshot.revision);
    setDraft(snapshot.policy);
    confirm.disarm();
  }

  const locked = saving || busy || !executionAllowed;

  function editRole(role: string, change: Partial<AgentRolePolicy>) {
    confirm.disarm();
    setDraft((current) => ({
      ...current,
      roles: { ...current.roles, [role]: { ...current.roles[role], ...change } },
    }));
  }

  function editPolicy(change: Partial<AgentProjectPolicy>) {
    confirm.disarm();
    setDraft((current) => ({ ...current, ...change }));
  }

  return (
    <section aria-label="역할 정책" className="agent-roles">
      <header>
        <h3>역할 정책</h3>
        <p>
          이 프로젝트에서 각 역할을 어떤 도구로 어떻게 돌릴지 정합니다. 저장은 아래 확인을 두 번 누를
          때만 실행됩니다.
        </p>
      </header>

      <div aria-label="역할별 실행 도구와 한도" className="agent-role-cards">
        {ROLE_ORDER.map((role) => {
          const value = draft.roles[role];
          if (!value) return null;
          const label = roleLabels[role] ?? role;
          return (
            <section className="agent-role-card" data-role={role} key={role}>
              <header>
                <h4>{label}</h4>
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
                    onChange={(event) => editRole(role, { provider: event.target.value })}
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
                  <input
                    aria-label={`${label} 모델`}
                    disabled={locked}
                    id={`agent-model-${role}`}
                    onChange={(event) =>
                      editRole(role, { model: event.target.value.trim() ? event.target.value : null })
                    }
                    placeholder="기본 모델"
                    value={value.model ?? ""}
                  />
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
                      editRole(role, { maxParallel: Number(event.target.value) })
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
                      onChange={(event) =>
                        editRole(role, { intervalSeconds: Number(event.target.value) })
                      }
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
        })}
      </div>

      <div className="agent-limits">
        <label htmlFor="agent-project-max">
          <span>프로젝트 최대 동시 실행</span>
          <input
            aria-label="프로젝트 상한"
            disabled={locked}
            id="agent-project-max"
            min={1}
            onChange={(event) => editPolicy({ projectMaxParallel: Number(event.target.value) })}
            type="number"
            value={draft.projectMaxParallel}
          />
        </label>
        <details className="agent-advanced">
          <summary>기기 전체 한도</summary>
          <div>
            <label htmlFor="agent-device-max">기기 최대 동시 실행</label>
            <input
              aria-label="기기 상한"
              disabled={locked}
              id="agent-device-max"
              max={DEVICE_MAX_PARALLEL_CEILING}
              min={1}
              onChange={(event) =>
                editPolicy({
                  deviceMaxParallel: Math.min(
                    DEVICE_MAX_PARALLEL_CEILING,
                    Number(event.target.value),
                  ),
                })
              }
              type="number"
              value={draft.deviceMaxParallel}
            />
            <small>1부터 {DEVICE_MAX_PARALLEL_CEILING}까지 낮출 수 있습니다.</small>
          </div>
        </details>
      </div>

      {!executionAllowed && (
        <p className="agent-blocked-note" role="status">
          이 런타임에서는 설정을 저장할 수 없습니다. 위의 준비 상태를 먼저 해결해 주세요.
        </p>
      )}

      {confirm.armed && (
        <div className="agent-save-summary" role="status">
          <strong>이 내용으로 저장합니다</strong>
          <ul>
            {ROLE_ORDER.map((role) => {
              const value = draft.roles[role];
              if (!value) return null;
              return (
                <li key={role}>
                  {roleLabels[role] ?? role}: {value.provider} · {value.model ?? "기본 모델"} ·{" "}
                  {value.runMode === "once" ? "한 번" : "반복"} · 최대 {value.maxParallel}명
                </li>
              );
            })}
            <li>프로젝트 상한 {draft.projectMaxParallel}명 · 기기 상한 {draft.deviceMaxParallel}명</li>
            <li>적용 프로젝트: {draft.workingDirectory}</li>
          </ul>
        </div>
      )}

      {saveError !== null && (
        <p className="agent-save-error" role="status">
          {saveError}
        </p>
      )}

      <button
        className={`stamp-button agent-role-save ${confirm.armed ? "armed" : ""}`}
        disabled={locked}
        onClick={() => confirm.fire(() => void onSave(draft))}
        type="button"
      >
        {saving ? "저장하는 중" : confirm.armed ? "한 번 더 누르면 저장" : "역할 정책 저장"}
      </button>
    </section>
  );
}
