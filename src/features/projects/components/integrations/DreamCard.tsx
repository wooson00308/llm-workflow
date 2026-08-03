import { useState } from "react";
import { ModelField, isSupportedModel } from "../ModelField";
import type {
  DreamIntegration,
  DreamJobRequest,
  DreamRefinement,
  IntegrationReadFailure,
  IntegrationsSnapshot,
  JobDefaults,
  ManagedDreamJob,
} from "../../domain/types";
import {
  IntegrationCard,
  IntegrationWarning,
  type IntegrationBadge,
  type IntegrationCardProps,
} from "./IntegrationCard";
import { JobChanges, type RemovedJob, type WrittenJob } from "./JobChanges";

const name = "dream";
const description =
  "역할 세션이 남긴 트랜스크립트를 메모리로 정제해, 다음 세션이 과거 맥락을 아는 상태로 시작하게 합니다.";

/** dream 스킬이 들어 있는 저장소. 하트비트와 같은 저장소다. */
const repository = "https://github.com/wooson00308/claude-heartbeat";

const installCommand = "heartbeat install dream";

/** 앱이 쓰는 전역 파일. 백엔드가 홈에서 계산하는 경로와 같은 값을 사용자에게 보여준다. */
const heartbeatFilePath = "~/.claude/HEARTBEAT.md";

const runResultLabels: Record<string, string> = {
  success: "성공",
  failure: "실패",
  timeout: "시간 초과",
  skipped: "건너뜀 · 처리할 대상 없음",
  quota_skipped: "건너뜀 · 실행 한도 도달",
};

const editableFields = ["interval", "maxPer", "model"] as const;

type EditableField = (typeof editableFields)[number];

type DreamForm = Record<EditableField, string> & { enabled: boolean };

const fieldLabels: Record<EditableField, string> = {
  interval: "주기",
  maxPer: "실행 한도",
  model: "모델",
};

/** 관리 블록에 그 줄이 없을 때의 표기. 역할 잡 카드와 같은 낱말이다. */
const missingValue = "없음";

/** 백엔드 검증과 같은 규칙이다. 백엔드는 방어선으로 남겨 두고 여기서 먼저 막는다. */
const fieldRules: Record<EditableField, { pattern: RegExp; message: string }> = {
  interval: {
    pattern: /^\d+[smhd]$/,
    message: "숫자 뒤에 s, m, h, d 중 하나를 붙여 주세요. 예: 2h",
  },
  maxPer: {
    pattern: /^\d+\/\d+[smhd]$/,
    message: "<횟수>/<기간> 형태로 적어 주세요. 예: 6/24h",
  },
  model: {
    pattern: /^\S+$/,
    message: "공백 없는 한 줄 값이어야 합니다. 예: opus",
  },
};

/** 잡 이름 규칙은 백엔드와 같다. 역할 잡이 `wf-<역할><slug>`인 것과 같은 형태다. */
function jobNameOf(slug: string): string {
  return `wf-dream${slug}`;
}

/**
 * 앱 기본값은 스냅샷에서 온다(R5). 역할 잡 카드와 같은 규칙이고, 화면에 같은 값을 상수로 두지
 * 않는다. 두 정의가 갈라지면 재설정이 보여주는 값과 파일에 쓰이는 값이 달라진다.
 */
function formFrom(job: ManagedDreamJob | null, defaults: JobDefaults): DreamForm {
  return {
    // 블록에 없으면 아직 설치한 적이 없는 것으로 보고 켠 상태에서 시작한다. 역할 잡의 첫 설치
    // 규칙과 같다. 끄고 저장하면 잡이 블록에서 사라지고 화면은 다시 첫 설치 상태로 돌아온다.
    enabled: true,
    interval: job?.interval ?? defaults.interval,
    maxPer: job?.maxPer ?? defaults.maxPer,
    model: job?.model ?? defaults.model,
  };
}

/**
 * 배지 문구는 선행 조건(하트비트)과 dream 스킬 설치 여부의 조합이다.
 *
 * 두 값을 하나로 접지 않는다. "하트비트가 없어서 못 쓴다"와 "dream만 없다"는 사용자가 해야 할 일이
 * 서로 다르다.
 */
