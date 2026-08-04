import { useId, useState } from "react";
import { MaxPerField, maxPerFieldError } from "../MaxPerField";
import { ModelField, isSupportedModel } from "../ModelField";
import type {
  DuplicateIntegrationJob,
  HeartbeatIntegration,
  HeartbeatJobRun,
  HeartbeatSetupStage,
  HeartbeatRunControls,
  HeartbeatRunFailure,
  HeartbeatSetupState,
  HeartbeatSetupStep,
  IntegrationReadFailure,
  IntegrationsSnapshot,
  JobDefaults,
  JobQuota,
  ManagedRoleJob,
  PendingRoleWork,
  RoleJobRequest,
} from "../../domain/types";
import {
  IntegrationCard,
  IntegrationWarning,
  type IntegrationBadge,
  type IntegrationCardProps,
} from "./IntegrationCard";
import { JobChanges, type RemovedJob, type WrittenJob } from "./JobChanges";
import { HeartbeatUpdateGuide } from "./HeartbeatUpdateGuide";
import { browserJobValueMemoryStore } from "../../infrastructure/jobValueMemoryStore";
import { browserSetupGuideCollapseStore } from "../../infrastructure/browserSetupGuideCollapseStore";
import { copy } from "../../infrastructure/clipboard";

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
  // 라벨은 건너뛰었다는 사실만 적는다. 사유는 아래 문장이 받는다(SPEC-023 R1).
  // `quota_skipped`는 사유를 아는 값이라 그대로 둔다.
  skipped: "건너뜀",
  quota_skipped: "건너뜀 · 실행 한도 도달",
};

/**
 * 사유를 읽지 못했을 때 라벨 옆에서 "왜?"를 받아 주는 문장. dream 카드(`DreamCard.tsx`)와 글자까지
 * 같아야 한다 — 두 카드가 같은 사실을 다른 말로 부르면 사용자가 잡 종류마다 다른 규칙이 있다고 읽는다.
 * 문구만 맞추고 코드는 공유하지 않는 것은 `runResultLabels`가 두 파일에 따로 있는 것과 같은 선택이다.
 *
 * 사유를 알게 된 자리에서는 이 문장이 나오지 않는다. 그때까지는 이 문장이 지금 그대로 남는다(R2).
 */
const skippedReasonNote =
  "건너뜀에는 조건을 충족하지 못한 경우와 조건 검사가 실행되지 못한 경우가 모두 들어갑니다. 앱은 둘 중 어느 쪽인지 알지 못하며, 실제 사유는 하트비트 로그 파일에 남습니다.";

/**
 * 조건 스크립트의 ASCII 사유 코드를 사용자용 문장으로 옮긴다. 문장을 스크립트가 아니라 앱이 갖는
 * 선택이라(SPEC-023 확인 필요 3번) 사용자가 보는 말이 플랫폼에 따라 갈리지 않는다.
 *
 * 어휘는 조건 스크립트가 내는 네 코드 전부를 덮는다. `eligible`은 건너뜀 옆에 오지 않는 값이지만,
 * 어휘 안의 코드가 날문자로 새는 자리를 남기지 않는다.
 *
 * dream 카드의 같은 상수와 글자까지 같아야 한다.
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
 * 잡 파일 한 줄의 설명. dream 카드(`DreamCard.tsx`)와 글자까지 같아야 한다 — 두 카드가 같은 파일을
 * 다른 말로 부르면 사용자가 잡 종류마다 다른 파일이 있다고 읽는다.
 *
 * 파일이 프로젝트별로 갈렸다는 것이 이 전환의 사용자 가치라 그 사실이 문장에 남아 있다. 경로 자체는
 * payload의 `jobsFilePath`이고 화면이 적지 않는다.
 */
const jobsFileNote = "이 프로젝트 전용 파일입니다. 다른 프로젝트의 잡은 각자의 파일에 있습니다.";

/**
 * 확인 화면이 담는 보장. 앱이 쓰는 파일에는 다른 프로젝트의 잡이 애초에 들어올 수 없다.
 *
 * 전환 전에는 "다른 프로젝트가 이 블록에 둔 잡도 값 그대로 남습니다"였다. 한 전역 파일을 나눠 쓰던
 * 시절의 보장이고, 파일이 갈린 뒤로는 더 강한 사실이 그 자리를 대신한다. dream 카드와 글자까지
 * 같아야 한다.
 */
const otherProjectsNote = "다른 프로젝트의 잡은 이 파일에 들어올 수 없어 영향을 받지 않습니다.";

/**
 * 중복 잡 경고에서 "그래서 어떻게 되고 무엇을 하면 되는가"를 맡는 뒷문장. dream 카드와 글자까지
 * 같아야 한다.
 *
 * 감지 대상은 옛 전역 파일에 남은 이 프로젝트 slug의 잡이고, 자리(관리 블록 안팎)를 가리지 않는다.
 * 그래서 문구도 "블록 밖"을 전제하지 않는다. 출처가 둘이라 처방도 둘이다 — 앱이 전환 전에 써 둔
 * 정의는 저장 한 번으로 앱이 치우고, 사용자가 손으로 적은 잡은 앱이 지우지 않는다.
 */
const duplicateResolutionNote =
  "이름이 같으면 데몬이 이 프로젝트의 잡 파일을 우선하고 옛 정의는 무시합니다. 이름이 다르면 둘 다 실행됩니다. 앱이 전환 전에 옛 파일에 써 둔 정의는 이 카드에서 한 번 저장하면 앱이 치웁니다. 손으로 적은 잡은 앱이 지우지 않으므로 직접 정리해야 합니다.";

/**
 * 잡 파일에는 정의가 있는데 하트비트가 그것을 실행한 기록이 없는 상태(R4). 제목과 본문 모두 dream
 * 카드(`DreamCard.tsx`)와 글자까지 같아야 한다 — 두 카드가 같은 사실을 다른 말로 부르면 사용자가
 * 잡 종류마다 다른 규칙이 있다고 읽는다.
 *
 * **문구가 원인을 단정하지 않는다.** 이 증거로는 "아직 한 번도 안 돈 잡"과 "데몬이 못 읽는 잡"이
 * 구분되지 않는다 — 방금 설치한 잡도 첫 실행 전까지는 같은 모양이다. 확인 필요 3번이 승인되면서
 * 결정문에 남은 한계이고, 문구가 그것을 감당한다. 앱이 데몬 버전을 판정하지 않는다는 사실도 숨기지
 * 않는다(판정은 대안 A이고 부결됐다). 앱이 알지 못하는 것을 아는 척하지 않는 어법은
 * `skippedReasonNote`가 이미 택한 것이고 그 선택을 따른다.
 */
