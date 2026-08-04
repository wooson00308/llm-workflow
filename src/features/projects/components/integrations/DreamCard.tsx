import { useState } from "react";
import { MaxPerField, maxPerFieldError } from "../MaxPerField";
import { ModelField, isSupportedModel } from "../ModelField";
import type {
  DreamIntegration,
  DreamJobRequest,
  DreamRefinement,
  HeartbeatJobRun,
  IntegrationReadFailure,
  IntegrationsSnapshot,
  JobDefaults,
  JobQuota,
  ManagedDreamJob,
} from "../../domain/types";
import {
  IntegrationCard,
  IntegrationWarning,
  type IntegrationBadge,
  type IntegrationCardProps,
} from "./IntegrationCard";
import { JobChanges, type RemovedJob, type WrittenJob } from "./JobChanges";
import { browserJobValueMemoryStore } from "../../infrastructure/jobValueMemoryStore";

const name = "dream";
const description =
  "역할 세션이 남긴 트랜스크립트를 메모리로 정제해, 다음 세션이 과거 맥락을 아는 상태로 시작하게 합니다.";

/** dream 스킬이 들어 있는 저장소. 하트비트와 같은 저장소다. */
const repository = "https://github.com/wooson00308/claude-heartbeat";

const installCommand = "heartbeat install dream";

/** 역할 잡 카드(`HeartbeatCard.tsx`)의 같은 이름 상수와 글자까지 같아야 한다. */
const jobsFileNote = "이 프로젝트 전용 파일입니다. 다른 프로젝트의 잡은 각자의 파일에 있습니다.";

/**
 * 역할 잡 카드의 같은 이름 상수와 글자까지 같아야 한다.
 *
 * 전환 전에는 "다른 프로젝트가 이 블록에 둔 잡도 값 그대로 남습니다"였다. 파일이 갈린 뒤로는 더
 * 강한 사실이 그 자리를 대신한다.
 */
const otherProjectsNote = "다른 프로젝트의 잡은 이 파일에 들어올 수 없어 영향을 받지 않습니다.";

/** 역할 잡 카드의 같은 이름 상수와 글자까지 같아야 한다. */
const duplicateResolutionNote =
  "이름이 같으면 데몬이 이 프로젝트의 잡 파일을 우선하고 옛 정의는 무시합니다. 이름이 다르면 둘 다 실행됩니다. 앱이 전환 전에 옛 파일에 써 둔 정의는 이 카드에서 한 번 저장하면 앱이 치웁니다. 손으로 적은 잡은 앱이 지우지 않으므로 직접 정리해야 합니다.";

const runResultLabels: Record<string, string> = {
  success: "성공",
  failure: "실패",
  timeout: "시간 초과",
  // 라벨은 건너뛰었다는 사실만 적는다. 사유는 아래 문장이 받는다(SPEC-023 R1).
  // `quota_skipped`는 사유를 아는 값이라 그대로 둔다.
  skipped: "건너뜀",
  quota_skipped: "건너뜀 · 실행 한도 도달",
};

/**
 * 역할 잡 카드(`HeartbeatCard.tsx`)의 같은 이름 상수와 글자까지 같아야 한다(R8).
 *
 * 사유를 읽지 못했을 때만 나온다. 사유를 알게 된 자리에서는 그 사유가 이 자리를 대신한다(R2).
 */
const skippedReasonNote =
  "건너뜀에는 조건을 충족하지 못한 경우와 조건 검사가 실행되지 못한 경우가 모두 들어갑니다. 앱은 둘 중 어느 쪽인지 알지 못하며, 실제 사유는 하트비트 로그 파일에 남습니다.";

/**
 * 잡 파일에는 정의가 있는데 하트비트가 그것을 실행한 기록이 없는 상태(R4). 제목과 본문 모두 역할 잡
 * 카드(`HeartbeatCard.tsx`)의 같은 이름 상수와 글자까지 같아야 한다.
 *
 * 문구가 원인을 단정하지 않는 이유는 그 카드의 주석에 적혀 있다 — 이 증거로는 첫 주기 전인 잡과
 * 데몬이 못 읽는 잡이 구분되지 않고, 앱은 데몬 버전을 판정하지 않는다.
 */
const noRunEvidenceTitle = "하트비트가 이 잡을 실행한 기록이 없습니다";