function badgeOf(dream: DreamIntegration): IntegrationBadge {
  if (dream.heartbeat === "not_installed") {
    return { label: "하트비트 필요", tone: "not_installed" };
  }
  if (dream.installation === "not_installed") {
    return { label: "미설치", tone: "not_installed" };
  }
  return { label: "설치됨", tone: "installed" };
}

/** 판정 근거를 그대로 밝힌다. 앱은 파일 존재만 보고 `heartbeat skills`를 실행하지 않는다. */
function installationNote(dream: DreamIntegration): string {
  if (dream.heartbeat === "not_installed") {
    return "하트비트를 찾지 못했습니다. dream은 하트비트 데몬이 주기마다 깨우는 스킬이라 하트비트가 먼저 있어야 합니다.";
  }
  if (dream.installation === "not_installed") {
    return `${dream.skillPath}를 찾지 못했습니다. --slug으로 다른 이름을 지정해 설치했다면 이 경로에 없어 미설치로 보입니다.`;
  }
  return `${dream.skillPath}를 확인했습니다.`;
}

export function DreamCard({
  snapshot,
  error,
  writeError,
  actions,
  expanded,
  onToggleExpanded,
}: IntegrationCardProps) {
  const dream = snapshot?.dream ?? null;

  return (
    <IntegrationCard
      badge={dream && badgeOf(dream)}
      description={description}
      duplicateJobs={dream?.duplicateJobs ?? []}
      duplicateWarning={{
        title: "관리 블록 밖에 같은 프로젝트의 dream 잡이 있습니다",
        description:
          "같은 프로젝트에 dream 잡이 둘이면 두 세션이 같은 트랜스크립트를 동시에 정제해 같은 메모리 파일을 서로 덮어쓸 수 있습니다. 실행 쿼터도 두 배로 소모됩니다. 앱은 사용자 잡을 지우지 않으므로 직접 정리해야 합니다.",
        describe: (job) => job.name,
      }}
      error={error}
      expanded={expanded}
      name={name}
      onToggleExpanded={onToggleExpanded}
      readFailures={dream?.readFailures ?? []}
      writeError={writeError}
    >
      {snapshot && dream && (
        <>
          <p className="integration-note">{installationNote(dream)}</p>

          {dream.installation === "installed" && dream.heartbeat === "installed" ? (
            <>
              <DreamRefinementStatus refinement={dream.refinement} />
              <div className="integration-guide">
                <p className="integration-note">
                  설치될 dream 잡의 조건 명령입니다. 앱은 하트비트 데몬의 PATH를 알 수 없어 dream-prep이 실행 가능한지 검증하지 못합니다. 조건 검사가 실패하면 하트비트가 잡을 건너뛰므로 증상이 "아무 일도 일어나지 않음"이 됩니다. 같은 명령을 터미널에서 실행해 확인하세요.
                </p>
                <pre><code>{dream.conditionCommand}</code></pre>
              </div>
              {snapshot.managedBlockFailure ? (
                <UnreadableManagedBlock failure={snapshot.managedBlockFailure} />
              ) : (
                <DreamJob
                  key={snapshot.slug}
                  onInstall={actions.installDreamJob}
                  snapshot={snapshot}
                  writeError={writeError}
                />
              )}
              <dl className="settings-details">
                <div><dt>프로젝트 slug</dt><dd title={snapshot.slug}>{snapshot.slug}</dd></div>
              </dl>
            </>
          ) : (
            <div className="integration-guide">
              <p className="integration-note">
                {dream.heartbeat === "not_installed"
                  ? "위 claude-heartbeat 카드의 안내대로 하트비트를 먼저 설치한 뒤 다시 확인하세요."
                  : "앱이 dream을 대신 설치하지 않습니다. 아래 명령으로 직접 설치한 뒤 다시 확인하세요."}
              </p>
              <pre><code>{installCommand}</code></pre>
              <p className="integration-note">공식 저장소: {repository}</p>
            </div>
          )}
        </>
      )}
    </IntegrationCard>
  );
}

