import { useState } from "react";
import { ModelField, isSupportedModel } from "../ModelField";
import type {
  DuplicateIntegrationJob,
  HeartbeatIntegration,
  IntegrationReadFailure,
  IntegrationsSnapshot,
  JobDefaults,
  ManagedRoleJob,
  RoleJobRequest,
} from "../../domain/types";
import {
  IntegrationCard,
  IntegrationWarning,
  type IntegrationBadge,
  type IntegrationCardProps,
} from "./IntegrationCard";
import { JobChanges, type RemovedJob, type WrittenJob } from "./JobChanges";

const name = "claude-heartbeat";
const description = "역할 세션을 주기적으로 깨우는 외부 스케줄러입니다.";

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

const fieldLabels: Record<EditableField, string> = {
  interval: "주기",
  maxPer: "실행 한도",
  model: "모델",
};

/** 관리 블록에 그 줄이 없을 때의 표기. 차이 표시가 없는 값에 쓰는 낱말과 같아야 한다. */
const missingValue = "없음";

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

/** 배지 문구는 연동 공통 설치 상태와 하트비트 부가 상태(데몬 실행 여부)의 조합이다. */
function badgeOf(heartbeat: HeartbeatIntegration): IntegrationBadge {
  if (heartbeat.installation === "not_installed") {
    return { label: "미설치", tone: "not_installed" };
  }
  return heartbeat.daemonRunning
    ? { label: "설치됨 · 데몬 실행 중", tone: "installed_daemon_running" }
    : { label: "설치됨 · 데몬 미실행", tone: "installed_daemon_stopped" };
}

/** 판정 근거를 그대로 밝힌다. 앱은 pid 파일의 존재만 보고 프로세스 생존은 확인하지 않는다. */
function installationNote(heartbeat: HeartbeatIntegration): string {
  if (heartbeat.installation === "not_installed") {
    return "~/.claude/HEARTBEAT.md와 ~/.claude/heartbeat/를 찾지 못했습니다.";
  }
  return heartbeat.daemonRunning
    ? "~/.claude/heartbeat/heartbeat.pid가 있습니다. 데몬이 정리 없이 종료되면 이 파일이 남을 수 있습니다."
    : "~/.claude/heartbeat/heartbeat.pid가 없어 데몬이 멈춘 것으로 봅니다.";
}

function duplicateLine(job: DuplicateIntegrationJob): string {
  return job.role ? `${job.name} · ${roleLabels[job.role] ?? job.role}` : job.name;
}

/**
 * 역할별 앱 기본값. 스냅샷의 역할 목록에서 그대로 가져온다(R5).
 *
 * 화면에 같은 값을 상수로 두지 않는다. 두 정의가 갈라지면 재설정이 보여주는 값과 파일에 쓰이는
 * 값이 달라진다.
 */
function defaultsFrom(heartbeat: HeartbeatIntegration): Record<string, JobDefaults> {
  return Object.fromEntries(heartbeat.roles.map((status) => [status.role, status.defaults]));
}