const noRunEvidenceNote =
  "잡 파일에는 이 잡의 정의가 있는데 하트비트가 실행한 기록이 없습니다. 아직 첫 주기가 오지 않았을 수도 있고, 하트비트가 프로젝트별 잡 파일을 읽지 못하는 버전일 수도 있습니다. 앱은 하트비트 버전을 판정하지 않으므로 둘 중 어느 쪽인지 알지 못합니다. 주기가 지나도 기록이 생기지 않으면 하트비트를 갱신하세요.";

/**
 * 잡 파일에 정의는 있는데 실행 기록이 없는 상태인가(R4). 역할 잡 카드와 같은 판정이다.
 *
 * 새 백엔드 값이 아니라 이미 실린 두 사실의 겹침이다 — 관리 잡 목록에 그 잡이 있다는 것과 그 잡의
 * `lastRun`이 없다는 것. 잡이 꺼져 있으면 거짓이다.
 */
function missingRunEvidence(installed: boolean, run: HeartbeatJobRun | null): boolean {
  return installed && run === null;
}

/**
 * 역할 잡 카드(`HeartbeatCard.tsx`)의 같은 이름 상수와 글자까지 같아야 한다.
 *
 * dream 잡의 조건은 앱이 만드는 스크립트가 아니라 외부 명령이라(`externalConditionNote`) 이 어휘의
 * 코드가 실제로 올지는 그 도구에 달려 있다. 통로만 같게 열어 두고, 어휘 밖의 값은 아래 함수가
 * 받은 문자열 그대로 내보낸다.
 */
const skippedReasonLabels: Record<string, string> = {
  eligible: "조건 검사는 처리할 대상이 있다고 판정했습니다.",
  "no-target": "처리할 대상이 없어 건너뛰었습니다.",
  "migration-lock": "마이그레이션 잠금 때문에 판정을 멈췄습니다.",
  usage: "조건 문자열의 역할 인자가 잘못됐습니다.",
};

/**
 * 건너뜀 사유 한 줄. 어휘 밖의 값은 받은 문자열을 그대로 보여준다 — 조건 검사가 시간을 넘기거나
 * 실행에 실패하면 데몬이 코드가 아니라 문장을 직접 넣고(`condition 타임아웃 (10s)` 등), 그 경우도
 * 같은 자리에 나타나야 한다(R1).
 *
 * 값이 없거나 공백뿐이면 `null`이다. 사유를 모르는 상태이므로 화면은 지금 그대로 둔다(R2).
 */
function skippedReason(output: string | null | undefined): string | null {
  const reason = output?.trim();
  return reason ? skippedReasonLabels[reason] ?? reason : null;
}

/**
 * 조건의 출처와 그 한계(R11·D3). 역할 잡의 조건은 앱 관리 스크립트라 이 문장을 쓰지 않는다.
 *
 * 플랫폼 이름을 넣지 않는다. D3은 이 요구를 "Windows 동작을 보증하지 않는다"로 적었지만 앱이
 * 보증하지 못하는 것은 플랫폼과 무관하게 그 외부 명령 전부이고, 화면은 실행 플랫폼을 알지 못한다
 * (R5가 화면 문구의 OS 이름 하드코딩을 금지했고 payload에도 그 신호가 없다). 플랫폼별 문장이
 * 필요하다는 결론이 나면 이 상수 하나만 고치면 된다.
 */
const externalConditionNote =
  "이 잡의 조건은 앱이 관리하는 스크립트가 아니라 외부 명령입니다. 앱은 그 명령이 동작하는지 보증하지 않습니다.";

/**
 * 실행 한도 사용량의 문구. 역할 잡 카드(`HeartbeatCard.tsx`)와 같은 낱말을 쓴다. 두 카드가 같은
 * 사실을 다른 말로 부르면 사용자가 잡 종류마다 다른 규칙이 있다고 읽는다. 문구만 맞추고 코드는
 * 공유하지 않는 것은 `runResultLabels`가 두 파일에 따로 있는 것과 같은 선택이다.
 *
 * `unknown`은 문구가 없다. 관리 블록에 dream 잡이 없거나 블록을 읽지 못한 상태이고, 그 값이 나오는
 * 경로에서는 이 줄 자체가 그려지지 않는다.
 */
