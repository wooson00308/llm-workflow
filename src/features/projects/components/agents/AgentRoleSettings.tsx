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

      <table className="agent-role-table">
        <caption className="visually-hidden">역할별 실행 도구와 한도</caption>
        <thead>
          <tr>
            <th scope="col">역할</th>
            <th scope="col">실행 도구</th>
            <th scope="col">모델</th>
            <th scope="col">사용</th>
            <th scope="col">실행 방식</th>
            <th scope="col">최대 인원</th>
            <th scope="col">판정 간격(초)</th>
            <th scope="col">실행 한도</th>
          </tr>
        </thead>
        <tbody>
          {ROLE_ORDER.map((role) => {
            const value = draft.roles[role];
            if (!value) return null;
            const label = roleLabels[role] ?? role;
            return (
              <tr key={role}>
                <th scope="row">{label}</th>
                <td>
                  <label className="visually-hidden" htmlFor={`agent-provider-${role}`}>
                    {label} 실행 도구
                  </label>
                  <select
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
                </td>
                <td>
                  <label className="visually-hidden" htmlFor={`agent-model-${role}`}>
                    {label} 모델
                  </label>
                  <input
                    disabled={locked}
                    id={`agent-model-${role}`}
                    onChange={(event) =>
                      editRole(role, { model: event.target.value.trim() ? event.target.value : null })
                    }
                    placeholder="비우면 기본 모델"
                    value={value.model ?? ""}
                  />
                </td>
                <td>
                  {/*
                    런타임 설정 계약에 역할을 끄는 필드가 없다. 켠 채로 조용히 저장하면 사용자는 끈 줄
                    알고, 끈 채로 보내면 백엔드가 거절한다. 그래서 조작을 열지 않고 사실을 적는다.
                  */}
                  <span className="agent-role-enabled">
                    {value.enabled ? "사용함" : "사용 안 함"}
                  </span>
                  <small>런타임 계약에 끄기 필드가 없어 이 값은 바꿀 수 없습니다.</small>
                </td>
                <td>
                  <label className="visually-hidden" htmlFor={`agent-run-mode-${role}`}>
                    {label} 실행 방식
                  </label>
                  <select
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
                </td>
                <td>
                  <label className="visually-hidden" htmlFor={`agent-max-parallel-${role}`}>
                    {label} 최대 인원
                  </label>
                  <input
                    disabled={locked}
                    id={`agent-max-parallel-${role}`}
                    min={1}
                    onChange={(event) =>
                      editRole(role, { maxParallel: Number(event.target.value) })
                    }
                    type="number"
                    value={value.maxParallel}
                  />
                </td>
                <td>
                  <label className="visually-hidden" htmlFor={`agent-interval-${role}`}>
                    {label} 판정 간격
                  </label>
                  <input
                    disabled={locked}
                    id={`agent-interval-${role}`}
                    min={1}
                    onChange={(event) =>
                      editRole(role, { intervalSeconds: Number(event.target.value) })
                    }
                    type="number"
                    value={value.intervalSeconds}
                  />
                </td>
                <td>
                  <label className="visually-hidden" htmlFor={`agent-max-per-${role}`}>
                    {label} 실행 한도
                  </label>
                  <input
                    disabled={locked}
                    id={`agent-max-per-${role}`}
                    min={0}
                    onChange={(event) =>
                      editRole(role, {
                        maxPer: event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                    placeholder="비우면 한도 없음"
                    type="number"
                    value={value.maxPer ?? ""}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="agent-limits">
        <label htmlFor="agent-project-max">프로젝트 상한</label>
        <input
          disabled={locked}
          id="agent-project-max"
          min={1}
          onChange={(event) => editPolicy({ projectMaxParallel: Number(event.target.value) })}
          type="number"
          value={draft.projectMaxParallel}
        />
        <details className="agent-advanced">
          <summary>고급 설정</summary>
          <label htmlFor="agent-device-max">기기 상한</label>
          <input
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
          <small>1부터 {DEVICE_MAX_PARALLEL_CEILING}까지 낮출 수 있고 더 높이지는 못합니다.</small>
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
        className={`stamp-button ${confirm.armed ? "armed" : ""}`}
        disabled={locked}
        onClick={() => confirm.fire(() => void onSave(draft))}
        type="button"
      >
        {saving ? "저장하는 중" : confirm.armed ? "한 번 더 누르면 저장" : "역할 정책 저장"}
      </button>
    </section>
  );
}