/**
 * 관리 블록을 읽지 못한 상태(R2). 역할 잡 카드와 같은 규칙으로 막는다. 두 연동이 `HEARTBEAT.md`
 * 한 파일을 공유하므로 한쪽만 막으면 다른 쪽이 같은 사고를 그대로 낸다.
 *
 * 폼에 기본값이 차 있으면 사용자는 그것을 파일의 값으로 읽는다. 앱은 자신이 모르는 값을 덮어쓰지
 * 않아야 하므로 저장도 막고, 플랫폼 미지원과 같은 형태로 비활성 버튼과 사유를 함께 보여준다.
 */
function UnreadableManagedBlock({ failure }: { failure: IntegrationReadFailure }) {
  return (
    <div className="heartbeat-jobs">
      <p className="integration-note">
        관리 블록을 읽지 못했습니다 — 앱이 이 프로젝트의 dream 잡 값을 모르는 상태입니다. 잡이 없는 것과는 다른 상태라 입력 폼을 기본값으로 채워 보여주지 않습니다.
      </p>
      <p className="integration-note">{failure.path} — {failure.message}</p>
      <button className="secondary-button" disabled type="button">
        dream 잡 저장
      </button>
      <p className="integration-note">
        앱이 모르는 값을 덮어쓰지 않도록 저장을 막았습니다. 위 파일을 읽을 수 있게 고친 뒤 다시 확인하세요.
      </p>
    </div>
  );
}

/**
 * dream 잡 설치·토글·편집.
 *
 * 요청에는 이 연동의 값만 담는다. 관리 블록은 역할 잡과 공유하지만, 블록 전체를 만드는 일은
 * 서비스가 한다. 이 화면은 역할 잡의 값을 알지도 보내지도 않는다.
 */
