import { useState } from "react";
import { Icon } from "../../../shared/ui/Icon";
import { UpdateControl } from "../../updater/components/UpdateControl";
import type { AppUpdaterState } from "../../updater/domain/types";
import type {
  HeartbeatInstallation,
  HeartbeatIntegration,
  HeartbeatState,
  ManagedRoleJob,
  ProjectSummary,
  RoleJobRequest,
  SchemaCompatibility,
} from "../domain/types";

interface Props {
  project: ProjectSummary;
  updater: AppUpdaterState;
  heartbeat: HeartbeatState;
  onInstallHeartbeatJobs(roles: RoleJobRequest[]): Promise<boolean>;
  onSwitchProject(): void;
}

const compatibilityLabels: Record<SchemaCompatibility, string> = {
  current: "현재 문서 규격",
  future_schema: "더 새로운 문서 규격",
  migration_required: "마이그레이션 필요",
  not_initialized: "초기화되지 않음",
};

const installationLabels: Record<HeartbeatInstallation, string> = {
  not_installed: "미설치",
  installed_daemon_stopped: "설치됨 · 데몬 미실행",
  installed_daemon_running: "설치됨 · 데몬 실행 중",
};

// 판정 근거를 그대로 밝힌다. 앱은 pid 파일의 존재만 보고 프로세스 생존은 확인하지 않는다.
const installationNotes: Record<HeartbeatInstallation, string> = {
  not_installed: "~/.claude/HEARTBEAT.md와 ~/.claude/heartbeat/를 찾지 못했습니다.",
  installed_daemon_stopped: "~/.claude/heartbeat/heartbeat.pid가 없어 데몬이 멈춘 것으로 봅니다.",
  installed_daemon_running: "~/.claude/heartbeat/heartbeat.pid가 있습니다. 데몬이 정리 없이 종료되면 이 파일이 남을 수 있습니다.",
};

const roleLabels: Record<string, string> = {
  planner: "기획자",
  architect: "프로젝트 아키텍트",
  developer: "개발자",
};

const runResultLabels: Record<string, string> = {
  success: "성공",
  failure: "실패",
  timeout: "시간 초과",
  skipped: "건너뜀 · 처리할 대상 없음",
  quota_skipped: "건너뜀 · 실행 한도 도달",
};

/** 앱이 쓰는 전역 파일. 백엔드가 홈에서 계산하는 경로와 같은 값을 사용자에게 보여준다. */
const heartbeatFilePath = "~/.claude/HEARTBEAT.md";

const roleOrder = ["planner", "architect", "developer"] as const;

const editableFields = ["interval", "maxPer", "model"] as const;

type EditableField = (typeof editableFields)[number];

type RoleForm = Record<EditableField, string> & { enabled: boolean };

/** 백엔드 기본값(R3)과 같다. 아직 설치되지 않은 역할의 입력 초기값이다. */
const roleJobDefaults: Record<string, Record<EditableField, string>> = {
  planner: { interval: "30m", maxPer: "4/24h", model: "opus" },
  architect: { interval: "30m", maxPer: "4/24h", model: "opus" },
  developer: { interval: "20m", maxPer: "6/24h", model: "opus" },
};

const fieldLabels: Record<EditableField, string> = {
  interval: "주기",
  maxPer: "실행 한도",
  model: "모델",
};

/** 백엔드 검증(TASK-004)과 같은 규칙이다. 백엔드는 방어선으로 남겨 두고 여기서 먼저 막는다. */
const fieldRules: Record<EditableField, { pattern: RegExp; message: string }> = {
  interval: {
    pattern: /^\d+[smhd]$/,
    message: "숫자 뒤에 s, m, h, d 중 하나를 붙여 주세요. 예: 30m",
  },
  maxPer: {
    pattern: /^\d+\/\d+[smhd]$/,
    message: "<횟수>/<기간> 형태로 적어 주세요. 예: 4/24h",
  },
  model: {
    pattern: /^\S+$/,
    message: "공백 없는 한 줄 값이어야 합니다. 예: opus",
  },
};

function roleFormFrom(managedJobs: ManagedRoleJob[]): Record<string, RoleForm> {
  // 관리 블록이 비어 있으면 아직 설치한 적이 없는 것이다. R3대로 3종을 켠 상태에서 시작한다.
  // 하나라도 설치된 뒤부터는 "블록에 없음"이 곧 "꺼짐"이다.
  const firstInstall = managedJobs.length === 0;
  return Object.fromEntries(
    roleOrder.map((role) => {
      const installed = managedJobs.find((job) => job.role === role);
      const defaults = roleJobDefaults[role];
      return [
        role,
        {
          enabled: firstInstall || Boolean(installed),
          interval: installed?.interval ?? defaults.interval,
          maxPer: installed?.maxPer ?? defaults.maxPer,
          model: installed?.model ?? defaults.model,
        },
      ];
    }),
  );
}