function roleFormFrom(
  managedJobs: ManagedRoleJob[],
  roleDefaults: Record<string, JobDefaults>,
): Record<string, RoleForm> {
  // 관리 블록이 비어 있으면 아직 설치한 적이 없는 것이다. R3대로 3종을 켠 상태에서 시작한다.
  // 하나라도 설치된 뒤부터는 "블록에 없음"이 곧 "꺼짐"이다.
  const firstInstall = managedJobs.length === 0;
  return Object.fromEntries(
    roleOrder.map((role) => {
      const installed = managedJobs.find((job) => job.role === role);
      const defaults = roleDefaults[role];
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

/**
 * 파일에 적힌 값이 목록 밖이면 그 필드는 직접 입력 상태로 연다. 값은 그대로 두고, 앱이 목록 안의
 * 값으로 바꾸지 않는다. 이 판정은 파일을 읽어 화면을 여는 시점에만 쓴다. 그 뒤의 직접 입력 여부는
 * 사용자가 고른 상태를 따르며 값에서 다시 유도하지 않는다.
 */
function customModelFrom(form: Record<string, RoleForm>): Record<string, boolean> {
  return Object.fromEntries(roleOrder.map((role) => [role, !isSupportedModel(form[role].model)]));
}

export function HeartbeatCard({
  snapshot,
  error,
  writeError,
  actions,
  expanded,
  onToggleExpanded,
}: IntegrationCardProps) {
  const heartbeat = snapshot?.heartbeat ?? null;

  return (
    <IntegrationCard
      badge={heartbeat && badgeOf(heartbeat)}
      description={description}
      duplicateJobs={heartbeat?.duplicateJobs ?? []}
      duplicateWarning={{
        title: "관리 블록 밖에 같은 프로젝트의 역할 잡이 있습니다",
        description:
          "같은 역할 잡이 둘이면 두 세션이 동시에 깨어나고, 그중 하나는 lease 경합으로 NO_ELIGIBLE_WORK만 남기고 끝납니다. 실행 쿼터만 두 배로 소모됩니다. 앱은 사용자 잡을 지우지 않으므로 직접 정리해야 합니다.",
        describe: duplicateLine,
      }}
      error={error}
      expanded={expanded}
      name={name}
      onToggleExpanded={onToggleExpanded}
      readFailures={heartbeat?.readFailures ?? []}
      writeError={writeError}
    >
      {snapshot && heartbeat && (
        <>
          <p className="integration-note">{installationNote(heartbeat)}</p>

          {heartbeat.installation === "not_installed" ? (
            <div className="integration-guide">
              <p className="integration-note">앱이 하트비트를 대신 설치하지 않습니다. 아래 명령으로 직접 설치한 뒤 다시 확인하세요.</p>
              <pre><code>{"pip install claude-heartbeat\nheartbeat init"}</code></pre>
              <p className="integration-note">공식 문서: https://github.com/wooson00308/claude-heartbeat</p>
            </div>
          ) : (
            <>
              {snapshot.managedBlockFailure ? (
                <UnreadableManagedBlock failure={snapshot.managedBlockFailure} />
              ) : (
                <HeartbeatRoleJobs
                  key={snapshot.slug}
                  onInstall={actions.installHeartbeatJobs}
                  snapshot={snapshot}
                  writeError={writeError}
                />
              )}
              <dl className="settings-details">
                <div><dt>프로젝트 slug</dt><dd title={snapshot.slug}>{snapshot.slug}</dd></div>
                <div><dt>조건 스크립트</dt><dd title={heartbeat.conditionScriptPath}>{heartbeat.conditionScriptPath}</dd></div>
              </dl>
            </>
          )}
        </>
      )}
    </IntegrationCard>
  );
}

/**
 * 관리 블록을 읽지 못한 상태(R2). 잡이 없는 상태와 다르므로 잡 입력 폼을 그리지 않는다.
 *
 * 폼에 기본값이 차 있으면 사용자는 그것을 파일의 값으로 읽는다. 앱은 자신이 모르는 값을 덮어쓰지
 * 않아야 하므로 저장도 막고, 플랫폼 미지원과 같은 형태로 비활성 버튼과 사유를 함께 보여준다.
 */
function UnreadableManagedBlock({ failure }: { failure: IntegrationReadFailure }) {
  return (
    <div className="heartbeat-jobs">
      <p className="integration-note">
        관리 블록을 읽지 못했습니다 — 앱이 이 프로젝트의 역할 잡 값을 모르는 상태입니다. 잡이 없는 것과는 다른 상태라 입력 폼을 기본값으로 채워 보여주지 않습니다.
      </p>
      <p className="integration-note">{failure.path} — {failure.message}</p>
      <button className="secondary-button" disabled type="button">
        역할 잡 저장
      </button>
      <p className="integration-note">
        앱이 모르는 값을 덮어쓰지 않도록 저장을 막았습니다. 위 파일을 읽을 수 있게 고친 뒤 다시 확인하세요.
      </p>
    </div>
  );
}

function HeartbeatRoleJobs({
  snapshot,
  writeError,
  onInstall,
}: {
  snapshot: IntegrationsSnapshot;
  writeError: string | null;
  onInstall(roles: RoleJobRequest[], baseline: ManagedRoleJob[]): Promise<boolean>;
}) {
  const { slug, supported, heartbeat } = snapshot;
  const roleDefaults = defaultsFrom(heartbeat);
  // 폼을 시딩한 시점의 관리 블록. 저장 요청에 기준값으로 실려 나가고, 파일이 그 뒤 바뀌었는지
  // 판정하는 근거이기도 하다(R3).
  const [baseline, setBaseline] = useState(heartbeat.managedJobs);
  const [form, setForm] = useState(() => roleFormFrom(heartbeat.managedJobs, roleDefaults));
  // 화면 상태다. 설치 요청 payload는 form만으로 만든다.
  const [customModel, setCustomModel] = useState(() => customModelFrom(form));
  // 이번 편집에서 사용자가 실제로 지정한 필드. 여기 없는 필드는 요청에 null로 실리고, 백엔드가
  // 파일의 값을 그대로 쓴다. 폼 값이 파일 값과 같아 보여도 "지정함"과는 다른 상태다.
  const [specified, setSpecified] = useState<Record<string, Partial<Record<EditableField, true>>>>({});
  const [errors, setErrors] = useState<Record<string, Partial<Record<EditableField, string>>>>({});
  const [confirming, setConfirming] = useState(false);
  // 재설정 확인 화면이 열린 역할. 잡 단위 액션이므로 한 번에 하나만 연다(R5).
  const [resetting, setResetting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const signature = JSON.stringify(heartbeat.managedJobs);
  const changed = JSON.stringify(baseline) !== signature;
  // 한 필드라도 지정했으면 편집 중이다. 2.5초 조회는 같은 값을 주므로 이 판정이 주기마다 흔들리지
  // 않는다.
  const editing = Object.values(specified).some((fields) =>
    Object.values(fields).some(Boolean),
  );
  // 저장 중에는 그 요청의 결과가 아직 반영되는 중이라 불일치로 보지 않는다. 성공한 쓰기의 응답이
  // 스냅샷을 갱신하는 순간과 지정 기록을 비우는 순간 사이에 선택 화면이 잠깐 뜨면 안 된다.
  const pendingChange = changed && editing && !saving;

  /** 폼을 파일 값으로 되돌리고 그 값을 새 기준값으로 삼는다. */
  function seed(managedJobs: ManagedRoleJob[]) {
    const seededForm = roleFormFrom(managedJobs, roleDefaults);
    setBaseline(managedJobs);
    setForm(seededForm);
    setCustomModel(customModelFrom(seededForm));
    // 폼이 파일 값으로 돌아갔으므로 지정 기록도 함께 비운다. 남겨 두면 다음 저장이 파일에서 온
    // 값을 사용자가 고른 값처럼 다시 명시한다.
    setSpecified({});
    setErrors({});
    setConfirming(false);
    setResetting(null);
  }

  /**
   * 편집을 유지하고 파일의 현재 값을 새 기준값으로 삼는다. 그래야 다음 저장이 백엔드의 대조를
   * 통과한다. 사용자가 무엇을 덮어쓰는지 아래 차이 표시에서 이미 봤다는 것이 근거다.
   */
  function keepEdits() {
    setBaseline(heartbeat.managedJobs);
    setConfirming(false);
  }

  // 파일이 실제로 바뀌었고 사용자가 아무 필드도 지정하지 않았을 때만 조용히 되돌린다. 편집 중이면
  // 입력을 지키고 무엇이 달라졌는지 보여준 뒤 사용자가 정하게 한다(R3).
  if (changed && !editing) {
    seed(heartbeat.managedJobs);
  }

  const installed = heartbeat.managedJobs.length > 0;
  const enabledRoles = roleOrder.filter((role) => form[role].enabled);

  const jobNameOf = (role: string) => `wf-${role}${slug}`;

  /** 화면이 읽은 값과 파일의 현재 값의 차이. 확인 화면과 같은 요소로 그린다(R3). */
  const fileChanges: WrittenJob[] = heartbeat.managedJobs.map((job) => {
    const before = baseline.find((entry) => entry.role === job.role) ?? null;
    return {
      name: jobNameOf(job.role),
      added: before === null,
      fields: editableFields.map((field) => ({
        label: fieldLabels[field],
        current: before?.[field] ?? null,
        next: job[field] ?? missingValue,
      })),
      // 이 화면은 저장이 아니라 파일 변화를 보여준다. 되돌아갈 앱 소유 필드는 확인 화면 몫이다.
      appOwnedDrift: [],
    };
  });

  const fileRemovals: RemovedJob[] = baseline
    .filter((job) => !heartbeat.managedJobs.some((entry) => entry.role === job.role))
    .map((job) => ({
      name: jobNameOf(job.role),
      fields: editableFields.map((field) => ({
        label: fieldLabels[field],
        current: job[field],
      })),
    }));

  /** 확인 화면이 그릴 잡. 파일의 현재 값은 스냅샷에서, 쓰게 될 값은 폼에서 온다. */
  const writtenJobs: WrittenJob[] = enabledRoles.map((role) => {
    const job = heartbeat.managedJobs.find((entry) => entry.role === role) ?? null;
    return {
      name: jobNameOf(role),
      added: job === null,
      fields: editableFields.map((field) => ({
        label: fieldLabels[field],
        current: job?.[field] ?? null,
        next: form[role][field],
      })),
      appOwnedDrift: job?.appOwnedDrift ?? [],
    };
  });

  const removedJobs: RemovedJob[] = heartbeat.managedJobs
    .filter((job) => !form[job.role]?.enabled)
    .map((job) => ({
      name: jobNameOf(job.role),
      fields: editableFields.map((field) => ({
        label: fieldLabels[field],
        current: job[field],
      })),
    }));

  function edit(role: string, field: EditableField, value: string) {
    setForm((previous) => ({ ...previous, [role]: { ...previous[role], [field]: value } }));
    setSpecified((previous) => ({ ...previous, [role]: { ...previous[role], [field]: true } }));
    setErrors((previous) => ({ ...previous, [role]: { ...previous[role], [field]: undefined } }));
    setConfirming(false);
  }

  /** 입력 방식 전환은 값 변경이 아니라 지정으로 치지 않는다. 직접 입력 칸에 적으면 edit이 받는다. */
  function switchModelInput(role: string, custom: boolean) {
    setCustomModel((previous) => ({ ...previous, [role]: custom }));
    setErrors((previous) => ({ ...previous, [role]: { ...previous[role], model: undefined } }));
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
    setResetting(null);
  }

  /** 확인 화면은 한 번에 하나만 연다. 저장과 재설정은 쓰는 값이 다르다. */
  function requestReset(role: string) {
    setConfirming(false);
    setResetting(role);
  }

  /** 재설정 확인 화면이 그릴 잡. 왼쪽이 파일의 현재 값, 오른쪽이 앱 기본값이다(R5). */
  function resetChanges(role: string): WrittenJob[] {
    const job = heartbeat.managedJobs.find((entry) => entry.role === role);
    if (!job) return [];
    const defaults = roleDefaults[role];
    return [
      {
        name: jobNameOf(role),
        // 블록에 있는 잡에만 재설정을 보여주므로 새로 추가되는 경우가 없다.
        added: false,
        fields: editableFields.map((field) => ({
          label: fieldLabels[field],
          current: job[field] ?? null,
          next: defaults[field],
        })),
        appOwnedDrift: job.appOwnedDrift,
      },
    ];
  }

  /**
   * 재설정 요청. 대상 잡의 세 필드만 기본값을 명시하고 나머지 잡은 전부 미지정으로 둔다. 그래야
   * 같은 블록의 다른 잡 편집값이 그대로 남는다(R5).
   *
   * `enabled`는 폼의 토글이 아니라 파일 기준이다. 재설정은 편집 가능 값만 되돌리고 잡의 존재
   * 여부를 바꾸지 않는다.
   */
  function resetRequestOf(target: string): RoleJobRequest[] {
    return roleOrder.map((role) => {
      const reset = role === target;
      const defaults = roleDefaults[role];
      return {
        role,
        enabled: heartbeat.managedJobs.some((job) => job.role === role),
        interval: reset ? defaults.interval : null,
        maxPer: reset ? defaults.maxPer : null,
        model: reset ? defaults.model : null,
      };
    });
  }

  async function writeReset(role: string) {
    setSaving(true);
    try {
      const accepted = await onInstall(resetRequestOf(role), baseline);
      // 성공하면 갱신된 스냅샷이 폼을 다시 시딩한다. 편집 중이던 값이 있으면 그 경로 대신 파일
      // 변화 안내가 뜨고, 사용자가 무엇을 할지 고른다(R3).
      if (accepted) setResetting(null);
    } finally {
      setSaving(false);
    }
  }

  /** 지정하지 않은 필드는 null로 보낸다. 폼에 파일 값이 차 있어도 그것을 명시로 보내지 않는다. */
  function requestOf(role: string): RoleJobRequest {
    const pick = (field: EditableField) => (specified[role]?.[field] ? form[role][field] : null);
    return {
      role,
      enabled: form[role].enabled,
      interval: pick("interval"),
      maxPer: pick("maxPer"),
      model: pick("model"),
    };
  }

  async function write() {
    setSaving(true);
    try {
      const accepted = await onInstall(roleOrder.map(requestOf), baseline);
      if (accepted) {
        setSpecified({});
        setConfirming(false);
      }
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
          const job = heartbeat.managedJobs.find((entry) => entry.role === role);
          const run = heartbeat.roles.find((entry) => entry.role === role)?.lastRun ?? null;
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
                <span className="heartbeat-job-settings">wf-{role}{slug}</span>
              </div>

              <div className="heartbeat-job-fields">
                {editableFields.map((field) => {
                  const id = `heartbeat-${role}-${field}`;
                  const message = errors[role]?.[field];
                  if (field === "model") {
                    return (
                      <ModelField
                        custom={customModel[role]}
                        fieldLabel={fieldLabels.model}
                        id={id}
                        jobLabel={label}
                        key={field}
                        message={message}
                        onCustomChange={(custom) => switchModelInput(role, custom)}
                        onValueChange={(value) => edit(role, "model", value)}
                        value={form[role].model}
                      />
                    );
                  }
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

              {/* 관리 블록에 없는 잡에는 보여주지 않는다. 되돌릴 파일 값이 없고, 그 잡의 폼은
                  이미 기본값에서 시작한다(R5). */}
              {job && (
                <>
                  <button
                    className="secondary-button heartbeat-job-reset"
                    disabled={!supported}
                    onClick={() => requestReset(role)}
                    type="button"
                  >
                    {label} 기본값으로 재설정
                  </button>

                  {resetting === role && (
                    <div
                      aria-label={`${label} 기본값 재설정 확인`}
                      className="heartbeat-confirm"
                      role="group"
                    >
                      <strong>확인 후 아래 두 파일을 씁니다</strong>
                      <ul>
                        <li>{heartbeatFilePath} — 전역 파일입니다. 이 컴퓨터의 모든 프로젝트가 함께 씁니다.</li>
                        <li>{heartbeat.conditionScriptPath} — 프로젝트 로컬 파일입니다. 조건 스크립트를 앱 버전으로 맞춥니다.</li>
                      </ul>
                      <p>이 잡의 편집 가능 값만 앱 기본값으로 되돌립니다. 잡의 활성·비활성 상태와 같은 블록의 다른 잡은 그대로 둡니다.</p>
                      <JobChanges removed={[]} written={resetChanges(role)} />
                      <div className="heartbeat-confirm-actions">
                        <button
                          className="primary-button"
                          disabled={saving}
                          onClick={() => writeReset(role)}
                          type="button"
                        >
                          확인하고 되돌리기
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() => setResetting(null)}
                          type="button"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {pendingChange && (
        <div aria-label="역할 잡 파일 변경" className="integration-warning" role="group">
          <strong>화면이 읽은 뒤 관리 블록이 바뀌었습니다</strong>
          <p>
            편집 중인 값을 지키려고 화면을 파일 값으로 되돌리지 않았습니다. 아래에서 왼쪽이 화면이 읽은 값, 오른쪽이 파일의 현재 값입니다.
          </p>
          <JobChanges removed={fileRemovals} written={fileChanges} />
          <div className="heartbeat-confirm-actions">
            <button
              className="secondary-button"
              onClick={() => seed(heartbeat.managedJobs)}
              type="button"
            >
              파일 값 불러오기
            </button>
            <button className="secondary-button" onClick={keepEdits} type="button">
              편집 유지
            </button>
          </div>
        </div>
      )}

      {writeError && (
        <IntegrationWarning title="역할 잡을 쓰지 못했습니다">
          <p>{writeError}</p>
        </IntegrationWarning>
      )}

      {supported ? (
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
            <li>{heartbeat.conditionScriptPath} — 프로젝트 로컬 파일입니다. 조건 스크립트를 앱 버전으로 맞춥니다.</li>
          </ul>
          <p>앱 관리 블록만 다시 씁니다. 블록 밖의 잡과 전역 설정은 읽기만 하고 그대로 둡니다.</p>
          {enabledRoles.length === 0 && (
            <p>활성 역할이 없어 관리 블록 전체를 제거합니다. 조건 스크립트는 지우지 않습니다.</p>
          )}
          <JobChanges removed={removedJobs} written={writtenJobs} />
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