const noRunEvidenceTitle = "하트비트가 이 잡을 실행한 기록이 없습니다";

const noRunEvidenceNote =
  "잡 파일에는 이 잡의 정의가 있는데 하트비트가 실행한 기록이 없습니다. 아직 첫 주기가 오지 않았을 수도 있고, 하트비트가 프로젝트별 잡 파일을 읽지 못하는 버전일 수도 있습니다. 앱은 하트비트 버전을 판정하지 않으므로 둘 중 어느 쪽인지 알지 못합니다. 주기가 지나도 기록이 생기지 않으면 하트비트를 갱신하세요.";

/**
 * 잡 파일에 정의는 있는데 실행 기록이 없는 상태인가(R4).
 *
 * 새 백엔드 값이 아니라 이미 실린 두 사실의 겹침이다 — 관리 잡 목록에 그 잡이 있다는 것과 그 잡의
 * `lastRun`이 없다는 것. payload에 필드를 더하면 같은 결론을 내는 자리가 둘이 된다.
 *
 * 잡이 꺼져 있으면 거짓이다. 잡 파일에 없는 잡이 안 도는 것은 정상이라 알릴 것이 없다.
 */
function missingRunEvidence(installed: boolean, run: HeartbeatJobRun | null): boolean {
  return installed && run === null;
}

const roleOrder = ["planner", "architect", "developer"] as const;

type RoleName = (typeof roleOrder)[number];

/** 그 역할이 무엇을 기다리고 있는지. 어느 문서인지는 밝히지 않는다(기획서 제외 범위). */
const pendingLabels: Record<RoleName, string> = {
  planner: "기획할 아이디어가",
  architect: "작업으로 분해할 승인 결정이",
  developer: "구현할 todo 작업이",
};

/**
 * 실행 한도 사용량의 문구. 잡 종류와 무관한 어법이라 한 곳에 모은다. dream 잡도 같은 문장을 쓴다.
 *
 * `unknown`은 문구가 없다. 앱이 한도를 모르는 상태이고, 그 값이 나오는 경로에서는 잡 폼 자체가
 * 그려지지 않는다.
 */
function quotaUsageLabel(quota: JobQuota): string | null {
  switch (quota.kind) {
    case "counted":
      return `${quota.used}/${quota.limit} · ${quota.window} 기준`;
    // 한도는 알지만 기록이 없는 상태다. 0회로 단정하지 않으므로 `0/`으로 적지 않는다(R5).
    case "noRuns":
      return `실행 기록 없음 · 한도 ${quota.limit}회/${quota.window}`;
    // 사용자가 고른 정상 상태다. 사용 횟수를 적지 않는다 — 데몬이 무제한 잡의 실행을 기록하지
    // 않으므로 보여줄 수 있는 숫자는 한도가 있던 시절의 이력뿐이다(SPEC-017 R6).
    case "unlimited":
      return "제한 없음 — 실행 횟수 제한 없이 주기마다 실행됩니다.";
    // 손볼 곳이 있다는 신호다. "형식이 올바르지 않아"라고 단정하지 않는다 — `0/24h`는 형식이 맞고
    // 데몬이 한도로 인정하지 않을 뿐이다(SPEC-017 R5).
    case "ignoredLimit":
      return `한도 없음 — max_per 값 "${quota.value}"을 하트비트가 한도로 인정하지 않아 이 잡이 제한 없이 실행됩니다. 값을 고치기 전에는 이 잡을 저장할 수 없습니다.`;
    case "unknown":
      return null;
  }
}

/**
 * `recovers_at`은 RFC3339(UTC)라 로컬로 바꿔도 안전하다. `last_run`과 성질이 다르다.
 * 파싱에 실패하면 원문을 그대로 돌려준다(`DevelopmentBoard`의 날짜 표시와 같은 방식).
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

/** 회복 시각은 예상이다. 데몬이 멈춰 있거나 tick 주기 때문에 실제 재개는 그보다 늦을 수 있다(R2). */
function quotaRecoveryLabel(recoversAt: string): string {
  return `${localTime(recoversAt)}에 1회 여유 (예상)`;
}

/**
 * 소진이면서 그 역할이 처리할 대상이 대기 중인 상태(R3). 소진만으로는 경고가 아니다. 대기 물량을
 * 모르면(`pendingWork`가 없으면) 경고하지 않는다.
 */
function quotaWarned(quota: JobQuota, role: RoleName, pendingWork?: PendingRoleWork): boolean {
  return quota.kind === "counted" && quota.exhausted && pendingWork?.[role] === true;
}

const editableFields = ["interval", "maxPer", "model", "timeout"] as const;

type EditableField = (typeof editableFields)[number];

/**
 * 잡 하나의 폼 상태. `maxPer` 문자열은 한도 지정일 때의 값이고, 제한 없음은 그와 별개의 상태다(R3).
 *
 * 두 상태를 문자열 하나로 겸하지 않는다. `maxPerUnlimited`일 때도 `maxPer`를 지우지 않아, 사용자가
 * 한도 지정으로 되돌리면 칸이 비어 있지 않다.
 */
type RoleForm = Record<EditableField, string> & { enabled: boolean; maxPerUnlimited: boolean };

/** 한도 줄이 없는 상태의 표기. 차이 표시에서 "없음"(줄이 없거나 잡이 없음)과 구분된다. */
const unlimitedLabel = "제한 없음";

/**
 * 차이 표시가 쓰는 파일 쪽 값. 잡이 블록에 없으면 `null`이다.
 *
 * 블록에 있는 잡의 한도 줄 없음은 `null`이 아니라 "제한 없음"이다. `null`을 넘기면 `JobChanges`가
 * "없음"으로 그려 잡이 새로 생기는 경우와 섞인다(완료 조건 8).
 */
function fileValue(job: ManagedRoleJob | null, field: EditableField): string | null {
  if (!job) return null;
  if (field === "maxPer") return job.maxPer ?? unlimitedLabel;
  return job[field];
}

/** 차이 표시가 쓰는 폼 쪽 값. 한도는 선택 자체가 값이다. */
function formValue(form: RoleForm, field: EditableField): string {
  if (field === "maxPer") return form.maxPerUnlimited ? unlimitedLabel : form.maxPer;
  return form[field];
}