export function SettingsView({
  project,
  updater,
  heartbeat,
  onInstallHeartbeatJobs,
  onSwitchProject,
}: Props) {
  return (
    <section className="settings-view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>설정</h1>
          <p>앱 업데이트와 현재 프로젝트의 연결 상태를 관리합니다.</p>
        </div>
      </div>

      <div className="settings-grid">
        <section className="settings-card update-settings-card">
          <header>
            <span><Icon name="refresh" /></span>
            <div><strong>앱 업데이트</strong><small>서명된 최신 버전을 확인하고 설치합니다.</small></div>
          </header>
          <UpdateControl updater={updater} />
        </section>

        <section className="settings-card">
          <header>
            <span><Icon name="folder" /></span>
            <div><strong>현재 프로젝트</strong><small>앱이 읽고 있는 로컬 작업 공간입니다.</small></div>
          </header>
          <dl className="settings-details">
            <div><dt>이름</dt><dd>{project.name}</dd></div>
            <div><dt>위치</dt><dd title={project.rootPath}>{project.rootPath}</dd></div>
            <div><dt>워크플로우</dt><dd>{project.workflows.length}개</dd></div>
            <div><dt>문서 호환성</dt><dd><span className={`compatibility-status status-${project.compatibility}`}>{compatibilityLabels[project.compatibility]}</span></dd></div>
          </dl>
          <button className="secondary-button settings-switch-button" onClick={onSwitchProject} type="button">다른 프로젝트 열기</button>
        </section>

        <section className="settings-card">
          <header>
            <span><Icon name="workflow" /></span>
            <div><strong>파일 감시</strong><small>외부 LLM과 앱의 변경 사항을 자동으로 동기화합니다.</small></div>
          </header>
          <div className="settings-state-row">
            <span className="settings-state-dot" />
            <span><strong>자동 새로고침 사용 중</strong><small>2.5초 간격으로 Markdown 변경을 확인합니다.</small></span>
          </div>
          <div className="settings-state-row muted">
            <Icon name="archive" />
            <span><strong>{project.activeLeases.length}개의 활성 작업 lease</strong><small>활성 lease가 있으면 문서 마이그레이션을 보호합니다.</small></span>
          </div>
        </section>

        <HeartbeatIntegrationCard
          heartbeat={heartbeat}
          onInstall={onInstallHeartbeatJobs}
        />
      </div>
    </section>
  );
}