function DreamJob({
  snapshot,
  writeError,
  onInstall,
}: {
  snapshot: IntegrationsSnapshot;
  writeError: string | null;
  onInstall(dream: DreamJobRequest, baseline: ManagedDreamJob | null): Promise<boolean>;
}) {
  const { slug, supported, dream } = snapshot;
  // 폼을 시딩한 시점의 dream 잡. 역할 잡 카드와 같은 규칙으로 기준값이자 변화 판정의 근거다(R3).
  const [baseline, setBaseline] = useState(dream.managedJob);
  const [form, setForm] = useState(() => formFrom(dream.managedJob, dream.defaults));
  // 화면 상태다. 설치 요청 payload는 form만으로 만든다.
  const [customModel, setCustomModel] = useState(() => !isSupportedModel(form.model));
  // 이번 편집에서 사용자가 실제로 지정한 필드. 여기 없는 필드는 요청에 null로 실리고, 백엔드가
  // 파일의 값을 그대로 쓴다. 역할 잡 카드와 같은 규칙이다.
  const [specified, setSpecified] = useState<Partial<Record<EditableField, true>>>({});
  const [errors, setErrors] = useState<Partial<Record<EditableField, string>>>({});
  const [confirming, setConfirming] = useState(false);
  // 재설정 확인 화면. 역할 잡 카드와 같은 규칙이고 dream은 잡이 하나다(R5).
  const [resetting, setResetting] = useState(false);
  const [saving, setSaving] = useState(false);

  const signature = JSON.stringify(dream.managedJob);
  const changed = JSON.stringify(baseline) !== signature;
  const editing = Object.values(specified).some(Boolean);
  // 역할 잡 카드와 같은 이유로 저장 중에는 불일치로 보지 않는다.
  const pendingChange = changed && editing && !saving;

  /** 폼을 파일 값으로 되돌리고 그 값을 새 기준값으로 삼는다. */
  function seed(managedJob: ManagedDreamJob | null) {
    const seededForm = formFrom(managedJob, dream.defaults);
    setBaseline(managedJob);
    setForm(seededForm);
    setCustomModel(!isSupportedModel(seededForm.model));
    // 폼이 파일 값으로 돌아갔으므로 지정 기록도 함께 비운다.
    setSpecified({});
    setErrors({});
    setConfirming(false);
    setResetting(false);
  }

  /** 편집을 유지하고 파일의 현재 값을 새 기준값으로 삼는다. 역할 잡 카드와 같은 규칙이다. */
  function keepEdits() {
    setBaseline(dream.managedJob);
    setConfirming(false);
  }

  // 파일이 실제로 바뀌었고 사용자가 아무 필드도 지정하지 않았을 때만 조용히 되돌린다(R3).
  if (changed && !editing) {
    seed(dream.managedJob);
  }

  const installed = dream.managedJob !== null;
  const jobName = jobNameOf(slug);
  const job = dream.managedJob;

  /** 화면이 읽은 값과 파일의 현재 값의 차이. 역할 잡 카드와 같은 요소로 그린다(R3). */
  const fileChanges: WrittenJob[] = job
    ? [
        {
          name: jobName,
          added: baseline === null,
          fields: editableFields.map((field) => ({
            label: fieldLabels[field],
            current: baseline?.[field] ?? null,
            next: job[field] ?? missingValue,
          })),
          appOwnedDrift: [],
        },
      ]
    : [];

  const fileRemovals: RemovedJob[] =
    !job && baseline
      ? [
          {
            name: jobName,
            fields: editableFields.map((field) => ({
              label: fieldLabels[field],
              current: baseline[field],
            })),
          },
        ]
      : [];

  /** 확인 화면이 그릴 잡. 역할 잡 카드와 같은 모양으로 만들어 같은 요소에 넘긴다. */
  const writtenJobs: WrittenJob[] = form.enabled
    ? [
        {
          name: jobName,
          added: job === null,
          fields: editableFields.map((field) => ({
            label: fieldLabels[field],
            current: job?.[field] ?? null,
            next: form[field],
          })),
          appOwnedDrift: job?.appOwnedDrift ?? [],
        },
      ]
    : [];

  // 블록에 없던 잡을 끈 채로 저장하면 파일이 바뀌지 않는다. 그때는 제거할 것도 없다.
  const removedJobs: RemovedJob[] =
    !form.enabled && job
      ? [
          {
            name: jobName,
            fields: editableFields.map((field) => ({
              label: fieldLabels[field],
              current: job[field],
            })),
          },
        ]
      : [];

  function edit(field: EditableField, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setSpecified((previous) => ({ ...previous, [field]: true }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setConfirming(false);
  }

  /** 입력 방식 전환은 값 변경이 아니라 지정으로 치지 않는다. 직접 입력 칸에 적으면 edit이 받는다. */
  function switchModelInput(custom: boolean) {
    setCustomModel(custom);
    setErrors((previous) => ({ ...previous, model: undefined }));
    setConfirming(false);
  }

  /** 꺼진 잡의 값은 파일에 쓰이지 않으므로 검사하지 않는다. */
  function invalidFields() {
    if (!form.enabled) return {};
    const found: Partial<Record<EditableField, string>> = {};
    for (const field of editableFields) {
      if (!fieldRules[field].pattern.test(form[field])) {
        found[field] = fieldRules[field].message;
      }
    }
    return found;
  }

  function requestConfirm() {
    const found = invalidFields();
    setErrors(found);
    // 검증에 걸리면 확인 화면을 열지 않는다. 게이트웨이도 부르지 않는다.
    setConfirming(Object.keys(found).length === 0);
    setResetting(false);
  }

  /** 확인 화면은 한 번에 하나만 연다. 역할 잡 카드와 같은 규칙이다. */
  function requestReset() {
    setConfirming(false);
    setResetting(true);
  }

  /** 재설정 확인 화면이 그릴 잡. 왼쪽이 파일의 현재 값, 오른쪽이 앱 기본값이다(R5). */
  const resetChanges: WrittenJob[] = job
    ? [
        {
          name: jobName,
          added: false,
          fields: editableFields.map((field) => ({
            label: fieldLabels[field],
            current: job[field] ?? null,
            next: dream.defaults[field],
          })),
          appOwnedDrift: job.appOwnedDrift,
        },
      ]
    : [];

  /**
   * 재설정 요청. 세 필드에 기본값을 명시해 보낸다.
   *
   * `enabled`는 폼의 토글이 아니라 파일 기준이다. 재설정은 편집 가능 값만 되돌리고 잡의 존재
   * 여부를 바꾸지 않는다(R5).
   */
  function resetRequest(): DreamJobRequest {
    return {
      enabled: dream.managedJob !== null,
      interval: dream.defaults.interval,
      maxPer: dream.defaults.maxPer,
      model: dream.defaults.model,
    };
  }

  async function writeReset() {
    setSaving(true);
    try {
      const accepted = await onInstall(resetRequest(), baseline);
      // 역할 잡 카드와 같다. 성공하면 갱신된 스냅샷이 폼을 다시 시딩한다.
      if (accepted) setResetting(false);
    } finally {
      setSaving(false);
    }
  }

  /** 지정하지 않은 필드는 null로 보낸다. 폼에 파일 값이 차 있어도 그것을 명시로 보내지 않는다. */
  function request(): DreamJobRequest {
    const pick = (field: EditableField) => (specified[field] ? form[field] : null);
    return {
      enabled: form.enabled,
      interval: pick("interval"),
      maxPer: pick("maxPer"),
      model: pick("model"),
    };
  }

  async function write() {
    setSaving(true);
    try {
      const accepted = await onInstall(request(), baseline);
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
      {/* 배지의 "설치됨"은 dream 스킬 이야기다. 잡이 아직 없다는 사실을 같은 낱말로 적으면
          두 판정이 뒤섞여 읽힌다. */}
      {!installed && (
        <p className="integration-note">앱 관리 블록에 이 프로젝트의 dream 잡이 아직 없습니다.</p>
      )}
      <p className="integration-note">
        기본 주기 2h는 관측된 dream 실행이 15분 규모이고, 정제할 트랜스크립트가 역할 세션이 끝난 뒤에야 생긴다는 사실에서 나온 값입니다. 역할 잡보다 촘촘하게 돌릴 이유가 없습니다.
      </p>

      <ul className="heartbeat-job-list">
        <li>
          <div className="heartbeat-job-head">
            <label className="heartbeat-job-toggle">
              <input
                checked={form.enabled}
                onChange={(event) => {
                  setForm((previous) => ({ ...previous, enabled: event.target.checked }));
                  setConfirming(false);
                }}
                type="checkbox"
              />
              <strong>dream 정제</strong>
            </label>
            <span className="heartbeat-job-settings">{jobName}</span>
          </div>

          <div className="heartbeat-job-fields">
            {editableFields.map((field) => {
              const id = `dream-${field}`;
              const message = errors[field];
              if (field === "model") {
                return (
                  <ModelField
                    custom={customModel}
                    fieldLabel={fieldLabels.model}
                    id={id}
                    jobLabel="dream 정제"
                    key={field}
                    message={message}
                    onCustomChange={switchModelInput}
                    onValueChange={(value) => edit("model", value)}
                    value={form.model}
                  />
                );
              }
              return (
                <div className="heartbeat-job-field" key={field}>
                  <span className="heartbeat-field-label">{fieldLabels[field]}</span>
                  <input
                    aria-describedby={message ? `${id}-error` : undefined}
                    aria-invalid={message ? true : undefined}
                    aria-label={`dream 정제 ${fieldLabels[field]}`}
                    id={id}
                    onChange={(event) => edit(field, event.target.value)}
                    value={form[field]}
                  />
                  {message && <p className="heartbeat-field-error" id={`${id}-error`}>{message}</p>}
                </div>
              );
            })}
          </div>

          {installed && !form.enabled && (
            <p className="integration-note">끄면 이 잡이 관리 블록에서 사라집니다. 편집한 값도 함께 사라지고, 다시 켜면 기본값으로 시작합니다.</p>
          )}

          {installed && (dream.lastRun ? (
            <div className="heartbeat-job-run">
              <span className={`heartbeat-run-result result-${dream.lastRun.result ?? "unknown"}`}>{dream.lastRun.result ? runResultLabels[dream.lastRun.result] ?? dream.lastRun.result : "결과 기록 없음"}</span>
              <span>{dream.lastRun.at ? `${dream.lastRun.at} (로컬 시각)` : "시각 기록 없음"}</span>
              <span>{dream.lastRun.durationSeconds === null ? "소요 시간 기록 없음" : `${dream.lastRun.durationSeconds.toFixed(1)}초`}</span>
            </div>
          ) : (
            <p className="integration-note">실행 기록 없음</p>
          ))}

          {/* 관리 블록에 없는 잡에는 보여주지 않는다. 되돌릴 파일 값이 없고, 폼은 이미 기본값에서
              시작한다(R5). */}
          {installed && (
            <>
              <button
                className="secondary-button heartbeat-job-reset"
                disabled={!supported}
                onClick={requestReset}
                type="button"
              >
                dream 잡 기본값으로 재설정
              </button>

              {resetting && (
                <div
                  aria-label="dream 잡 기본값 재설정 확인"
                  className="heartbeat-confirm"
                  role="group"
                >
                  <strong>확인 후 아래 파일 하나를 씁니다</strong>
                  <ul>
                    <li>{heartbeatFilePath} — 전역 파일입니다. 이 컴퓨터의 모든 프로젝트가 함께 씁니다.</li>
                  </ul>
                  <p>이 잡의 편집 가능 값만 앱 기본값으로 되돌립니다. 잡의 활성·비활성 상태와 같은 블록의 역할 잡은 그대로 둡니다.</p>
                  <JobChanges removed={[]} written={resetChanges} />
                  <div className="heartbeat-confirm-actions">
                    <button
                      className="primary-button"
                      disabled={saving}
                      onClick={writeReset}
                      type="button"
                    >
                      확인하고 되돌리기
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => setResetting(false)}
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
      </ul>

      {pendingChange && (
        <div aria-label="dream 잡 파일 변경" className="integration-warning" role="group">
          <strong>화면이 읽은 뒤 관리 블록이 바뀌었습니다</strong>
          <p>
            편집 중인 값을 지키려고 화면을 파일 값으로 되돌리지 않았습니다. 아래에서 왼쪽이 화면이 읽은 값, 오른쪽이 파일의 현재 값입니다.
          </p>
          <JobChanges removed={fileRemovals} written={fileChanges} />
          <div className="heartbeat-confirm-actions">
            <button
              className="secondary-button"
              onClick={() => seed(dream.managedJob)}
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
        <IntegrationWarning title="dream 잡을 쓰지 못했습니다">
          <p>{writeError}</p>
        </IntegrationWarning>
      )}

      {supported ? (
        <button className="secondary-button" onClick={requestConfirm} type="button">
          {installed ? "dream 잡 변경 사항 저장" : "이 프로젝트에 dream 잡 설치"}
        </button>
      ) : (
        <button className="secondary-button" disabled type="button">
          이 프로젝트에 dream 잡 설치
        </button>
      )}

      {confirming && (
        <div aria-label="dream 잡 설치 확인" className="heartbeat-confirm" role="group">
          <strong>확인 후 아래 파일 하나를 씁니다</strong>
          <ul>
            <li>{heartbeatFilePath} — 전역 파일입니다. 이 컴퓨터의 모든 프로젝트가 함께 씁니다.</li>
          </ul>
          <p>앱 관리 블록만 다시 씁니다. 블록 밖의 잡과 전역 설정은 읽기만 하고 그대로 둡니다. 같은 블록의 역할 잡도 값 그대로 남습니다.</p>
          <p>dream 설치는 프로젝트 로컬 파일을 쓰지 않습니다. 조건이 dream-prep 명령이라 역할 잡과 달리 조건 스크립트가 필요 없습니다.</p>
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

/** 정제 상태는 읽기 전용이다. 기록이 없는 경우는 오류가 아니므로 경고색을 쓰지 않는다. */
function DreamRefinementStatus({ refinement }: { refinement: DreamRefinement }) {
  return (
    <>
      <dl className="settings-details">
        <div>
          <dt>전체 트랜스크립트</dt>
          <dd>{refinement.totalTranscripts === 0 ? "트랜스크립트 없음" : `${refinement.totalTranscripts}개`}</dd>
        </div>
        <div><dt>미정제</dt><dd>{refinement.unrefinedTranscripts}개</dd></div>
        <div><dt>마지막 정제</dt><dd>{refinement.lastDream ?? "정제 기록 없음"}</dd></div>
        <div><dt>메모리 topic</dt><dd>{refinement.memoryTopics}개</dd></div>
      </dl>
      <p className="integration-note">
        미정제 수는 dream_meta.md의 마킹 기준입니다. dream은 실제 실행 시 열려 있는 활성 트랜스크립트를 다음 라운드로 미루므로, 한 번에 처리되는 수는 이보다 적을 수 있습니다.
      </p>
    </>
  );
}