function quotaUsageLabel(quota: JobQuota): string | null {
  switch (quota.kind) {
    case "counted":
      return `${quota.used}/${quota.limit} · ${quota.window} 기준`;
    // 한도는 알지만 기록이 없는 상태다. 0회로 단정하지 않으므로 `0/`으로 적지 않는다.
    case "noRuns":
      return `실행 기록 없음 · 한도 ${quota.limit}회/${quota.window}`;
    // 역할 잡 카드와 글자까지 같아야 한다. 두 카드가 같은 사실을 다른 말로 부르면 사용자가 잡
    // 종류마다 다른 규칙이 있다고 읽는다.
    case "unlimited":
      return "제한 없음 — 실행 횟수 제한 없이 주기마다 실행됩니다.";
    case "ignoredLimit":
      return `한도 없음 — max_per 값 "${quota.value}"을 하트비트가 한도로 인정하지 않아 이 잡이 제한 없이 실행됩니다. 값을 고치기 전에는 이 잡을 저장할 수 없습니다.`;
    case "unknown":
      return null;
  }
}

/**
 * `recoversAt`은 RFC3339(UTC)라 로컬로 바꿔도 안전하다. `lastRun.at`과 성질이 다르다.
 * 파싱에 실패하면 원문을 그대로 돌려준다.
 */
function localTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** 회복 시각은 예상이다. 데몬이 멈춰 있거나 tick 주기 때문에 실제 재개는 그보다 늦을 수 있다. */
function quotaRecoveryLabel(recoversAt: string): string {
  return `${localTime(recoversAt)}에 1회 여유 (예상)`;
}

/**
 * 소진이면서 정제할 것이 남아 있는 상태(R3). 소진만으로는 경고가 아니다.
 *
 * dream의 대기 물량 근거는 역할 잡의 판정 경로가 아니라 미정제 트랜스크립트 수다. 그래서 마이그레이션
 * 락도 이 경고에 영향을 주지 않는다 — 락이 막는 것은 역할 세션이고 dream은 역할 잡이 아니다.
 */
function quotaWarned(quota: JobQuota, refinement: DreamRefinement): boolean {
  return quota.kind === "counted" && quota.exhausted && refinement.unrefinedTranscripts > 0;
}

const editableFields = ["interval", "maxPer", "model", "timeout"] as const;

type EditableField = (typeof editableFields)[number];

/** 역할 잡 카드의 `RoleForm`과 같은 모양이다. 한도의 두 상태를 문자열 하나로 겸하지 않는다(R3). */
type DreamForm = Record<EditableField, string> & { enabled: boolean; maxPerUnlimited: boolean };

const fieldLabels: Record<EditableField, string> = {
  interval: "주기",
  maxPer: "실행 한도",
  model: "모델",
  timeout: "시간 초과",
};

/** 관리 블록에 그 줄이 없을 때의 표기. 역할 잡 카드와 같은 낱말이다. */
const missingValue = "없음";

/** 한도 줄이 없는 상태의 표기. 역할 잡 카드와 같은 낱말이어야 한다(R1). */
const unlimitedLabel = "제한 없음";

/**
 * 차이 표시가 쓰는 파일 쪽 값. 잡이 블록에 없으면 `null`이다.
 *
 * 블록에 있는 잡의 한도 줄 없음은 "제한 없음"이다. 역할 잡 카드의 같은 이름 함수와 같은 규칙이다.
 */
function fileValue(job: ManagedDreamJob | null, field: EditableField): string | null {
  if (!job) return null;
  if (field === "maxPer") return job.maxPer ?? unlimitedLabel;
  return job[field];
}

/** 차이 표시가 쓰는 폼 쪽 값. 한도는 선택 자체가 값이다. */
function formValue(form: DreamForm, field: EditableField): string {
  if (field === "maxPer") return form.maxPerUnlimited ? unlimitedLabel : form.maxPer;
  return form[field];
}

/**
 * 백엔드 검증과 같은 규칙이다. 백엔드는 방어선으로 남겨 두고 여기서 먼저 막는다.
 *
 * `maxPer`는 여기 없다. 그 규칙은 `maxPerFieldError`가 갖고 두 카드가 그 하나를 함께 쓴다.
 */