function HeartbeatIntegrationCard({
  heartbeat,
  onInstall,
}: {
  heartbeat: HeartbeatState;
  onInstall(roles: RoleJobRequest[]): Promise<boolean>;
}) {
  const { integration, error, writeError } = heartbeat;
  const badge = error
    ? { label: "상태를 읽을 수 없음", tone: "unknown" }
    : integration
      ? { label: installationLabels[integration.status.installation], tone: integration.status.installation }
      : { label: "확인 중", tone: "unknown" };

  return (
    <section aria-label="연동" className="settings-card integration-card">
      <header>
        <span><Icon name="spark" /></span>
        <div><strong>연동</strong><small>앱에 내장된 연동만 표시합니다. 외부 연동을 추가로 등록하지 않습니다.</small></div>
      </header>

      <div className="integration-item">
        <div className="integration-item-head">
          <div><strong>claude-heartbeat</strong><small>역할 세션을 주기적으로 깨우는 외부 스케줄러입니다.</small></div>
          <span className={`integration-status status-${badge.tone}`}>{badge.label}</span>
        </div>

        {error && <p className="integration-note">연동 상태를 읽지 못했습니다: {error}</p>}
        {!error && !integration && <p className="integration-note">상태를 확인하고 있습니다.</p>}

        {integration && (
          <>
            <p className="integration-note">{installationNotes[integration.status.installation]}</p>

            {!integration.supported && (
              <div className="integration-warning">
                <strong>이 플랫폼에서는 연동을 지원하지 않습니다</strong>
                <p>조건 검사가 POSIX sh 스크립트라 Windows에서는 잡이 조용히 건너뛰어집니다.</p>
              </div>
            )}

            {integration.status.installation === "not_installed" ? (
              <div className="integration-guide">
                <p className="integration-note">앱이 하트비트를 대신 설치하지 않습니다. 아래 명령으로 직접 설치한 뒤 다시 확인하세요.</p>
                <pre><code>{"pip install claude-heartbeat\nheartbeat init"}</code></pre>
                <p className="integration-note">공식 문서: https://github.com/wooson00308/claude-heartbeat</p>
              </div>
            ) : (
              <>
                <HeartbeatRoleJobs
                  key={integration.slug}
                  integration={integration}
                  writeError={writeError}
                  onInstall={onInstall}
                />
                <dl className="settings-details">
                  <div><dt>프로젝트 slug</dt><dd title={integration.slug}>{integration.slug}</dd></div>
                  <div><dt>조건 스크립트</dt><dd title={integration.conditionScriptPath}>{integration.conditionScriptPath}</dd></div>
                </dl>
              </>
            )}

            {integration.status.duplicateJobs.length > 0 && (
              <div className="integration-warning">
                <strong>관리 블록 밖에 같은 프로젝트의 역할 잡이 있습니다</strong>
                <p>같은 역할 잡이 둘이면 두 세션이 동시에 깨어나고, 그중 하나는 lease 경합으로 NO_ELIGIBLE_WORK만 남기고 끝납니다. 실행 쿼터만 두 배로 소모됩니다. 앱은 사용자 잡을 지우지 않으므로 직접 정리해야 합니다.</p>
                <ul>
                  {integration.status.duplicateJobs.map((job) => (
                    <li key={job.name}>{job.name}{job.role ? ` · ${roleLabels[job.role] ?? job.role}` : ""}</li>
                  ))}
                </ul>
              </div>
            )}

            {integration.status.readFailures.length > 0 && (
              <div className="integration-warning">
                <strong>일부 파일을 읽지 못했습니다</strong>
                <ul>
                  {integration.status.readFailures.map((failure) => (
                    <li key={failure.path}>{failure.path} — {failure.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function HeartbeatRoleJobs({
  integration,
  writeError,
  onInstall,
}: {
  integration: HeartbeatIntegration;
  writeError: string | null;
  onInstall(roles: RoleJobRequest[]): Promise<boolean>;
}) {
  const signature = JSON.stringify(integration.managedJobs);
  const [seeded, setSeeded] = useState(signature);
  const [form, setForm] = useState(() => roleFormFrom(integration.managedJobs));
  const [errors, setErrors] = useState<Record<string, Partial<Record<EditableField, string>>>>({});
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  // 파일이 실제로 바뀐 경우에만 입력을 파일 값으로 되돌린다. 2.5초 조회는 같은 값을 주므로
  // 편집 중인 값이 주기적으로 사라지지 않는다.
  if (seeded !== signature) {
    setSeeded(signature);
    setForm(roleFormFrom(integration.managedJobs));
    setErrors({});
    setConfirming(false);
  }

  const installed = integration.managedJobs.length > 0;
  const enabledRoles = roleOrder.filter((role) => form[role].enabled);
  const removedRoles = integration.managedJobs
    .map((job) => job.role)
    .filter((role) => !form[role]?.enabled);

  function edit(role: string, field: EditableField, value: string) {
    setForm((previous) => ({ ...previous, [role]: { ...previous[role], [field]: value } }));
    setErrors((previous) => ({ ...previous, [role]: { ...previous[role], [field]: undefined } }));
    setConfirming(false);
  }

  function toggle(role: string, enabled: boolean) {
    setForm((previous) => ({ ...previous, [role]: { ...previous[role], enabled } }));
    setConfirming(false);
  }

  /** 꺼진 역할의 값은 파일에 쓰이지 않으므로 검사하지 않는다. */
  function invalidFields() {
    const found: Record<string, Partial<Record<EditableField, string>>> = {};
    for (const role of enabledRoles) {
      for (const field of editableFields) {
        if (!fieldRules[field].pattern.test(form[role][field])) {
          found[role] = { ...found[role], [field]: fieldRules[field].message };
        }
      }
    }
    return found;
  }

  function requestConfirm() {
    const found = invalidFields();
    setErrors(found);
    // 검증에 걸리면 확인 화면을 열지 않는다. 게이트웨이도 부르지 않는다.
    setConfirming(Object.keys(found).length === 0);
  }

  async function write() {
    setSaving(true);
    try {
      const accepted = await onInstall(
        roleOrder.map((role) => ({ role, ...form[role] })),
      );
      if (accepted) setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="heartbeat-jobs">
      {!installed && (
        <p className="integration-note">역할 잡 미설치 — 앱 관리 블록에 이 프로젝트의 역할 잡이 없습니다.</p>
      )}
      <p className="integration-note">
        기본 주기는 한 세션이 수 분에서 수십 분 걸린다는 전제에서 나온 값입니다. 그보다 짧게 잡으면 조건 검사만 반복되고 중복 기동 위험만 늘어납니다.
      </p>

      <ul className="heartbeat-job-list">
        {roleOrder.map((role) => {
          const job = integration.managedJobs.find((entry) => entry.role === role);
          const run = integration.status.roles.find((entry) => entry.role === role)?.lastRun ?? null;
          const label = roleLabels[role] ?? role;
          return (
            <li key={role}>
              <div className="heartbeat-job-head">
                <label className="heartbeat-job-toggle">
                  <input
                    checked={form[role].enabled}
                    onChange={(event) => toggle(role, event.target.checked)}
                    type="checkbox"
                  />
                  <strong>{label}</strong>
                </label>
                <span className="heartbeat-job-settings">wf-{role}{integration.slug}</span>
              </div>

              <div className="heartbeat-job-fields">
                {editableFields.map((field) => {
                  const id = `heartbeat-${role}-${field}`;
                  const message = errors[role]?.[field];
                  return (
                    <div className="heartbeat-job-field" key={field}>
                      <span className="heartbeat-field-label">{fieldLabels[field]}</span>
                      <input
                        aria-describedby={message ? `${id}-error` : undefined}
                        aria-invalid={message ? true : undefined}
                        aria-label={`${label} ${fieldLabels[field]}`}
                        id={id}
                        onChange={(event) => edit(role, field, event.target.value)}
                        value={form[role][field]}
                      />
                      {message && <p className="heartbeat-field-error" id={`${id}-error`}>{message}</p>}
                    </div>
                  );
                })}
              </div>

              {job && !form[role].enabled && (
                <p className="integration-note">끄면 이 잡이 관리 블록에서 사라집니다. 편집한 값도 함께 사라지고, 다시 켜면 기본값으로 시작합니다.</p>
              )}

              {job && (run ? (
                <div className="heartbeat-job-run">
                  <span className={`heartbeat-run-result result-${run.result ?? "unknown"}`}>{run.result ? runResultLabels[run.result] ?? run.result : "결과 기록 없음"}</span>
                  <span>{run.at ? `${run.at} (로컬 시각)` : "시각 기록 없음"}</span>
                  <span>{run.durationSeconds === null ? "소요 시간 기록 없음" : `${run.durationSeconds.toFixed(1)}초`}</span>
                </div>
              ) : (
                <p className="integration-note">실행 기록 없음</p>
              ))}
            </li>
          );
        })}
      </ul>

      {writeError && (
        <div className="integration-warning">
          <strong>역할 잡을 쓰지 못했습니다</strong>
          <p>{writeError}</p>
        </div>
      )}

      {integration.supported ? (
        <button className="secondary-button" onClick={requestConfirm} type="button">
          {installed ? "역할 잡 변경 사항 저장" : "이 프로젝트에 역할 잡 설치"}
        </button>
      ) : (
        <button className="secondary-button" disabled type="button">
          이 프로젝트에 역할 잡 설치
        </button>
      )}

      {confirming && (
        <div aria-label="역할 잡 설치 확인" className="heartbeat-confirm" role="group">
          <strong>확인 후 아래 두 파일을 씁니다</strong>
          <ul>
            <li>{heartbeatFilePath} — 전역 파일입니다. 이 컴퓨터의 모든 프로젝트가 함께 씁니다.</li>
            <li>{integration.conditionScriptPath} — 프로젝트 로컬 파일입니다. 조건 스크립트를 앱 버전으로 맞춥니다.</li>
          </ul>
          <p>앱 관리 블록만 다시 씁니다. 블록 밖의 잡과 전역 설정은 읽기만 하고 그대로 둡니다.</p>
          {enabledRoles.length > 0 ? (
            <ul>
              {enabledRoles.map((role) => (
                <li key={role}>
                  기록: wf-{role}{integration.slug} — {form[role].interval} · {form[role].maxPer} · {form[role].model}
                </li>
              ))}
            </ul>
          ) : (
            <p>활성 역할이 없어 관리 블록 전체를 제거합니다. 조건 스크립트는 지우지 않습니다.</p>
          )}
          {removedRoles.length > 0 && (
            <p>제거: {removedRoles.map((role) => `wf-${role}${integration.slug}`).join(", ")}</p>
          )}
          <div className="heartbeat-confirm-actions">
            <button className="primary-button" disabled={saving} onClick={write} type="button">
              확인하고 쓰기
            </button>
            <button className="secondary-button" onClick={() => setConfirming(false)} type="button">
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