const fieldLabels: Record<EditableField, string> = {
  interval: "주기",
  maxPer: "실행 한도",
  model: "모델",
  timeout: "시간 초과",
};

/** 관리 블록에 그 줄이 없을 때의 표기. 차이 표시가 없는 값에 쓰는 낱말과 같아야 한다. */
const missingValue = "없음";

/**
 * 백엔드 검증(TASK-004)과 같은 규칙이다. 백엔드는 방어선으로 남겨 두고 여기서 먼저 막는다.
 *
 * `maxPer`는 여기 없다. 그 규칙은 정규식 하나로 적히지 않아(0 이하 횟수와 0 기간을 걸러야 한다)
 * `maxPerFieldError`가 갖는다. 두 벌이 되면 안 되므로 이 표에서 뺐다.
 */
const fieldRules: Record<Exclude<EditableField, "maxPer">, { pattern: RegExp; message: string }> = {
  interval: {
    pattern: /^\d+[smhd]$/,
    message: "숫자 뒤에 s, m, h, d 중 하나를 붙여 주세요. 예: 30m",
  },
  model: {
    pattern: /^\S+$/,
    message: "공백 없는 한 줄 값이어야 합니다. 예: opus",
  },
  timeout: {
    pattern: /^\d+[smhd]$/,
    message: "숫자 뒤에 s, m, h, d 중 하나를 붙여 주세요. 예: 20m",
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

/**
 * 설치 단계의 이름. 명령이 곧 이름인 두 단계는 payload의 명령을 그대로 쓴다 — 화면이 명령 문자열을
 * 다시 적으면 같은 값의 정의가 둘이 되고, 도구가 하위 명령을 바꾸면 이름만 옛 값으로 남는다(R10).
 */
const stepLabels: Record<HeartbeatSetupStep, string | null> = {
  package: "패키지 설치",
  init: null,
  service: null,
  dream: "dream 스킬",
};

/**
 * 상태 표식의 낱말. 셋이 서로 다른 낱말이어야 한다(R4). 확인 불가는 완료도 미완료도 아닌 제3의
 * 상태이며, 색은 `App.css`가 갈라 준다.
 */
const stateLabels: Record<HeartbeatSetupState, string> = {
  done: "완료",
  not_done: "남은 일",
  unknown: "확인 불가",
};

/**
 * 단계 문구. `step`과 `state`의 조합으로 고르고 없는 조합은 만들지 않는다 — 백엔드는 1·3단계에
 * `not_done`을, 4단계에 `unknown`을 만들지 않는다.
 *
 * 상태를 여기서 다시 판정하지 않는다. `daemonRunning`은 3단계 문구를 사용자의 상태에 맞추는 데만
 * 쓰고 단계의 상태를 바꾸는 데 쓰지 않는다.
 */
function stepNote(stage: HeartbeatSetupStage, daemonRunning: boolean): string | null {
  switch (stage.step) {
    case "package":
      // R5. 확인한 것이 아니라 뒤 단계에서 함의한 것이다. "확인했다"고 적지 않는다.
      if (stage.state === "done") {
        return "다음 단계가 끝나 있어 패키지도 있는 것으로 봅니다. 앱이 따로 확인한 값은 아닙니다.";
      }
      return "앱은 패키지 설치 여부를 확인하지 않습니다 — 앱이 물려받는 PATH와 사용자 터미널의 PATH가 달라, 설치해 둔 것을 미설치라고 잘못 말할 수 있기 때문입니다. 이미 설치했다면 이 단계는 넘어가도 됩니다.";
    case "init":
      if (stage.state === "not_done") return "아래 명령을 터미널에서 실행하세요.";
      if (stage.state === "unknown") {
        return "판정에 쓰는 파일을 읽지 못해 이 단계를 확인하지 못했습니다. 그 경로는 아래에 있습니다.";
      }
      return null;
    case "service":
      if (stage.state !== "unknown") return null;
      // 이 플랫폼에서 볼 경로가 없는 상태. 감지 수단이 없다는 사실만 말하고 OS 이름을 적지 않는다(R10).
      if (!stage.evidence) {
        return "이 플랫폼에서는 앱이 등록 여부를 확인할 방법이 없습니다. 아래 명령으로 등록해도 이 단계는 확인 불가로 남습니다.";
      }
      // DECISION-4F1083FF. 표준 등록물이 없다는 것은 "등록 안 됨"의 충분한 근거가 아니다. 다른 라벨로
      // 등록해 데몬이 실제로 도는 설치가 실존하므로, 없음을 미완료로 단정하면 정상 설치가 영구히
      // 미완료로 남는다.
      return daemonRunning
        ? "표준 등록물을 아래 경로에서 찾지 못했습니다. 그것만으로 등록되지 않았다고 단정하지 않습니다 — 데몬은 이미 돌고 있는 것으로 보이며, 다른 이름으로 등록했다면 이 단계는 끝난 것입니다."
        : "표준 등록물을 아래 경로에서 찾지 못했습니다. 그것만으로 등록되지 않았다고 단정하지 않습니다 — 다른 이름으로 등록해 데몬이 이미 돌고 있다면 이 단계는 끝난 것입니다.";
    case "dream":
      // 설치 UI를 여기서 다시 만들지 않는다. dream 카드가 그 소유자다(R9).
      if (stage.state === "not_done") {
        return "선택 단계입니다. 없어도 워크플로우는 돕니다. 설치는 이 화면의 dream 카드에서 합니다.";
      }
      return null;
  }
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
          // 블록에 있는데 한도 줄만 없으면 사용자가 고른 제한 없음이다(R3). 여기가 지운 줄을
          // 되살리던 화면 쪽 자리다. 앱 기본값은 화면에 보이지 않고, `한도 지정`으로 되돌렸을 때
          // 칸에 들어 있을 값으로만 남는다.
          maxPerUnlimited: Boolean(installed) && installed?.maxPer == null,
          // 파일의 값은 그대로 보여준다. `0/24h`도 앱 기본값이나 제한 없음으로 갈아치우지 않는다(R5).
          maxPer: installed?.maxPer ?? defaults.maxPer,
          model: installed?.model ?? defaults.model,
          timeout: installed?.timeout ?? defaults.timeout,
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
  pendingWork,
  heartbeatRuns,
}: IntegrationCardProps) {
  const heartbeat = snapshot?.heartbeat ?? null;

  // 잡 폼이 그려지는 조건. 미설치와 잡 파일 읽기 실패에서는 아래 두 분기가 폼 자체를 그리지 않으므로
  // 접힘 요약도 그 상태에서는 조용해야 한다. 요약이 본문에 없는 경고를 알리면 사용자는 카드를 펼쳐
  // 놓고 무엇을 봐야 하는지 알 수 없다.
  const jobsShown =
    heartbeat !== null &&
    heartbeat.installation !== "not_installed" &&
    !snapshot?.managedBlockFailure;

  // 골격에 값을 넘기는 것은 카드다. 재료가 모두 이 자리에 있어 상태를 끌어올릴 필요가 없다.
  const bodyWarning = roleOrder.some((role) => {
    const status = heartbeat?.roles.find((entry) => entry.role === role);
    const quota = status?.quota;
    if (quota && quotaWarned(quota, role, pendingWork)) return true;
    if (!jobsShown) return false;
    const installed = heartbeat?.managedJobs.some((entry) => entry.role === role) ?? false;
    return missingRunEvidence(installed, status?.lastRun ?? null);
  });

  return (
    <IntegrationCard
      badge={heartbeat && badgeOf(heartbeat)}
      bodyWarning={bodyWarning}
      description={description}
      duplicateJobs={heartbeat?.duplicateJobs ?? []}
      duplicateWarning={{
        title: "이 프로젝트의 역할 잡이 옛 전역 파일에도 있습니다",
        description:
          `같은 역할 잡이 둘이면 두 세션이 동시에 깨어나고, 그중 하나는 lease 경합으로 NO_ELIGIBLE_WORK만 남기고 끝납니다. 실행 쿼터만 두 배로 소모됩니다. ${duplicateResolutionNote}`,
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

          {/* 마법사는 설치 분기 밖이다(R8). 표시 조건은 남은 필수 단계이지 `installation`이 아니다. */}
          <HeartbeatSetupWizard heartbeat={heartbeat} />

          {heartbeat.installation !== "not_installed" && (
            <>
              {snapshot.managedBlockFailure ? (
                <UnreadableManagedBlock failure={snapshot.managedBlockFailure} />
              ) : (
                <HeartbeatRoleJobs
                  heartbeatRuns={heartbeatRuns}
                  key={snapshot.slug}
                  onInstall={actions.installHeartbeatJobs}
                  pendingWork={pendingWork}
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
 * 설치 마법사(SPEC-016). 필수 단계 중 `done`이 아닌 것이 하나라도 있으면 보이고, 필수 3단계가 모두
 * 끝나면 접힌다(R8). dream은 선택이라 이 판정에 들어가지 않는다(R9).
 *
 * 사용자가 가이드를 접어 두는 것은 그와 다른 일이다. 이 판정은 마법사가 있고 없고를 정하고, 그쪽은
 * 남아 있는 마법사의 표시만 바꾼다.
 *
 * 단계 상태를 여기서 다시 판정하지 않는다. payload의 값을 그대로 그린다 — 판정이 백엔드와 화면에
 * 둘이 되면 3단계의 "없다고 없는 것이 아니다" 규칙이 화면에서 무너진다.
 *
 * `supported`로 가리지 않는다. 마법사는 쓰기 액션이 아니라 안내이고, 미지원 배너는 뷰가 따로 그린다.
 * 단계마다 실행 버튼을 두지 않는다 — 실행은 사용자 터미널의 몫이다(R11).
 */
function HeartbeatSetupWizard({ heartbeat }: { heartbeat: HeartbeatIntegration }) {
  // 마지막으로 복사한 단계 하나만 들고 있는다(R6). 두 단계에 동시에 "복사됨"이 떠 있으면 사용자는
  // 무엇이 클립보드에 있는지 알 수 없다.
  const [copied, setCopied] = useState<{ step: HeartbeatSetupStep; ok: boolean } | null>(null);
  // 가이드를 접어 두는 것은 표시 상태다. 연동 카드의 접기와 같은 성질이라 같은 idiom을 쓴다.
  // 펼침으로 시작하고, 이 상태는 payload 갱신과 무관하다 — 자동 재확인이 사용자가 접어 둔 가이드를
  // 다시 펼치면 안 된다.
  //
  // 고른 상태는 브라우저 저장소에 남는다. 연동 뷰가 조건부 렌더라 다른 메뉴를 누르면 이 컴포넌트가
  // 통째로 사라지고, 기억이 없으면 돌아올 때마다 다시 접어야 한다. 게으른 초기화라 렌더마다 읽지
  // 않고, 읽기가 실패해도 저장소가 펼침을 돌려주므로 여기서 실패를 다루지 않는다.
  //
  // 키는 카드 접힘과 다르다. 그쪽은 연동 id를 키로 하는 맵이라 가이드 상태를 같은 자리에 넣으면
  // 언젠가 생길 연동 id와 이름이 부딪힌다. 축이 갈려 있어 가이드를 접어도 카드 접힘 기억은 그대로다.
  const [open, setOpen] = useState(() => browserSetupGuideCollapseStore.load());
  const guideId = useId();

  const remaining = heartbeat.setupStages.some(
    (stage) => stage.required && stage.state !== "done",
  );
  if (!remaining) return null;

  // 접힌 채로도 보이는 요약. 끝난 단계만 센다 — 확인 불가는 미완료가 아니므로(R4) 남은 개수로 세면
  // 앱이 모르는 것을 안 한 것으로 말하게 된다.
  const requiredStages = heartbeat.setupStages.filter((stage) => stage.required);
  const doneCount = requiredStages.filter((stage) => stage.state === "done").length;

  // 저장은 사용자가 토글을 누를 때만 한다. 첫 마운트에서 읽은 값을 되쓰지 않는다. 저장이 실패해도
  // 저장소가 삼키므로 이번에 고른 상태는 화면에 그대로 반영된다.
  function toggleOpen() {
    const next = !open;
    setOpen(next);
    browserSetupGuideCollapseStore.save(next);
  }

  async function copyCommand(stage: HeartbeatSetupStage) {
    // payload의 명령을 그대로 넘긴다. 화면이 조각을 다시 조립하면 붙여 넣은 명령이 화면에 보이는
    // 것과 달라진다(R6).
    setCopied({ step: stage.step, ok: await copy(stage.command) });
  }

  return (
    <div className="integration-guide heartbeat-setup">
      <div className="heartbeat-setup-guide-head">
        <strong>설치 가이드</strong>
        <span className="heartbeat-setup-progress">
          필수 단계 {doneCount}/{requiredStages.length} 완료
        </span>
        {/* 표시를 바꾸는 버튼이지 단계를 실행하는 버튼이 아니다(R11). 이름에 그 차이를 적는다. */}
        <button
          aria-controls={guideId}
          aria-expanded={open}
          className="integration-toggle"
          onClick={toggleOpen}
          type="button"
        >
          {open ? "설치 가이드 접기" : "설치 가이드 펼치기"}
        </button>
      </div>

      {/* 접기는 언마운트가 아니다. 조건부 렌더로 빼면 어느 단계를 복사했는지 같은 화면 상태가
          사라진다. 연동 카드 본문과 같이 DOM에 남긴 채 `hidden`으로 감춘다. */}
      <div hidden={!open} id={guideId}>
        <p className="integration-note">
          앱이 하트비트를 대신 설치하지 않습니다. 아래 단계는 사용자가 자기 터미널에서 직접 실행합니다.
        </p>

        <ol className="heartbeat-setup-steps">
          {heartbeat.setupStages.map((stage, index) => {
            const note = stepNote(stage, heartbeat.daemonRunning);
            const title = stepLabels[stage.step] ?? stage.command;
            const result = copied?.step === stage.step ? copied : null;
            return (
              <li className="heartbeat-setup-step" key={stage.step}>
                <div className="heartbeat-setup-head">
                  <span className="heartbeat-setup-number">{index + 1}</span>
                  <strong>{title}</strong>
                  {!stage.required && <span className="heartbeat-setup-optional">선택</span>}
                  <span className={`heartbeat-setup-mark mark-${stage.state}`}>
                    {stateLabels[stage.state]}
                  </span>
                </div>
                {note && <p className="integration-note">{note}</p>}
                {/* 복사에 실패해도 원문은 여기 남아 사용자가 직접 선택할 수 있다(R6). 복사 버튼이
                    원문을 대체하지 않는다. */}
                <pre><code>{stage.command}</code></pre>
                <div className="heartbeat-setup-copy">
                  {/* 실행이 아니라 복사다(R11). 확인 대화상자를 끼우지 않아 한 번의 조작으로 끝난다. */}
                  <button
                    aria-label={`${title} 명령 복사`}
                    className="secondary-button heartbeat-setup-copy-button"
                    onClick={() => void copyCommand(stage)}
                    type="button"
                  >
                    명령 복사
                  </button>
                  {result && (
                    <span
                      className={`heartbeat-setup-copied${result.ok ? "" : " copy-failed"}`}
                      role="status"
                    >
                      {result.ok
                        ? "복사됨"
                        : "복사하지 못했습니다 — 위 명령을 직접 선택해 복사하세요."}
                    </span>
                  )}
                </div>
                {stage.evidence && <p className="integration-note">판정 근거: {stage.evidence}</p>}
              </li>
            );
          })}
        </ol>

        {/* R7. 주기의 숫자는 적지 않는다. 그 값은 `useProjectWorkspace`가 소유하고 카드는 알지 못한다. */}
        <p className="integration-note">
          명령을 실행하고 앱으로 돌아오면 자동으로 다시 확인해 이 목록을 채웁니다. 따로 누를 것은 없습니다.
        </p>
        <p className="integration-note">공식 문서: https://github.com/wooson00308/claude-heartbeat</p>
      </div>
    </div>
  );
}

/**
 * 잡 하나의 실행 한도 사용량 줄. 마지막 실행 기록 줄과 나란히 놓인다(R1).
 *
 * 소진은 사실 표시일 뿐 경고가 아니다(R3). 대기 물량까지 있을 때의 경고는 잡 행이 따로 그린다.
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
  pendingWork,
  heartbeatRuns,
}: {
  snapshot: IntegrationsSnapshot;
  writeError: string | null;
  onInstall(roles: RoleJobRequest[], baseline: ManagedRoleJob[]): Promise<boolean>;
  pendingWork?: PendingRoleWork;
  heartbeatRuns: HeartbeatRunControls;
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
  // 지금 실행 확인 화면이 열린 역할. 재설정과 같은 이유로 한 번에 하나만 연다(R2).
  //
  // 진행 중 여부는 여기 없다. 그 값의 주인은 훅이고 카드는 `heartbeatRuns.running`을 읽기만 한다 —
  // 카드가 따로 들면 다른 메뉴를 다녀와 언마운트된 순간 갈라진다(R3).
  const [runConfirming, setRunConfirming] = useState<string | null>(null);
  // 실행 요청이 끝난 역할. 역할마다 따로 담는다 — 한 역할의 실행이 다른 역할의 안내를 지우지 않는다.
  // 진행 중 표시와 달리 이것은 조회 결과를 가리키는 보조 문구라 뷰를 떠나면 사라져도 된다. 가리키는
  // 값(마지막 실행 기록)은 스냅샷에 남아 있다.
  const [finishedRuns, setFinishedRuns] = useState<Record<string, boolean>>({});
  // 실패 표시의 명령을 복사한 결과. 어느 잡의 실패에 딸린 것인지 함께 들고 있는다 — 다른 잡의
  // 실패로 바뀌었을 때 앞의 결과가 그 자리에 남으면 안 된다(마법사의 단계별 복사 표시와 같은 idiom).
  const [runCopied, setRunCopied] = useState<{ jobName: string; ok: boolean } | null>(null);
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
    setRunConfirming(null);
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
        current: fileValue(before, field),
        next: fileValue(job, field) ?? missingValue,
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
        current: fileValue(job, field),
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
        current: fileValue(job, field),
        next: formValue(form[role], field),
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
        current: fileValue(job, field),
      })),
    }));

  function edit(role: string, field: EditableField, value: string) {
    setForm((previous) => ({ ...previous, [role]: { ...previous[role], [field]: value } }));
    setSpecified((previous) => ({ ...previous, [role]: { ...previous[role], [field]: true } }));
    setErrors((previous) => ({ ...previous, [role]: { ...previous[role], [field]: undefined } }));
    setConfirming(false);
    setRunConfirming(null);
  }

  /** 입력 방식 전환은 값 변경이 아니라 지정으로 치지 않는다. 직접 입력 칸에 적으면 edit이 받는다. */
  function switchModelInput(role: string, custom: boolean) {
    setCustomModel((previous) => ({ ...previous, [role]: custom }));
    setErrors((previous) => ({ ...previous, [role]: { ...previous[role], model: undefined } }));
    setConfirming(false);
    setRunConfirming(null);
  }

  /**
   * 한도의 선택 전환. 모델의 입력 방식 전환과 달리 **지정으로 친다.** 제한 없음을 고르는 것은 관리
   * 블록에서 한도 줄을 빼는 결정이라 그 자체가 파일에 쓰일 값이다.
   *
   * `maxPer` 문자열은 건드리지 않는다. 한도 지정으로 되돌렸을 때 칸이 비어 있으면 안 된다.
   */
  function switchMaxPer(role: string, unlimited: boolean) {
    setForm((previous) => ({ ...previous, [role]: { ...previous[role], maxPerUnlimited: unlimited } }));
    setSpecified((previous) => ({ ...previous, [role]: { ...previous[role], maxPer: true } }));
    setErrors((previous) => ({ ...previous, [role]: { ...previous[role], maxPer: undefined } }));
    setConfirming(false);
    setRunConfirming(null);
  }

  function toggle(role: string, enabled: boolean) {
    const installedJob = heartbeat.managedJobs.find((entry) => entry.role === role) ?? null;
    if (!enabled && installedJob) {
      // 끄는 잡의 파일 값을 기억해 둔다. 저장으로 블록에서 빠져도 다시 켤 때 이 값으로 돌아온다.
      browserJobValueMemoryStore.remember(jobNameOf(role), {
        interval: installedJob.interval ?? undefined,
        // 한도만 `null`을 그대로 넘긴다. `?? undefined`로 접으면 제한 없음이 "기억하지 못함"이 되어
        // 다시 켤 때 앱 기본값으로 시작한다 — 사용자가 정한 값이 사라지는 자리다.
        maxPer: installedJob.maxPer,
        model: installedJob.model ?? undefined,
        timeout: installedJob.timeout ?? undefined,
      });
    }
    if (enabled && !installedJob) {
      const recalled = browserJobValueMemoryStore.recall(jobNameOf(role));
      if (recalled) {
        // 한도는 따로 옮긴다. 통째로 펼치면 `maxPer` 칸에 `null`이 들어간다.
        const { maxPer, ...rest } = recalled;
        const unlimited = maxPer === null;
        setForm((previous) => ({
          ...previous,
          [role]: {
            ...previous[role],
            ...rest,
            ...(maxPer === undefined ? {} : { maxPerUnlimited: unlimited }),
            ...(typeof maxPer === "string" ? { maxPer } : {}),
            enabled,
          },
        }));
        // 기억한 값은 파일에 없으므로 지정 필드로 실어 보내야 저장에 반영된다.
        setSpecified((previous) => ({
          ...previous,
          [role]: {
            ...previous[role],
            ...Object.fromEntries(Object.keys(recalled).map((field) => [field, true])),
          },
        }));
        const model = recalled.model;
        if (model) {
          setCustomModel((previous) => ({ ...previous, [role]: !isSupportedModel(model) }));
        }
        setConfirming(false);
        setRunConfirming(null);
        return;
      }
    }
    setForm((previous) => ({ ...previous, [role]: { ...previous[role], enabled } }));
    setConfirming(false);
    setRunConfirming(null);
  }

  /**
   * 꺼진 역할의 값은 파일에 쓰이지 않으므로 검사하지 않는다.
   *
   * 제한 없음인 역할의 한도 칸도 검사하지 않는다. 검사할 값이 없다 — 그 상태는 파일에 줄을 쓰지
   * 않는 것이고, 칸에 남아 있는 문자열은 한도 지정으로 되돌렸을 때 쓸 값일 뿐이다.
   */
  function invalidFields() {
    const found: Record<string, Partial<Record<EditableField, string>>> = {};
    for (const role of enabledRoles) {
      for (const field of editableFields) {
        if (field === "maxPer") {
          if (form[role].maxPerUnlimited) continue;
          const message = maxPerFieldError(form[role].maxPer);
          if (message) found[role] = { ...found[role], maxPer: message };
          continue;
        }
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
    setRunConfirming(null);
  }

  /** 확인 화면은 한 번에 하나만 연다. 저장과 재설정은 쓰는 값이 다르다. */
  function requestReset(role: string) {
    setConfirming(false);
    setResetting(role);
    setRunConfirming(null);
  }

  /**
   * 지금 실행 확인 화면을 연다. 저장·재설정 확인 화면과 같은 자리를 쓰므로 그 둘을 닫는다 —
   * 셋이 겹쳐 뜨면 사용자가 어느 확인의 버튼을 누르는지 알 수 없다.
   */
  function requestRun(role: string) {
    setConfirming(false);
    setResetting(null);
    setRunConfirming(role);
  }

  /**
   * 확인 화면을 닫고 실행 통로를 부른다. 실행 대상은 스냅샷의 `jobName`이다 — 백엔드가 아는 이름으로
   * 나가야 하므로 화면의 표기용 `jobNameOf`를 쓰지 않는다.
   *
   * 진행 중 표시는 여기서 켜지 않는다. 그 값의 주인은 훅이다(R3). 실패 문구도 훅이 들고 있으므로
   * 지난 실패를 여기서 지우지 않는다 — 훅이 이 실행에 한해 비운다.
   */
  async function startRun(role: string, jobName: string) {
    setRunConfirming(null);
    // 지난 실행의 안내가 새 실행 위에 남으면 안 된다. 복사 결과도 그 실패에 딸린 것이라 함께 지운다.
    setFinishedRuns((previous) => ({ ...previous, [role]: false }));
    setRunCopied(null);
    // 참이 말하는 것은 실행 요청이 끝났다는 것뿐이다. 세션이 떴는지도 무엇으로 끝났는지도 앱은
    // 모른다(R4). 거짓이면 실행이 시작되지 못한 것이고, 실패 표시가 이 자리를 대신한다(R6).
    if (await heartbeatRuns.run(jobName)) {
      setFinishedRuns((previous) => ({ ...previous, [role]: true }));
    }
  }

  /**
   * 실패 표시의 명령을 복사한다. 백엔드가 준 `failure.command`를 그대로 넘긴다 — 화면이 문자열을
   * 다시 조립하면 붙여 넣은 명령이 화면에 보이는 것과 달라진다(R6). 마법사의 단계 복사와 같은 규칙이다.
   */
  async function copyRunCommand(failure: HeartbeatRunFailure) {
    setRunCopied({ jobName: failure.jobName, ok: await copy(failure.command) });
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
          current: fileValue(job, field),
          // 재설정이 되돌리는 값은 언제나 앱 기본값이고 기본값의 한도는 언제나 값이다(R1).
          next: defaults[field],
        })),
        appOwnedDrift: job.appOwnedDrift,
      },
    ];
  }

  /**
   * 재설정 요청. 대상 잡의 네 필드만 기본값을 명시하고 나머지 잡은 전부 미지정으로 둔다. 그래야
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
        // 재설정은 앱 기본값으로 되돌리는 것이고 앱 기본값은 언제나 한도 값이다.
        maxPer: reset ? { kind: "limit", value: defaults.maxPer } : null,
        model: reset ? defaults.model : null,
        timeout: reset ? defaults.timeout : null,
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
    // 지정하지 않았으면 `null`이고 파일 값이 이긴다. 지정했으면 선택이 두 값 중 하나를 정한다(R3).
    const quota = specified[role]?.maxPer
      ? form[role].maxPerUnlimited
        ? ({ kind: "unlimited" } as const)
        : ({ kind: "limit", value: form[role].maxPer } as const)
      : null;
    return {
      role,
      enabled: form[role].enabled,
      interval: pick("interval"),
      maxPer: quota,
      model: pick("model"),
      timeout: pick("timeout"),
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
          const status = heartbeat.roles.find((entry) => entry.role === role);
          const run = status?.lastRun ?? null;
          const quota: JobQuota = status?.quota ?? { kind: "unknown" };
          const label = roleLabels[role] ?? role;
          // 실행 대상 이름은 스냅샷이 준 값이다. 같은 줄에 보이는 `wf-{role}{slug}` 표기는 차이
          // 표시용이라 백엔드가 실제로 아는 이름과 다를 수 있고, 실행은 백엔드가 아는 이름으로 나가야 한다.
          const jobName = status?.jobName ?? null;
          // 진행 중 판정은 이름 대조다. 카드가 상태를 들지 않으므로 뷰를 다녀와도 표시가 그대로다(R3).
          const runningNow = jobName !== null && heartbeatRuns.running.includes(jobName);
          // 실패도 이름 대조다. 잡 이름에 프로젝트 slug가 들어 있어 다른 프로젝트·다른 역할의 실패가
          // 이 자리에 새지 않는다(R6).
          const runFailure =
            jobName !== null && heartbeatRuns.failure?.jobName === jobName
              ? heartbeatRuns.failure
              : null;
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
                  if (field === "maxPer") {
                    return (
                      <MaxPerField
                        fieldLabel={fieldLabels.maxPer}
                        id={id}
                        jobLabel={label}
                        key={field}
                        message={message}
                        onUnlimitedChange={(unlimited) => switchMaxPer(role, unlimited)}
                        onValueChange={(value) => edit(role, "maxPer", value)}
                        unlimited={form[role].maxPerUnlimited}
                        value={form[role].maxPer}
                      />
                    );
                  }
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
                <>
                  <div className="heartbeat-job-run">
                    <span className={`heartbeat-run-result result-${run.result ?? "unknown"}`}>{run.result ? runResultLabels[run.result] ?? run.result : "결과 기록 없음"}</span>
                    <span>{run.at ? `${run.at} (로컬 시각)` : "시각 기록 없음"}</span>
                    <span>{run.durationSeconds === null ? "소요 시간 기록 없음" : `${run.durationSeconds.toFixed(1)}초`}</span>
                  </div>
                  {/* `skipped`에만 붙인다. 실행 기록이 없는 잡에는 설명할 결과가 없고,
                      `quota_skipped` 옆에는 데몬이 이전 조건 검사의 사유를 지우지 않고 남겨 두므로
                      붙이면 낡은 문장이 이번 사유로 읽힌다(R3). */}
                  {run.result === "skipped" && <p className="integration-note">{skippedReason(run.conditionOutput) ?? skippedReasonNote}</p>}
                </>
              ) : (
                <p className="integration-note">실행 기록 없음</p>
              ))}

              {/* 사용량은 마지막 실행 기록을 대체하지 않고 나란히 놓인다(R1). 관리 블록에 없는
                  잡에는 그리지 않는다. */}
              {job && <JobQuotaLine quota={quota} />}

              {/* R4. 위 실행 기록 자리가 "기록 없음"이면서 잡이 파일에 있는 상태다. 미설치와 잡 파일
                  읽기 실패는 이 폼 자체가 그려지지 않는 상태라 여기서 다시 보지 않는다
                  (`installation`·`managedBlockFailure` 분기). 저장·재설정 버튼은 건드리지 않는다 —
                  확인 필요 3번은 "막지 않고 알린다"로 승인됐다. */}
              {missingRunEvidence(Boolean(job), run) && (
                <IntegrationWarning title={noRunEvidenceTitle}>
                  <p>{noRunEvidenceNote}</p>
                  {/* 위 문장이 "갱신하세요"로 끝나므로 그 방법이 같은 자리에 온다(SPEC-034 R1).
                      표시 조건을 새로 만들지 않는다 — 이 경고가 뜨는 조건이 곧 안내가 뜨는 조건이고,
                      그래서 상시 표시가 되지 않는다. */}
                  <HeartbeatUpdateGuide guide={snapshot.updateGuide} />
                </IntegrationWarning>
              )}

              {job && quota.kind === "counted" && quotaWarned(quota, role, pendingWork) && (
                <IntegrationWarning title={`${label} 잡이 대기 중인 일을 처리하지 못하고 있습니다`}>
                  <p>
                    {pendingLabels[role]} 남아 있는데 실행 한도({quota.used}/{quota.limit} ·{" "}
                    {quota.window} 기준)가 차서, 하트비트가 조건 검사 전에 이 잡을 건너뜁니다.
                  </p>
                  {quota.recoversAt && <p>{quotaRecoveryLabel(quota.recoversAt)}</p>}
                  <p>
                    더 기다리지 않으려면 이 잡의 {fieldLabels.maxPer} 칸에서 한도를 올리고 아래
                    저장 버튼을 누르세요.
                  </p>
                </IntegrationWarning>
              )}

              {/* 지금 실행. 실행 기록·사용량 줄 다음이고 재설정 버튼과 같은 층이다.

                  폼 상태를 읽지 않는다 — 저장하지 않은 편집이 있어도 실행 대상과 호출 인자가
                  달라지지 않는다. `daemonRunning`도 보지 않는다: 데몬이 도는 중에도 사용자가 지금
                  한 번 더 깨울 수 있어야 한다(R7).

                  관리 블록에 잡이 없는 역할에도 이 자리는 남는다. 액션을 숨기면 왜 실행할 수 없는지
                  말할 자리가 사라진다. */}
              <button
                className="secondary-button heartbeat-job-run-now"
                disabled={!job || jobName === null || runningNow}
                onClick={() => requestRun(role)}
                type="button"
              >
                {label} 잡 지금 실행
              </button>

              {!job && (
                <p className="integration-note">
                  이 역할의 잡이 관리 블록에 없어 지금 실행할 수 없습니다. 위에서 이 역할을 켜고 아래 저장 버튼으로 잡을 설치한 뒤에 실행할 수 있습니다.
                </p>
              )}

              {/* 실측에서 세션 하나가 206초였고 시간 초과는 20~30분이다. 이 표시가 없으면 사용자는
                  눌리지 않았다고 판단하고 다시 누른다. */}
              {runningNow && (
                <p className="heartbeat-run-now-progress" role="status">
                  {label} 잡을 실행하고 있습니다. 세션 하나가 수 분에서 수십 분 걸릴 수 있고, 끝나면 이 표시가 사라지며 버튼이 다시 눌립니다.
                </p>
              )}

              {/* 실행 요청이 끝났다는 것만 말한다. "성공했습니다"라고 적지 않는다 — 세션이 떴는지도
                  무엇으로 끝났는지도 앱은 모른다(R4). 건너뜀의 사유도 지어내지 않는다: 그 말은 결과
                  낱말 옆의 `skippedReasonNote`가 이미 하고 있고, 여기서 새 문장을 만들면 같은 사실을
                  두 가지 말로 부르게 된다(R5). */}
              {finishedRuns[role] && (
                <p className="heartbeat-run-done" role="status">
                  {label} 잡 실행 요청이 끝났습니다. 조건을 충족하지 못했거나 실행 한도가 차 있었다면 세션이 뜨지 않았을 수 있습니다. 무엇으로 끝났는지는 위의 마지막 실행 기록에 나옵니다.
                </p>
              )}

              {/* 앱이 실행을 시작하지 못한 것이다. 잡의 실행 결과가 아니므로 마지막 실행 기록은 이
                  실패 때문에 달라지지 않고, 설치 마법사의 단계 상태도 그대로다 — 앱은 실행 기록을
                  쓰지 않고 이 실패를 미설치 판정으로 번역하지도 않는다(R6). */}
              {runFailure && (
                <IntegrationWarning
                  title={`앱이 ${label} 잡 실행을 시작하지 못했습니다 — 하트비트는 이 실패를 모릅니다`}
                >
                  <p>{runFailure.message}</p>
                  {/* 복사에 실패해도 원문은 여기 남아 사용자가 직접 선택할 수 있다. 마법사가 같은
                      이유로 같은 모양을 쓴다. */}
                  <pre className="heartbeat-run-failure-command"><code>{runFailure.command}</code></pre>
                  <div className="heartbeat-run-failure-copy">
                    <button
                      aria-label={`${label} 잡 실행 명령 복사`}
                      className="secondary-button heartbeat-run-failure-copy-button"
                      onClick={() => void copyRunCommand(runFailure)}
                      type="button"
                    >
                      명령 복사
                    </button>
                    {runCopied?.jobName === runFailure.jobName && (
                      <span
                        className={`heartbeat-run-failure-copied${runCopied.ok ? "" : " copy-failed"}`}
                        role="status"
                      >
                        {runCopied.ok
                          ? "복사됨"
                          : "복사하지 못했습니다 — 위 명령을 직접 선택해 복사하세요."}
                      </span>
                    )}
                  </div>
                </IntegrationWarning>
              )}

              {runConfirming === role && jobName !== null && (
                <div
                  aria-label={`${label} 잡 지금 실행 확인`}
                  className="heartbeat-confirm"
                  role="group"
                >
                  {/* 같은 자리의 저장·재설정 확인 화면이 "확인 후 아래 두 파일을 씁니다"로 시작한다.
                      같은 모양의 화면을 사용자가 다른 일로 읽지 않도록 첫 줄에서 갈라 준다. */}
                  <strong>이 조작은 어떤 파일도 쓰지 않습니다</strong>
                  <ul>
                    <li>실행할 잡: {jobName}</li>
                    <li>이 잡의 모델 세션 하나를 지금 띄웁니다. 화면을 다시 읽는 조작이 아니고, 한 번 뜬 세션은 되돌릴 수 없습니다.</li>
                    <li>하트비트의 조건과 실행 한도는 그대로 적용됩니다. 조건을 충족하지 못하거나 한도가 차 있으면 세션이 뜨지 않고 끝날 수 있습니다.</li>
                  </ul>
                  <div className="heartbeat-confirm-actions">
                    {/* 누르면 이 화면이 닫히므로 같은 버튼을 두 번 눌러도 실행은 한 번이다. */}
                    <button
                      className="primary-button"
                      onClick={() => void startRun(role, jobName)}
                      type="button"
                    >
                      확인하고 지금 실행
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => setRunConfirming(null)}
                      type="button"
                    >
                      취소
                    </button>
                  </div>
                </div>
              )}

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
                        <li>{snapshot.jobsFilePath} — {jobsFileNote}</li>
                        <li>{heartbeat.conditionScriptPath} — 프로젝트 로컬 파일입니다. 조건 스크립트를 앱 버전으로 맞춥니다.</li>
                      </ul>
                      <p>이 잡의 편집 가능 값만 앱 기본값으로 되돌립니다. 잡의 활성·비활성 상태와 이 파일의 다른 잡은 그대로 둡니다. {otherProjectsNote}</p>
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
            <li>{snapshot.jobsFilePath} — {jobsFileNote}</li>
            <li>{heartbeat.conditionScriptPath} — 프로젝트 로컬 파일입니다. 조건 스크립트를 앱 버전으로 맞춥니다.</li>
          </ul>
          <p>이 파일 전체를 앱이 다시 씁니다. 손으로 덧붙인 줄은 남지 않습니다. {otherProjectsNote}</p>
          {enabledRoles.length === 0 && (
            <p>활성 역할이 없어 이 프로젝트의 잡 파일을 지웁니다. 조건 스크립트는 지우지 않습니다.</p>
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