const fieldRules: Record<Exclude<EditableField, "maxPer">, { pattern: RegExp; message: string }> = {
  interval: {
    pattern: /^\d+[smhd]$/,
    message: "숫자 뒤에 s, m, h, d 중 하나를 붙여 주세요. 예: 2h",
  },
  model: {
    pattern: /^\S+$/,
    message: "공백 없는 한 줄 값이어야 합니다. 예: opus",
  },
  timeout: {
    pattern: /^\d+[smhd]$/,
    message: "숫자 뒤에 s, m, h, d 중 하나를 붙여 주세요. 예: 30m",
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
    // 블록에 있는데 한도 줄만 없으면 사용자가 고른 제한 없음이다(R3). 앱 기본값은 화면에 보이지
    // 않고, `한도 지정`으로 되돌렸을 때 칸에 들어 있을 값으로만 남는다. 역할 잡 카드와 같은 규칙이다.
    maxPerUnlimited: Boolean(job) && job?.maxPer == null,
    // 파일의 값은 그대로 보여준다. `0/24h`도 앱 기본값이나 제한 없음으로 갈아치우지 않는다(R5).
    maxPer: job?.maxPer ?? defaults.maxPer,
    model: job?.model ?? defaults.model,
    timeout: job?.timeout ?? defaults.timeout,
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

  // 잡 폼이 그려지는 조건. 선행 조건 미충족과 잡 파일 읽기 실패에서는 아래 분기가 폼 자체를 그리지
  // 않으므로 접힘 요약도 그 상태에서는 조용해야 한다. 역할 잡 카드와 같은 규칙이다.
  const jobShown =
    dream !== null &&
    dream.installation === "installed" &&
    dream.heartbeat === "installed" &&
    !snapshot?.managedBlockFailure;

  // 골격에 값을 넘기는 것은 카드다. 역할 잡 카드가 연 통로를 세 번째 연동이 그대로 쓴다.
  const bodyWarning =
    (dream ? quotaWarned(dream.quota, dream.refinement) : false) ||
    (jobShown && missingRunEvidence(dream.managedJob !== null, dream.lastRun));

  return (
    <IntegrationCard
      badge={dream && badgeOf(dream)}
      bodyWarning={bodyWarning}
      description={description}
      duplicateJobs={dream?.duplicateJobs ?? []}
      duplicateWarning={{
        title: "이 프로젝트의 dream 잡이 옛 전역 파일에도 있습니다",
        description:
          `같은 프로젝트에 dream 잡이 둘이면 두 세션이 같은 트랜스크립트를 동시에 정제해 같은 메모리 파일을 서로 덮어쓸 수 있습니다. 실행 쿼터도 두 배로 소모됩니다. ${duplicateResolutionNote}`,
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
          {/* 설치 상태와 무관하게 항상 보인다. 조건의 출처는 설치 여부로 달라지지 않는다(R11). */}
          <p className="integration-note">{externalConditionNote}</p>

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

  /** 역할 잡 카드와 같은 규칙의 토글. 끄는 잡의 파일 값을 기억하고, 다시 켤 때 그 값으로 돌아온다. */
  function toggle(enabled: boolean) {
    if (!enabled && dream.managedJob) {
      browserJobValueMemoryStore.remember(jobNameOf(slug), {
        interval: dream.managedJob.interval ?? undefined,
        // 한도만 `null`을 그대로 넘긴다. `?? undefined`로 접으면 제한 없음이 "기억하지 못함"이 되어
        // 다시 켤 때 앱 기본값으로 시작한다. 역할 잡 카드와 같은 규칙이다.
        maxPer: dream.managedJob.maxPer,
        model: dream.managedJob.model ?? undefined,
        timeout: dream.managedJob.timeout ?? undefined,
      });
    }
    if (enabled && !dream.managedJob) {
      const recalled = browserJobValueMemoryStore.recall(jobNameOf(slug));
      if (recalled) {
        // 한도는 따로 옮긴다. 통째로 펼치면 `maxPer` 칸에 `null`이 들어간다.
        const { maxPer, ...rest } = recalled;
        // 기억한 값은 파일에 없으므로 지정 필드로 실어 보내야 저장에 반영된다.
        setForm((previous) => ({
          ...previous,
          ...rest,
          ...(maxPer === undefined ? {} : { maxPerUnlimited: maxPer === null }),
          ...(typeof maxPer === "string" ? { maxPer } : {}),
          enabled,
        }));
        setSpecified((previous) => ({
          ...previous,
          ...Object.fromEntries(Object.keys(recalled).map((field) => [field, true])),
        }));
        const model = recalled.model;
        if (model) setCustomModel(!isSupportedModel(model));
        setConfirming(false);
        return;
      }
    }
    setForm((previous) => ({ ...previous, enabled }));
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
            current: fileValue(baseline, field),
            next: fileValue(job, field) ?? missingValue,
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
              current: fileValue(baseline, field),
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
            current: fileValue(job, field),
            next: formValue(form, field),
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
              current: fileValue(job, field),
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

  /**
   * 한도의 선택 전환. 모델의 입력 방식 전환과 달리 지정으로 친다 — 제한 없음을 고르는 것은 관리
   * 블록에서 한도 줄을 빼는 결정이라 그 자체가 파일에 쓰일 값이다. 역할 잡 카드와 같은 규칙이다.
   *
   * `maxPer` 문자열은 건드리지 않는다. 한도 지정으로 되돌렸을 때 칸이 비어 있으면 안 된다.
   */
  function switchMaxPer(unlimited: boolean) {
    setForm((previous) => ({ ...previous, maxPerUnlimited: unlimited }));
    setSpecified((previous) => ({ ...previous, maxPer: true }));
    setErrors((previous) => ({ ...previous, maxPer: undefined }));
    setConfirming(false);
  }

  /**
   * 꺼진 잡의 값은 파일에 쓰이지 않으므로 검사하지 않는다.
   *
   * 제한 없음인 한도 칸도 검사하지 않는다. 검사할 값이 없다 — 그 상태는 파일에 줄을 쓰지 않는
   * 것이고, 칸에 남아 있는 문자열은 한도 지정으로 되돌렸을 때 쓸 값일 뿐이다.
   */
  function invalidFields() {
    if (!form.enabled) return {};
    const found: Partial<Record<EditableField, string>> = {};
    for (const field of editableFields) {
      if (field === "maxPer") {
        if (form.maxPerUnlimited) continue;
        const message = maxPerFieldError(form.maxPer);
        if (message) found.maxPer = message;
        continue;
      }
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
            current: fileValue(job, field),
            // 재설정이 되돌리는 값은 언제나 앱 기본값이고 기본값의 한도는 언제나 값이다(R1).
            next: dream.defaults[field],
          })),
          appOwnedDrift: job.appOwnedDrift,
        },
      ]
    : [];

  /**
   * 재설정 요청. 네 필드에 기본값을 명시해 보낸다.
   *
   * `enabled`는 폼의 토글이 아니라 파일 기준이다. 재설정은 편집 가능 값만 되돌리고 잡의 존재
   * 여부를 바꾸지 않는다(R5).
   */
  function resetRequest(): DreamJobRequest {
    return {
      enabled: dream.managedJob !== null,
      interval: dream.defaults.interval,
      // 역할 잡 카드와 같다. 앱 기본값은 언제나 한도 값이다.
      maxPer: { kind: "limit", value: dream.defaults.maxPer },
      model: dream.defaults.model,
      timeout: dream.defaults.timeout,
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
    // 지정하지 않았으면 `null`이고 파일 값이 이긴다. 지정했으면 선택이 두 값 중 하나를 정한다(R3).
    const quota = specified.maxPer
      ? form.maxPerUnlimited
        ? ({ kind: "unlimited" } as const)
        : ({ kind: "limit", value: form.maxPer } as const)
      : null;
    return {
      enabled: form.enabled,
      interval: pick("interval"),
      maxPer: quota,
      model: pick("model"),
      timeout: pick("timeout"),
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
                onChange={(event) => toggle(event.target.checked)}
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
              if (field === "maxPer") {
                return (
                  <MaxPerField
                    fieldLabel={fieldLabels.maxPer}
                    id={id}
                    jobLabel="dream 정제"
                    key={field}
                    message={message}
                    onUnlimitedChange={switchMaxPer}
                    onValueChange={(value) => edit("maxPer", value)}
                    unlimited={form.maxPerUnlimited}
                    value={form.maxPer}
                  />
                );
              }
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
            <>
              <div className="heartbeat-job-run">
                <span className={`heartbeat-run-result result-${dream.lastRun.result ?? "unknown"}`}>{dream.lastRun.result ? runResultLabels[dream.lastRun.result] ?? dream.lastRun.result : "결과 기록 없음"}</span>
                <span>{dream.lastRun.at ? `${dream.lastRun.at} (로컬 시각)` : "시각 기록 없음"}</span>
                <span>{dream.lastRun.durationSeconds === null ? "소요 시간 기록 없음" : `${dream.lastRun.durationSeconds.toFixed(1)}초`}</span>
              </div>
              {/* `skipped`에만 붙인다. 실행 기록이 없는 잡에는 설명할 결과가 없고,
                  `quota_skipped` 옆에는 데몬이 이전 조건 검사의 사유를 지우지 않고 남겨 두므로
                  붙이면 낡은 문장이 이번 사유로 읽힌다(R3). */}
              {dream.lastRun.result === "skipped" && <p className="integration-note">{skippedReason(dream.lastRun.conditionOutput) ?? skippedReasonNote}</p>}
            </>
          ) : (
            <p className="integration-note">실행 기록 없음</p>
          ))}

          {/* 사용량은 마지막 실행 기록을 대체하지 않고 나란히 놓인다(R1). 관리 블록에 없는 잡에는
              그리지 않는다. */}
          {installed && <JobQuotaLine quota={dream.quota} />}

          {/* R4. 위 실행 기록 자리가 "기록 없음"이면서 잡이 파일에 있는 상태다. 선행 조건 미충족과
              잡 파일 읽기 실패는 이 폼 자체가 그려지지 않는 상태라 여기서 다시 보지 않는다.
              저장·재설정 버튼은 건드리지 않는다 — 확인 필요 3번은 "막지 않고 알린다"로 승인됐다. */}
          {missingRunEvidence(installed, dream.lastRun) && (
            <IntegrationWarning title={noRunEvidenceTitle}>
              <p>{noRunEvidenceNote}</p>
            </IntegrationWarning>
          )}

          {installed && dream.quota.kind === "counted" && quotaWarned(dream.quota, dream.refinement) && (
            <IntegrationWarning title="dream 잡이 대기 중인 일을 처리하지 못하고 있습니다">
              <p>
                정제하지 않은 트랜스크립트가 {dream.refinement.unrefinedTranscripts}개 남아 있는데
                실행 한도({dream.quota.used}/{dream.quota.limit} · {dream.quota.window} 기준)가 차서,
                하트비트가 조건 검사 전에 이 잡을 건너뜁니다.
              </p>
              {dream.quota.recoversAt && <p>{quotaRecoveryLabel(dream.quota.recoversAt)}</p>}
              <p>
                더 기다리지 않으려면 이 잡의 {fieldLabels.maxPer} 칸에서 한도를 올리고 아래 저장
                버튼을 누르세요.
              </p>
            </IntegrationWarning>
          )}

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
                    <li>{snapshot.jobsFilePath} — {jobsFileNote}</li>
                  </ul>
                  <p>이 잡의 편집 가능 값만 앱 기본값으로 되돌립니다. 잡의 활성·비활성 상태와 이 파일의 역할 잡은 그대로 둡니다. {otherProjectsNote}</p>
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
            <li>{snapshot.jobsFilePath} — {jobsFileNote}</li>
          </ul>
          <p>이 파일 전체를 앱이 다시 씁니다. 이 파일의 역할 잡은 값 그대로 남고, 손으로 덧붙인 줄은 남지 않습니다. {otherProjectsNote}</p>
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

/**
 * 잡 하나의 실행 한도 사용량 줄. 마지막 실행 기록 줄과 나란히 놓인다(R1).
 *
 * 소진은 사실 표시일 뿐 경고가 아니다(R3). 미정제까지 있을 때의 경고는 잡 행이 따로 그린다.
 * 표시 규칙과 클래스 이름은 역할 잡 카드의 같은 줄과 같다.
 */
function JobQuotaLine({ quota }: { quota: JobQuota }) {
  const usage = quotaUsageLabel(quota);
  if (!usage) return null;
  // 소진한 잡이면 그 값 자체를 들고 있는다. 회복 시각은 소진 상태에서만 의미가 있다.
  const exhausted = quota.kind === "counted" && quota.exhausted ? quota : null;
  return (
    <div className="heartbeat-job-quota">
      <span className={`heartbeat-quota-usage${exhausted ? " quota-exhausted" : ""}`}>{usage}</span>
      {exhausted && <span className="heartbeat-quota-exhausted">실행 한도 도달</span>}
      {exhausted?.recoversAt && <span>{quotaRecoveryLabel(exhausted.recoversAt)}</span>}
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
