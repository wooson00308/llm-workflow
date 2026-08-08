import { useEffect, useId, useState } from "react";
import { MaxPerField, maxPerFieldError } from "../MaxPerField";
import { ModelField, isSupportedModel } from "../ModelField";
import type {
  AgentLeaseSummary,
  DuplicateIntegrationJob,
  HeartbeatIntegration,
  HeartbeatJobRun,
  HeartbeatRecordedJob,
  HeartbeatSetupStage,
  HeartbeatRunControls,
  HeartbeatRunFailure,
  HeartbeatServiceControlResult,
  HeartbeatServiceControls,
  HeartbeatServiceOperation,
  HeartbeatServiceOutcome,
  HeartbeatServiceTarget,
  HeartbeatSetupRunControls,
  HeartbeatSetupRunResult,
  HeartbeatSetupState,
  HeartbeatSetupStep,
  HeartbeatUpdateControls,
  HeartbeatVersionControls,
  HeartbeatVersionUndeterminedReason,
  HeartbeatVersions,
  HeartbeatUpdateGuide as UpdateGuide,
  HeartbeatUpdateResult,
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

/**
 * 실행 확인 화면이 알리는 "무엇이 만들어지는가"(SPEC-037 R3). 두 명령은 파일을 쓰므로 무엇이
 * 만들어지는지 알린 뒤 실행한다.
 *
 * **이 표가 버튼이 붙는 자리를 정하지 않는다.** 그 판정은 백엔드가 실은 `runnable` 하나이고, 여기
 * 있는 것은 이미 붙기로 정해진 단계의 문구뿐이다. 문구가 없는 단계도 확인 화면은 명령 원문과
 * 판정 근거 경로로 설 수 있다.
 */
const setupRunEffects: Partial<Record<HeartbeatSetupStep, string[]>> = {
  init: ["하트비트 홈에 설정과 상태 문서를 만듭니다."],
  service: ["서비스 등록물을 만듭니다.", "등록한 서비스로 데몬을 띄웁니다."],
};

/**
 * 설치 단계 실행의 종료 코드 한 줄. 숫자만 싣고 뜻을 붙이지 않는다 — 이 두 명령은 원인별 종료
 * 코드가 계약에 없고(`docs/heartbeat.md` 4·5번 절), 앱이 실패 사유를 지어내지 않는다.
 *
 * 업데이트의 `exitNote`와 나눠 두는 이유가 그것이다. 그쪽은 계약이 코드로 원인을 가르는 자리라
 * 문장을 붙이고, 이쪽은 붙일 계약이 없다.
 */
function setupExitNote(code: number | null): string {
  return code === null
    ? "하트비트가 종료 코드 없이 끝났습니다. 프로세스가 시그널로 끝난 경우입니다."
    : `종료 코드 ${code}.`;
}

/**
 * 버전 판정이 불가능한 사유(SPEC-037 확인 필요 2번). 넷이 서로 다른 문장이어야 한다 — 사용자가 할
 * 다음 행동이 서로 다르다.
 */
const undeterminedReasonNotes: Record<HeartbeatVersionUndeterminedReason, string> = {
  executableNotFound:
    "앱이 하트비트 실행 파일을 찾지 못해 디스크의 버전을 읽지 못했습니다.",
  executableNotStarted:
    "하트비트 실행 파일은 찾았지만 띄우지 못해 디스크의 버전을 읽지 못했습니다.",
  diskVersionOffContract:
    "하트비트가 낸 출력이 계약의 모양이 아니라 디스크의 버전을 읽지 못했습니다. 버전 표면을 모르는 옛 설치본일 수 있습니다.",
  runningVersionUnknown:
    "상태 파일에 도는 데몬의 버전이 없어 읽지 못했습니다. 데몬이 한 번도 뜬 적 없으면 이 항목이 없습니다.",
};

/**
 * 업데이트 결과의 단계 이름. 계약이 정한 셋뿐이고, 어휘 밖의 값은 받은 문자열을 그대로 보여준다 —
 * 새 단계가 늘면 앱이 그것을 감추는 쪽보다 날문자로라도 보이는 쪽이 낫다(SPEC-034 R2).
 */
const updateStepLabels: Record<string, string> = {
  repo: "저장소 갱신",
  deps: "의존성 설치",
  service: "데몬 재기동",
};

/** 단계 상태의 낱말. 셋이 서로 다른 낱말이어야 한다. 어휘 밖의 값은 그대로 보여준다. */
const updateStatusLabels: Record<string, string> = {
  ok: "완료",
  failed: "실패",
  skipped: "건너뜀",
};

/**
 * 결과 낱말 셋. `partial`이 성공으로도 실패로도 읽히지 않는다는 것이 이 표의 요점이다 — 그 상태의
 * 뜻은 "코드는 갱신됐는데 도는 프로세스는 갱신 전 코드일 수 있다"이고, 그것이 08-05 사고의 모양이다.
 */
const updateResultLabels: Record<string, string> = {
  ok: "갱신이 끝났습니다",
  partial: "코드는 갱신됐지만 뒤가 따라오지 못했습니다",
  failed: "갱신하지 못했습니다",
};

const partialNote =
  "성공도 실패도 아닌 상태입니다. 저장소의 코드는 새것인데 지금 도는 프로세스는 갱신 전 코드를 그대로 들고 있을 수 있습니다. 아래 단계와 사유를 보고 남은 걸음을 직접 끝내야 합니다.";

/**
 * 종료 코드별로 다음 행동이 다르다(R4). 계약(`docs/heartbeat.md`의 인용 절)이 코드로 원인을
 * 가르므로 그 갈림을 그대로 문장으로 옮긴다. 하나의 문구로 뭉뚱그리지 않는다.
 *
 * 10번대는 저장소, 20번대는 의존성, 30번대는 프로세스다. 그 자리수 안에서 번호가 느는 것은 계약이
 * 하위호환으로 허용한 변경이라, 이 표에 없는 코드에 뜻을 붙이지 않는다 — 아는 척하지 않는 쪽이
 * SPEC-034 R2가 세운 선이다.
 */
const exitGuidance: Record<number, string> = {
  0: "갱신과 재기동이 필요한 만큼 끝났습니다.",
  10: "이 설치본은 git 저장소가 아닙니다. pip으로 깔았다면 아래 갱신 안내의 pip 갈래로 갱신하세요. 하트비트가 소스 체크아웃을 갱신하는 명령이라 wheel 설치는 대상이 아닙니다.",
  11: "하트비트 저장소에 미커밋 변경이 있어 갱신하지 않았습니다. 그 저장소에서 변경을 커밋하거나 되돌린 뒤 다시 실행하세요.",
  12: "로컬 커밋이 갈라져 fast-forward할 수 없습니다. 하트비트 저장소에서 직접 병합하거나 브랜치를 정리한 뒤 다시 실행하세요.",
  13: "원격에서 가져오지 못했습니다. 네트워크와 원격 접근 권한을 확인한 뒤 다시 실행하세요.",
  14: "현재 브랜치에 upstream이 없어 무엇을 당길지 알 수 없습니다. 하트비트 저장소에서 upstream을 지정한 뒤 다시 실행하세요.",
  20: "코드는 갱신됐는데 의존성 설치가 실패했습니다. 하트비트 저장소에서 설치를 직접 끝내야 합니다.",
  30: "코드는 갱신됐는데 재기동 명령이 실패했습니다. 하트비트를 직접 재시작해야 갱신한 코드가 반영됩니다.",
  31: "코드는 갱신됐는데 데몬이 OS 스케줄러 밖에서 돌고 있어 앱이 재기동하지 못했습니다. 그 프로세스를 직접 재시작해야 합니다.",
  32: "데몬 자신의 프로세스 트리 안에서 불려 재기동하지 않았습니다.",
};

/** 종료 코드 한 줄. 숫자는 언제나 보이고, 모르는 코드에는 뜻을 붙이지 않는다. */
function exitNote(code: number | null): string {
  if (code === null) {
    return "하트비트가 종료 코드 없이 끝났습니다. 프로세스가 시그널로 끝난 경우입니다.";
  }
  const guidance = exitGuidance[code];
  return guidance
    ? `종료 코드 ${code} — ${guidance}`
    : `종료 코드 ${code} — 앱이 아는 코드가 아닙니다. 아래 원문에서 무엇이 있었는지 확인하세요.`;
}

/** 두 조작의 이름. 화면이 보내는 식별자와 짝이고, 문구는 이 한 자리에서만 적는다. */
const serviceOperationLabels: Record<HeartbeatServiceOperation, string> = {
  stop: "데몬 끄기",
  start: "데몬 켜기",
};

/** 대상이 확정되지 않은 넷. 스냅샷의 판정과 조작 결과가 같은 집합을 쓴다. */
type ServiceUnresolvedReason =
  | "notRegistered"
  | "ambiguous"
  | "unsupportedPlatform"
  | "unreadable";

/** 사유 하나를 그리는 데 필요한 값 전부. 담을 것이 없는 사유는 두 자리가 비어 있다. */
interface ServiceUnresolvedView {
  reason: ServiceUnresolvedReason;
  /** 대상 모호에서 찾은 등록물 경로. 나머지 셋은 빈 목록이다. */
  plistPaths: string[];
  /** 읽지 못한 경로. 나머지 셋은 null이다. */
  path: string | null;
}

/**
 * 넷의 문구(R5). 사유마다 사용자가 할 다음 행동이 다르므로 하나의 실패 문구로 뭉뚱그리지 않는다.
 *
 * 스냅샷의 판정과 조작 결과가 같은 사유를 다르게 말하지 않도록 문구가 이 한 자리에 있다. 백엔드가
 * 두 값의 갈래를 이미 나눠 두었고, 화면은 그 갈래를 문장으로 옮기기만 한다.
 */
const serviceUnresolvedNotes: Record<
  ServiceUnresolvedReason,
  { title: string; note: string }
> = {
  notRegistered: {
    title: "이 기기에 등록된 하트비트 서비스가 없습니다",
    note: "등록물 디렉터리는 읽었는데 하트비트 등록물이 없습니다. 데몬이 OS 스케줄러 밖에서 손으로 떠 있거나 아예 없는 상태입니다. 등록을 만드는 자리는 위 설치 마법사의 서비스 등록 단계입니다.",
  },
  ambiguous: {
    title: "등록물이 여럿이라 앱이 대상을 고르지 않습니다",
    note: "앱이 하나를 골라 내리면 엉뚱한 서비스가 내려가고 데몬은 계속 도는데 화면은 껐다고 말하게 됩니다. 그 어긋남을 앱이 확인할 수단이 없어 고르지 않습니다. 아래 등록물을 정리해 하나만 남겨야 합니다.",
  },
  unsupportedPlatform: {
    title: "이 플랫폼에서는 앱이 데몬을 끄고 켤 수 없습니다",
    note: "앱이 확인한 정지·기동 절차는 macOS(launchd)뿐입니다. 확인하지 않은 명령을 대신 싣지 않습니다.",
  },
  unreadable: {
    title: "등록물을 읽지 못해 대상을 확정하지 못했습니다",
    note: "등록물 디렉터리를 열지 못했거나, 등록물은 하나인데 그 안의 서비스 이름을 읽지 못했습니다. 읽지 못한 것을 없는 것으로 읽지 않습니다.",
  },
};

/** 스냅샷의 판정을 사유로 옮긴다. 확정된 대상이면 사유가 없다. */
function unresolvedFromTarget(target: HeartbeatServiceTarget): ServiceUnresolvedView | null {
  switch (target.kind) {
    case "resolved":
      return null;
    case "not_registered":
      return { reason: "notRegistered", plistPaths: [], path: null };
    case "ambiguous":
      return { reason: "ambiguous", plistPaths: target.plist_paths, path: null };
    case "unsupported_platform":
      return { reason: "unsupportedPlatform", plistPaths: [], path: null };
    case "unreadable":
      return { reason: "unreadable", plistPaths: [], path: target.path };
  }
}

/**
 * 조작 결과의 앞 넷을 같은 사유로 옮긴다.
 *
 * 버튼이 확정된 대상에서만 나가므로 정상 경로에서는 나오지 않는다. 누르는 사이에 스냅샷이 바뀌면
 * 도착할 수 있고, 그때도 사용자가 읽을 문장은 같아야 한다.
 */
function unresolvedFromResult(
  result: HeartbeatServiceControlResult,
): ServiceUnresolvedView | null {
  switch (result.kind) {
    case "notRegistered":
      return { reason: "notRegistered", plistPaths: [], path: null };
    case "ambiguous":
      return { reason: "ambiguous", plistPaths: result.plistPaths, path: null };
    case "unsupportedPlatform":
      return { reason: "unsupportedPlatform", plistPaths: [], path: null };
    case "unreadable":
      return { reason: "unreadable", plistPaths: [], path: result.path };
    default:
      return null;
  }
}

/**
 * 종료 코드 한 줄. 숫자는 언제나 보이고 뜻은 붙지 않는다(R7).
 *
 * `bootout`의 "No such process"와 `bootstrap`의 "already loaded"는 launchctl이 stderr로 말하는
 * 것이고, 앱이 그 문장을 자기 어휘로 옮기면 옮긴 만큼이 지어낸 것이 된다. 업데이트 쪽이 코드를
 * 뜻으로 옮기는 것은 그쪽 계약이 코드로 원인을 갈라 두었기 때문이며, 여기에는 그 계약이 없다.
 */
function serviceExitNote(code: number | null): string {
  if (code === null) {
    return "launchctl이 종료 코드 없이 끝났습니다. 프로세스가 시그널로 끝난 경우입니다.";
  }
  if (code === 0) return "종료 코드 0.";
  return `종료 코드 ${code} — 앱은 이 숫자의 뜻을 옮기지 않습니다. 사유는 아래 원문에 있습니다.`;
}

/**
 * 명령이 끝난 것과 데몬이 그 상태가 된 것은 다른 사실이다(R7).
 *
 * 앱의 실행 여부 판정은 pid 파일 존재 하나이고 조회 주기를 타고 늦게 따라온다. 그래서 "꺼짐"과
 * "실행 중"이 한 화면에 함께 서지 않도록, 아직 따라오지 않은 순간을 그 순간 그대로 말한다.
 */
function serviceStateNote(
  operation: HeartbeatServiceOperation,
  daemonRunning: boolean,
): string {
  const settled =
    "앱이 보는 데몬 상태가 이 조작의 방향과 같아졌습니다. 판정 근거는 pid 파일의 존재 하나입니다.";
  const waiting =
    "명령은 끝났고 앱이 보는 데몬 상태는 아직 바뀌지 않았습니다. 상태 갱신을 기다리는 중입니다.";
  return (operation === "stop") === daemonRunning ? waiting : settled;
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
  activeLeases,
  heartbeatUpdate,
  heartbeatSetupRuns,
  heartbeatVersions,
  heartbeatService,
}: IntegrationCardProps) {
  const heartbeat = snapshot?.heartbeat ?? null;

  // 꺼 놓은 것을 잊게 두지 않는 판정(R6). 미설치는 데몬이 멈춘 것과 다른 상태이고 마법사가 이미
  // 말하므로 여기서 다시 말하지 않는다.
  const daemonStopped =
    heartbeat !== null &&
    heartbeat.installation !== "not_installed" &&
    !heartbeat.daemonRunning;

  // 버전 조회를 부를 자리. 설치본이 없는 기기에서는 두 값이 모두 "확인 불가"일 뿐이라 새 사실이
  // 없고, 그 상태는 마법사가 이미 말한다. 프로세스를 하나 띄우는 조작이므로 부를 이유가 없는
  // 자리에서는 부르지 않는다.
  const versionsShown = heartbeat !== null && heartbeat.installation !== "not_installed";
  const checkVersions = heartbeatVersions?.check;

  // 펼쳐지는 순간 한 번 부른다. **조회 주기는 이 자리를 지나지 않는다** — 주기가 새 스냅샷을 넣어
  // 다시 렌더돼도 의존값이 그대로라 효과가 다시 돌지 않고, 통로 자신이 겹쳐 부르기를 막는다.
  useEffect(() => {
    if (!expanded || !versionsShown || !checkVersions) return;
    void checkVersions();
  }, [checkVersions, expanded, versionsShown]);

  // 갱신 안내가 펼쳐진 주 통로가 되는 조건. 직전 업데이트가 "실행 수단 없음"으로 끝났는가 하나다.
  // 앱은 사전 탐색으로 실행 가능 여부를 판정하지 않는다 — 조회 주기에 프로세스를 띄우지 않는다는
  // 이 저장소의 선을 지키기 위해서다. 그래서 이 판정에 쓸 다른 값이 없다.
  const updateUnavailable = heartbeatUpdate?.result?.kind === "notRun";

  // 잡 폼이 그려지는 조건. 미설치와 잡 파일 읽기 실패에서는 아래 두 분기가 폼 자체를 그리지 않으므로
  // 접힘 요약도 그 상태에서는 조용해야 한다. 요약이 본문에 없는 경고를 알리면 사용자는 카드를 펼쳐
  // 놓고 무엇을 봐야 하는지 알 수 없다.
  const jobsShown =
    heartbeat !== null &&
    heartbeat.installation !== "not_installed" &&
    !snapshot?.managedBlockFailure;

  // 골격에 값을 넘기는 것은 카드다. 재료가 모두 이 자리에 있어 상태를 끌어올릴 필요가 없다.
  //
  // 데몬이 멈춘 사실도 여기 실린다(R6). 084가 세운 본문 경고 통로를 그대로 쓰고 접힘·펼침의 동작에
  // 새 규칙을 만들지 않는다는 것이 그 뜻이라, 접힌 카드에서도 이 사실이 드러난다.
  const bodyWarning =
    daemonStopped ||
    roleOrder.some((role) => {
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
          <HeartbeatSetupWizard heartbeat={heartbeat} setupRuns={heartbeatSetupRuns} />

          {heartbeat.installation !== "not_installed" && (
            <>
              {/* 꺼 놓은 것을 잊게 두지 않는다(R6). 사용자가 끄는 이유는 잠깐 멈추기 위해서이고,
                  끈 채로 잊으면 루프 전체가 조용히 서는데 그 상태는 화면에서 "아무 일도 일어나지
                  않음"과 구별되지 않는다. 문구가 원인을 단정하지 않는 것은 판정이 셋을 구분하지
                  못하기 때문이다 — `noRunEvidenceNote`가 같은 어법을 이미 쓴다. */}
              {daemonStopped && (
                <IntegrationWarning title="하트비트 데몬이 멈춰 있습니다">
                  <p>
                    데몬이 멈춰 있는 동안에는 이 기기의 어떤 잡도 깨어나지 않습니다. 잠깐 멈추려고
                    끈 것을 잊으면 루프 전체가 조용히 섭니다.
                  </p>
                  <p>
                    앱이 본 것은 ~/.claude/heartbeat/heartbeat.pid가 없다는 사실 하나입니다.
                    사용자가 껐을 수도, 설치가 아직 끝나지 않았을 수도, 데몬이 정리 없이 죽었을
                    수도 있으며 앱은 셋을 구분하지 못합니다. 앱이 대신 다시 켜지도 않습니다.
                  </p>
                </IntegrationWarning>
              )}

              {/* 버전은 카드 머리의 사실이다. 어긋남을 아는 자리와 그것을 푸는 버튼이 붙어 있어야
                  사용자가 다음 행동을 찾는다(SPEC-037 확인 필요 2번). */}
              {heartbeatVersions && <HeartbeatVersionLine versions={heartbeatVersions} />}

              {/* 업데이트는 역할별 조작이 아니라 설치 전체의 일이다. 그래서 역할 잡 폼 안이 아니라
                  마법사 아래·잡 목록 위의 공통 자리에 선다. 관리 블록을 읽지 못한 상태에서도
                  남는다 — 잡을 읽는 것과 설치본을 갱신하는 것은 서로를 막지 않는다(R9). */}
              {heartbeatUpdate && (
                <HeartbeatUpdateSection
                  activeLeases={activeLeases ?? []}
                  update={heartbeatUpdate}
                />
              )}

              {/* 끄기·켜기도 역할별 조작이 아니라 데몬 전체의 일이다. 그래서 역할 잡 폼 안이 아니라
                  업데이트 통로 옆의 공통 자리에 선다. dream 카드에는 이 통로를 만들지 않는다 —
                  데몬은 하나이고 조작 자리도 하나다.

                  판정이 아직 도착하지 않았으면 통로를 세우지 않는다. 대상을 모르는 채로 버튼을
                  내미는 것이 R4가 막는 일이다. */}
              {heartbeatService && heartbeat.serviceTarget && (
                <HeartbeatServiceSection
                  activeLeases={activeLeases ?? []}
                  daemonRunning={heartbeat.daemonRunning}
                  recordedJobs={heartbeat.recordedJobs ?? []}
                  service={heartbeatService}
                  target={heartbeat.serviceTarget}
                />
              )}

              {snapshot.managedBlockFailure ? (
                <UnreadableManagedBlock failure={snapshot.managedBlockFailure} />
              ) : (
                <HeartbeatRoleJobs
                  guideExpanded={updateUnavailable}
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
 *
 * 실행 버튼이 붙는 단계는 백엔드가 정한다(SPEC-037 R2). SPEC-016 R11은 "실행은 사용자 터미널의
 * 몫"이었고 그 선을 승인된 새 결정(DECISION-6C2F2639)이 두 단계에 한해 옮겼다. 화면은 단계 종류를
 * 보고 스스로 갈리지 않는다 — 갈림이 둘로 늘면 백엔드와 화면이 다른 답을 낼 자리가 생긴다.
 */
function HeartbeatSetupWizard({
  heartbeat,
  setupRuns,
}: {
  heartbeat: HeartbeatIntegration;
  setupRuns?: HeartbeatSetupRunControls;
}) {
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
        {/* 실행 버튼이 없는 단계가 남아 있다는 사실을 문장이 감추지 않는다(R2). 버튼이 하나도 붙지
            않은 화면에서도 이 문장은 그대로 참이다. */}
        <p className="integration-note">
          앱은 실행 버튼이 있는 단계만 대신 실행합니다. 나머지 단계는 사용자가 자기 터미널에서 직접
          실행합니다.
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
                {/* 실행 통로는 복사 통로를 대체하지 않는다. 실행이 실패한 자리에서 사용자가 손으로
                    끝낼 수 있어야 하므로 위의 원문과 복사 버튼은 실행형 단계에도 그대로 남는다. */}
                {setupRuns && stage.runnable && (
                  <SetupStepRun controls={setupRuns} stage={stage} title={title} />
                )}
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
 * 단계 하나의 실행 통로(SPEC-037 R2). 이 컴포넌트가 그려지는 조건은 백엔드가 실은 `runnable`
 * 하나이고, 여기서 단계 종류를 다시 보지 않는다.
 *
 * 진행 중 여부와 결과의 주인은 훅이다. 카드가 따로 들면 다른 메뉴를 다녀와 언마운트된 순간
 * 갈라진다 — 업데이트 통로가 같은 이유로 같은 모양을 쓴다. 여기 있는 상태는 확인 화면의 열림과
 * 복사 결과뿐이다.
 */
function SetupStepRun({
  controls,
  stage,
  title,
}: {
  controls: HeartbeatSetupRunControls;
  stage: HeartbeatSetupStage;
  title: string;
}) {
  const [confirming, setConfirming] = useState(false);
  // 실행 수단을 찾지 못했을 때 내미는 명령의 복사 결과. 실행마다 새로 시작한다.
  const [copied, setCopied] = useState<boolean | null>(null);

  // 단계마다 따로 담기므로 한 단계의 실행이 다른 단계의 버튼을 잠그지 않는다.
  const running = controls.running.includes(stage.step);
  const result = controls.results[stage.step] ?? null;

  /**
   * 확인 화면을 닫고 실행 통로를 부른다. 누르면 화면이 닫히므로 같은 버튼을 두 번 눌러도 실행은
   * 한 번이다. 겹쳐 누르기를 막는 두 번째 선은 훅에 있다.
   */
  async function start() {
    setConfirming(false);
    setCopied(null);
    // payload의 명령을 그대로 넘긴다. 훅은 이 값을 커맨드가 답하지 못했을 때의 폴백으로만 쓴다.
    await controls.run(stage.step, stage.command);
  }

  return (
    <div className="heartbeat-setup-run">
      <div className="heartbeat-setup-run-head">
        {/* 실행 중에는 눌리지 않는다. 표시가 없으면 사용자는 눌리지 않았다고 판단하고 다시 누른다. */}
        <button
          aria-label={`${title} 실행`}
          className="secondary-button heartbeat-setup-run-button"
          disabled={running}
          onClick={() => setConfirming(true)}
          type="button"
        >
          앱이 실행
        </button>
        {running && (
          <span className="heartbeat-setup-run-progress" role="status">
            실행하고 있습니다. 끝나면 이 표시가 사라지고 단계 상태를 다시 확인합니다.
          </span>
        )}
      </div>

      {confirming && (
        <SetupRunConfirm
          onCancel={() => setConfirming(false)}
          onConfirm={() => void start()}
          stage={stage}
          title={title}
        />
      )}

      {result && (
        <SetupRunResultView
          copied={copied}
          onCopy={async (command) => setCopied(await copy(command))}
          result={result}
          title={title}
        />
      )}
    </div>
  );
}

/**
 * 실행 전 확인 화면(SPEC-037 R3). 두 명령은 파일을 쓰므로 무엇이 만들어지는지 알린 뒤 실행한다.
 *
 * 파일을 쓰는 것은 데몬이고 앱이 아니다. 그 구분이 이 화면의 문구이며, 같은 자리의 "지금 실행"
 * 확인 화면("이 조작은 어떤 파일도 쓰지 않습니다")과 갈리는 지점이기도 하다.
 */
function SetupRunConfirm({
  onCancel,
  onConfirm,
  stage,
  title,
}: {
  onCancel(): void;
  onConfirm(): void;
  stage: HeartbeatSetupStage;
  title: string;
}) {
  const effects = setupRunEffects[stage.step] ?? [];

  return (
    <div
      aria-label={`${title} 실행 확인`}
      className="heartbeat-confirm heartbeat-setup-confirm"
      role="group"
    >
      <strong>확인 후 앱이 이 단계를 대신 실행합니다</strong>
      <p>앱이 실행하는 명령입니다.</p>
      <pre>
        <code>{stage.command}</code>
      </pre>
      {effects.length > 0 && (
        <ul>
          {effects.map((effect) => (
            <li key={effect}>{effect}</li>
          ))}
        </ul>
      )}
      {/* 판정 근거 경로가 곧 만들어지는 자리다. 앱이 경로를 지어내지 않고 payload의 값을 그대로 쓴다. */}
      {stage.evidence && <p>만들어지는 자리: {stage.evidence}</p>}
      <p>파일을 만드는 것은 하트비트입니다. 앱은 이 경로에서 어떤 파일도 쓰지 않습니다.</p>

      <div className="heartbeat-confirm-actions">
        <button className="primary-button" onClick={onConfirm} type="button">
          확인하고 실행
        </button>
        <button className="secondary-button" onClick={onCancel} type="button">
          취소
        </button>
      </div>
    </div>
  );
}

/**
 * 단계 실행의 결과(SPEC-037 R2·R5). 셋을 서로 다른 값으로 그린다.
 *
 * **앱이 실패 사유를 지어내지 않는다.** 이 두 명령은 원인별 종료 코드가 계약에 없으므로 화면의
 * 몫은 성공/실패와 종료 코드, 그리고 원문까지다. 업데이트 결과가 종료 코드마다 다음 행동을 적는
 * 것과 갈리는 지점이고, 그 갈림의 근거는 계약에 그 목록이 있느냐 없느냐다.
 */
function SetupRunResultView({
  copied,
  onCopy,
  result,
  title,
}: {
  copied: boolean | null;
  onCopy(command: string): void;
  result: HeartbeatSetupRunResult;
  title: string;
}) {
  if (result.kind === "notRun") {
    return (
      <IntegrationWarning title={`앱이 ${title} 단계를 실행하지 못했습니다`}>
        <p>{result.message}</p>
        {/* 앱이 찾은 척하는 경로를 지어내지 않는다(R5). 본 것이 없으면 목록 자체가 없다. */}
        {result.looked.length > 0 && (
          <>
            <p>앱이 실행 파일을 찾아본 경로입니다.</p>
            <ul>
              {result.looked.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          </>
        )}
        <p>위 단계의 명령을 터미널에서 직접 실행하면 같은 걸음을 끝낼 수 있습니다.</p>
        {/* 복사에 실패해도 원문은 단계 안에 남아 사용자가 직접 선택할 수 있다. */}
        <div className="heartbeat-setup-run-copy">
          <button
            aria-label={`${title} 실행 실패 명령 복사`}
            className="secondary-button"
            onClick={() => onCopy(result.command)}
            type="button"
          >
            명령 복사
          </button>
          {copied !== null && (
            <span
              className={`heartbeat-setup-copied${copied ? "" : " copy-failed"}`}
              role="status"
            >
              {copied ? "복사됨" : "복사하지 못했습니다 — 위 명령을 직접 선택해 복사하세요."}
            </span>
          )}
        </div>
      </IntegrationWarning>
    );
  }

  if (result.kind === "notRunnable") {
    return (
      <IntegrationWarning title={`앱이 대신 실행하지 않는 단계입니다`}>
        <p>{result.message}</p>
      </IntegrationWarning>
    );
  }

  return (
    <div
      aria-label={`${title} 실행 결과`}
      className={`heartbeat-setup-run-result result-${result.succeeded ? "ok" : "failed"}`}
      role="group"
    >
      <strong>{result.succeeded ? "명령이 끝났습니다" : "명령이 실패했습니다"}</strong>
      <p>{setupExitNote(result.code)}</p>
      {!result.succeeded && (
        <p>
          앱은 이 명령의 종료 코드를 사유로 옮기지 않습니다. 무엇이 있었는지는 아래 원문에
          있습니다.
        </p>
      )}
      <UpdateOutput stderr={result.stderr} stdout={result.stdout} />
    </div>
  );
}

/**
 * 도는 데몬과 디스크의 버전(SPEC-037 확인 필요 2번). 판정은 백엔드가 이미 했고 여기서는 그 값을
 * 문장으로 옮기기만 한다.
 *
 * **한쪽만 아는 상태를 "같다"로도 "다르다"로도 접지 않는다.** 아는 값만 싣고 사유를 함께 싣는다.
 * 084 경고의 판정은 이 표시가 대체하지도 감추지도 않는다 — 그 자리는 SPEC-024 R4가 정했다.
 */
function HeartbeatVersionLine({ versions }: { versions: HeartbeatVersionControls }) {
  const { checking, error, versions: read } = versions;

  if (error) {
    return (
      <IntegrationWarning title="하트비트 버전을 조회하지 못했습니다">
        <p>{error}</p>
      </IntegrationWarning>
    );
  }

  // 첫 조회가 끝나기 전에는 자리만 알린다. 이미 읽은 값이 있으면 그 값을 지우지 않고 그대로 둔다.
  if (!read) {
    return checking ? (
      <p className="integration-note" role="status">
        하트비트 버전을 확인하고 있습니다.
      </p>
    ) : null;
  }

  return (
    <div aria-label="하트비트 버전" className="heartbeat-versions" role="group">
      <dl className="heartbeat-version-values">
        <div>
          <dt>도는 데몬</dt>
          <dd>{read.running.kind === "known" ? read.running.version : "확인 불가"}</dd>
        </div>
        <div>
          <dt>디스크</dt>
          <dd>{read.disk.kind === "known" ? read.disk.version : "확인 불가"}</dd>
        </div>
      </dl>
      <HeartbeatVersionVerdictLine versions={read} />
    </div>
  );
}

/** 판정 한 줄. 셋이 서로 다른 문장이고, 판정 불가는 사유마다 다시 갈린다. */
function HeartbeatVersionVerdictLine({ versions }: { versions: HeartbeatVersions }) {
  const { disk, verdict } = versions;

  if (verdict.kind === "match") {
    return <p className="integration-note">도는 데몬과 디스크가 같은 버전입니다.</p>;
  }

  if (verdict.kind === "mismatch") {
    return (
      <p className="heartbeat-version-mismatch">
        도는 데몬과 디스크의 버전이 다릅니다. 코드는 갱신됐는데 지금 도는 프로세스는 옛 코드입니다.
        위의 하트비트 업데이트가 그 상태를 푸는 다음 행동입니다.
      </p>
    );
  }

  return (
    <div className="heartbeat-version-undetermined">
      <p>어긋났는지 판정하지 못했습니다. 아는 값만 위에 있습니다.</p>
      <ul>
        {verdict.reasons.map((reason) => (
          <li key={reason}>{undeterminedReasonNotes[reason]}</li>
        ))}
      </ul>
      {/* 앱이 찾은 척하는 경로를 지어내지 않는다(R5). 본 것이 있을 때만 목록이 있다. */}
      {disk.kind === "notFound" && disk.looked.length > 0 && (
        <>
          <p>앱이 실행 파일을 찾아본 경로입니다.</p>
          <ul>
            {disk.looked.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </>
      )}
      {/* 계약 밖 출력은 원문이 유일한 단서다. 앱이 그 안에서 버전을 잘라 내지 않는다. */}
      {disk.kind === "offContract" && (
        <UpdateOutput stderr={disk.stderr} stdout={disk.stdout} />
      )}
    </div>
  );
}

/**
 * 업데이트 통로(SPEC-037 R1·R3·R4·R5). 버튼 하나로 `heartbeat update`가 실행되고, 성공 경로에서
 * 사용자가 터미널을 열지 않는다.
 *
 * 진행 중 여부와 결과의 주인은 훅이다. 카드가 따로 들면 다른 메뉴를 다녀와 언마운트된 순간
 * 갈라진다 — "지금 실행"이 같은 이유로 같은 모양을 쓴다. 여기 있는 상태는 확인 화면의 열림과
 * 복사 결과뿐이고, 둘 다 이 화면을 떠나면 사라져도 되는 표시다.
 *
 * 앱은 갱신 절차의 갈래를 스스로 고르지 않는다. 저장소 갱신·의존성 반영·재기동의 순서와 실패
 * 처리는 데몬이 소유하고, 앱은 명령 하나를 부르고 그 답을 문장으로 옮긴다.
 */
function HeartbeatUpdateSection({
  activeLeases,
  update,
}: {
  activeLeases: AgentLeaseSummary[];
  update: HeartbeatUpdateControls;
}) {
  const [confirming, setConfirming] = useState(false);
  // 실행 수단을 찾지 못했을 때 내미는 명령의 복사 결과. 실행마다 새로 시작한다.
  const [copied, setCopied] = useState<boolean | null>(null);

  /**
   * 확인 화면을 닫고 실행 통로를 부른다. 누르면 화면이 닫히므로 같은 버튼을 두 번 눌러도 실행은
   * 한 번이다. 겹쳐 누르기를 막는 두 번째 선은 훅에 있다.
   *
   * 진행 표시도 결과도 여기서 만들지 않는다. 그 값의 주인은 훅이다.
   */
  async function start() {
    setConfirming(false);
    setCopied(null);
    await update.update();
  }

  return (
    <div className="heartbeat-update">
      <div className="heartbeat-update-head">
        <strong>하트비트 업데이트</strong>
        {/* 실행 중에는 눌리지 않는다. 저장소를 가져오고 의존성을 다시 까는 조작이라 표시가 없으면
            사용자는 눌리지 않았다고 판단하고 다시 누른다(R1). */}
        <button
          className="secondary-button heartbeat-update-run"
          disabled={update.running}
          onClick={() => setConfirming(true)}
          type="button"
        >
          하트비트 업데이트
        </button>
      </div>
      <p className="integration-note">
        앱이 하트비트를 대신 갱신합니다. 저장소 갱신·의존성 재설치·데몬 재기동은 하트비트가 한 명령
        안에서 수행하고, 앱은 그 결과를 읽어 옮깁니다.
      </p>

      {update.running && (
        <p className="heartbeat-update-progress" role="status">
          하트비트를 갱신하고 있습니다. 저장소를 가져오고 의존성을 다시 까는 동안 몇 분이 걸릴 수
          있고, 끝나면 이 표시가 사라지며 버튼이 다시 눌립니다.
        </p>
      )}

      {confirming && (
        <UpdateConfirm
          activeLeases={activeLeases}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void start()}
        />
      )}

      {update.result && (
        <UpdateResultView
          copied={copied}
          onCopy={async (command) => setCopied(await copy(command))}
          result={update.result}
        />
      )}
    </div>
  );
}

/**
 * 실행 전 확인 화면(R3). 버튼은 누르는 즉시 실행하지 않는다.
 *
 * 같은 자리의 "지금 실행" 확인 화면이 "이 조작은 어떤 파일도 쓰지 않습니다"로 시작한다. 이쪽은
 * 정반대의 일이라 첫 줄에서 갈라 준다.
 *
 * 앱은 세션을 정리하지 않는다. 드레이닝을 기다리지도, lease를 지우지도 않는다 — 남의 lease에
 * 손대는 것은 `.workflow/rules/workflow.md` §4가 금한다. 고지하고 사용자가 고른다.
 */
function UpdateConfirm({
  activeLeases,
  onCancel,
  onConfirm,
}: {
  activeLeases: AgentLeaseSummary[];
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <div aria-label="하트비트 업데이트 확인" className="heartbeat-confirm" role="group">
      <strong>확인 후 하트비트가 자기 저장소를 갱신하고 자신을 재기동합니다</strong>
      <ul>
        <li>하트비트 저장소를 원격의 최신 커밋으로 갱신합니다.</li>
        <li>코드가 바뀌면 의존성을 다시 설치합니다.</li>
        <li>갱신이 필요하면 데몬을 재기동합니다.</li>
      </ul>

      {/* 세션이 없을 때와 있을 때의 문구가 다르다. 고지만 하면 사용자가 확인 버튼을 습관적으로
          누르게 되므로, 무게 차이를 문구가 감당한다(기획서 확인 필요 3번의 한계). */}
      {activeLeases.length === 0 ? (
        <p>지금 끊길 세션이 없습니다. 이 프로젝트에 활성 lease가 하나도 없습니다.</p>
      ) : (
        <>
          <p>
            지금 끊기는 세션 {activeLeases.length}개 — 재기동은 돌고 있는 세션을 끊습니다. 앱은 그
            세션을 정리하지 않고 lease에도 손대지 않으므로, 끊긴 세션의 작업은 남은 lease가 만료될
            때까지 그대로 멈춰 있습니다.
          </p>
          <ul>
            {activeLeases.map((lease) => (
              <li key={lease.leaseId}>
                {lease.agent} · {lease.taskId ?? "워크플로우 작업"}
              </li>
            ))}
          </ul>
        </>
      )}

      <p>되돌릴 수 없습니다. 앱에는 갱신한 코드를 되돌려 놓는 수단이 없습니다.</p>

      <div className="heartbeat-confirm-actions">
        <button className="primary-button" onClick={onConfirm} type="button">
          확인하고 업데이트
        </button>
        <button className="secondary-button" onClick={onCancel} type="button">
          취소
        </button>
      </div>
    </div>
  );
}

/**
 * 업데이트 결과(R4·R5·R7). "성공/실패" 두 마디가 아니라 어디까지 갔는지와 왜 멈췄는지가 남는다.
 *
 * 셋을 서로 다른 값으로 그린다 — 계약대로 답한 결과, 계약 밖 출력, 실행 자체의 실패. 판정은
 * 백엔드가 이미 했고 여기서는 그 값을 문장으로 옮기기만 한다.
 */
function UpdateResultView({
  result,
  copied,
  onCopy,
}: {
  result: HeartbeatUpdateResult;
  copied: boolean | null;
  onCopy(command: string): void;
}) {
  if (result.kind === "notRun") {
    return (
      <IntegrationWarning title="앱이 하트비트 업데이트를 실행하지 못했습니다">
        <p>{result.message}</p>
        {/* 앱이 찾은 척하는 경로를 지어내지 않는다(R5). 본 것이 없으면 목록 자체가 없다. */}
        {result.looked.length > 0 && (
          <>
            <p>앱이 실행 파일을 찾아본 경로입니다.</p>
            <ul>
              {result.looked.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          </>
        )}
        <p>아래 명령을 터미널에서 직접 실행하면 같은 갱신을 끝낼 수 있습니다.</p>
        {/* 복사에 실패해도 원문은 여기 남아 사용자가 직접 선택할 수 있다. 마법사와 실행 실패
            표시가 같은 이유로 같은 모양을 쓴다. */}
        <pre className="heartbeat-update-failure-command">
          <code>{result.command}</code>
        </pre>
        <div className="heartbeat-update-failure-copy">
          <button
            aria-label="하트비트 업데이트 명령 복사"
            className="secondary-button heartbeat-update-failure-copy-button"
            onClick={() => onCopy(result.command)}
            type="button"
          >
            명령 복사
          </button>
          {copied !== null && (
            <span
              className={`heartbeat-update-copied${copied ? "" : " copy-failed"}`}
              role="status"
            >
              {copied ? "복사됨" : "복사하지 못했습니다 — 위 명령을 직접 선택해 복사하세요."}
            </span>
          )}
        </div>
      </IntegrationWarning>
    );
  }

  if (result.kind === "offContract") {
    return (
      <IntegrationWarning title="이 설치본이 계약대로 답하지 않았습니다">
        <p>
          앱이 하트비트를 띄웠지만 돌아온 출력이 계약의 모양이 아닙니다. 성공으로도 실패로도 부르지
          않습니다 — update 서브커맨드가 없는 옛 설치본일 수 있습니다. 갱신이 실제로 일어났는지는
          아래 원문으로 확인해야 합니다.
        </p>
        {/* 계약 밖 출력에는 종료 코드의 뜻도 계약 밖이다. 숫자만 그대로 싣는다. */}
        <p>
          {result.code === null
            ? "하트비트가 종료 코드 없이 끝났습니다. 프로세스가 시그널로 끝난 경우입니다."
            : `종료 코드 ${result.code}.`}
        </p>
        <UpdateOutput stderr={result.stderr} stdout={result.stdout} />
      </IntegrationWarning>
    );
  }

  return (
    <div
      aria-label="하트비트 업데이트 결과"
      className={`heartbeat-update-result result-${result.result}`}
      role="group"
    >
      <strong>{updateResultLabels[result.result] ?? result.result}</strong>
      {result.result === "partial" && <p>{partialNote}</p>}

      {/* 데몬이 실제로 낸 줄만 순서대로 그린다. 앱이 단계 셋을 미리 만들어 두고 채우지 않는다. */}
      {result.steps.length > 0 ? (
        <ol className="heartbeat-update-steps-run">
          {result.steps.map((step) => (
            <li key={step.step}>
              <span className="heartbeat-update-step-name">
                {updateStepLabels[step.step] ?? step.step}
              </span>
              <span
                className={`heartbeat-update-step-status status-${step.status ?? "unknown"}`}
              >
                {step.status ? updateStatusLabels[step.status] ?? step.status : "상태 기록 없음"}
              </span>
              <span className="heartbeat-update-step-detail">{step.detail ?? "사유 기록 없음"}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p>하트비트가 단계 줄을 하나도 내지 않았습니다.</p>
      )}

      <p>{exitNote(result.code)}</p>
      {result.version && <p>갱신 뒤 디스크의 하트비트 버전: {result.version}</p>}
      <UpdateOutput stderr={result.stderr} stdout={null} />
    </div>
  );
}

/**
 * 원문. 요약하지도 잘라내지도 않는다(R4의 마지막 항목). 사람용 진단은 stderr에 있고, 결과 문장을
 * 덮지 않게 접힌 자리에 둔다.
 *
 * `stdout`은 계약대로 읽힌 결과에는 그리지 않는다. 그 줄들은 이미 단계와 결과로 화면에 있고, 같은
 * 값을 두 번 그리면 어느 쪽을 읽어야 하는지가 흐려진다. 계약 밖 출력에서는 그 원문이 유일한 단서다.
 */
function UpdateOutput({ stderr, stdout }: { stderr: string; stdout: string | null }) {
  return (
    <>
      <details className="heartbeat-update-output">
        <summary>진단 원문 (stderr)</summary>
        <pre>{stderr === "" ? "(비어 있음)" : stderr}</pre>
      </details>
      {stdout !== null && (
        <details className="heartbeat-update-output">
          <summary>표준 출력 원문 (stdout)</summary>
          <pre>{stdout === "" ? "(비어 있음)" : stdout}</pre>
        </details>
      )}
    </>
  );
}

/**
 * 데몬 끄기·켜기 통로(SPEC-036 R1·R2·R3·R5·R6·R7). 버튼 둘로 이 기기의 데몬이 내려가고 다시
 * 올라가며, 성공 경로에서 사용자가 터미널을 열지 않는다.
 *
 * 진행 중 여부와 결과의 주인은 훅이다. 카드가 따로 들면 다른 메뉴를 다녀와 언마운트된 순간
 * 갈라진다 — 업데이트 통로가 같은 이유로 같은 모양을 쓴다. 여기 있는 상태는 확인 화면의 열림과
 * 복사 결과뿐이고, 둘 다 이 화면을 떠나면 사라져도 되는 표시다.
 *
 * 대상이 확정되지 않았으면 버튼이 아예 나가지 않는다. 확정하지 못한 채 표준 이름으로 시도하는
 * 경로를 만들지 않는 것이 R4이고, 왜 조작할 수 없는지는 그 자리에서 읽힌다(R5).
 */
function HeartbeatServiceSection({
  activeLeases,
  daemonRunning,
  recordedJobs,
  service,
  target,
}: {
  activeLeases: AgentLeaseSummary[];
  daemonRunning: boolean;
  recordedJobs: HeartbeatRecordedJob[];
  service: HeartbeatServiceControls;
  target: HeartbeatServiceTarget;
}) {
  const [confirming, setConfirming] = useState(false);
  // 실행 수단을 찾지 못했을 때 내미는 명령의 복사 결과. 조작마다 새로 시작한다.
  const [copied, setCopied] = useState<boolean | null>(null);

  /**
   * 확인 화면을 닫고 실행 통로를 부른다. 누르면 화면이 닫히므로 같은 버튼을 두 번 눌러도 실행은
   * 한 번이다. 겹쳐 누르기를 막는 두 번째 선은 훅에 있다.
   */
  async function start(operation: HeartbeatServiceOperation) {
    setConfirming(false);
    setCopied(null);
    await service.control(operation);
  }

  const unresolved = unresolvedFromTarget(target);

  return (
    <div className="heartbeat-service">
      <div className="heartbeat-service-head">
        <strong>데몬 끄기·켜기</strong>
        {/* 대상이 확정된 경우에만 버튼이 선다. 진행 중에는 눌리지 않는다 — `bootout`은 데몬이
            내려갈 때까지 걸리므로 표시가 없으면 사용자는 눌리지 않았다고 판단하고 다시 누른다. */}
        {!unresolved && (
          <div className="heartbeat-service-buttons">
            <button
              className="secondary-button heartbeat-service-run"
              disabled={service.running !== null}
              onClick={() => setConfirming(true)}
              type="button"
            >
              {serviceOperationLabels.stop}
            </button>
            {/* 켜기에는 확인 화면이 붙지 않는다. 끊을 세션이 없는 조작이고 되돌릴 수 없는 것도
                아니다. 사정거리는 아래 문장이 말한다. */}
            <button
              className="secondary-button heartbeat-service-run"
              disabled={service.running !== null}
              onClick={() => void start("start")}
              type="button"
            >
              {serviceOperationLabels.start}
            </button>
          </div>
        )}
      </div>
      <p className="integration-note">
        이 조작은 이 기기의 데몬 하나에 걸립니다. 화면은 이 프로젝트의 연동 탭이지만 끄면 다른
        프로젝트의 잡과 dream 잡까지 함께 멈추고, 켜면 이 기기의 잡이 전부 다시 깨어납니다.
      </p>

      {unresolved && <ServiceUnresolvedNote view={unresolved} />}

      {service.running !== null && (
        <p className="heartbeat-service-progress" role="status">
          {service.running === "stop"
            ? "데몬을 내리고 있습니다. 데몬이 실제로 내려갈 때까지 걸리고, 끝나면 이 표시가 사라지며 버튼이 다시 눌립니다."
            : "데몬을 올리고 있습니다. 끝나면 이 표시가 사라지며 버튼이 다시 눌립니다."}
        </p>
      )}

      {confirming && (
        <ServiceStopConfirm
          activeLeases={activeLeases}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void start("stop")}
          recordedJobs={recordedJobs}
        />
      )}

      {/* 커맨드 자체가 거절한 것은 결과가 아니다. 명령 원문은 대상이 확정된 뒤에만 만들어지고 그
          값을 아는 쪽은 백엔드라, 화면이 여기서 명령을 지어내지 않는다. */}
      {service.error !== null && (
        <IntegrationWarning title="앱이 데몬 조작을 시작하지 못했습니다">
          <p>{service.error}</p>
        </IntegrationWarning>
      )}

      {service.outcome && (
        <ServiceOutcomeView
          copied={copied}
          daemonRunning={daemonRunning}
          onCopy={async (command) => setCopied(await copy(command))}
          outcome={service.outcome}
        />
      )}
    </div>
  );
}

/** 조작할 수 없는 사유 하나. 담을 값이 있는 둘만 목록과 경로를 더 그린다(R5). */
function ServiceUnresolvedNote({ view }: { view: ServiceUnresolvedView }) {
  const { title, note } = serviceUnresolvedNotes[view.reason];
  return (
    <IntegrationWarning title={title}>
      <p>{note}</p>
      {view.plistPaths.length > 0 && (
        <ul>
          {view.plistPaths.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      )}
      {view.path !== null && <p>읽지 못한 경로: {view.path}</p>}
    </IntegrationWarning>
  );
}

/**
 * 끄기 전 확인 화면(R2·R3). 끄기 버튼은 누르는 즉시 실행하지 않는다.
 *
 * 업데이트의 확인 화면과 같은 자리·같은 모양을 쓰되 첫 줄에서 갈라 준다 — 업데이트는 저장소를
 * 갱신하고 데몬을 다시 띄우는 것이고, 이쪽은 데몬을 내리고 그대로 둔다.
 *
 * **앱은 세션을 정리하지 않는다.** 드레이닝을 기다리지도, lease를 지우지도 않는다 — 남의 lease에
 * 손대는 것은 `.workflow/rules/workflow.md` §4가 금한다. 고지하고 사용자가 고른다.
 */
function ServiceStopConfirm({
  activeLeases,
  onCancel,
  onConfirm,
  recordedJobs,
}: {
  activeLeases: AgentLeaseSummary[];
  onCancel(): void;
  onConfirm(): void;
  recordedJobs: HeartbeatRecordedJob[];
}) {
  // 앱이 더한 것은 "이 프로젝트의 것인가" 하나다. 이름은 상태 파일에서 읽은 문자열 그대로이고,
  // 앱이 이름에서 프로젝트나 역할을 뽑아내지 않는다(R2).
  const ours = recordedJobs.filter((job) => job.ofThisProject);
  const others = recordedJobs.filter((job) => !job.ofThisProject);

  return (
    <div aria-label="하트비트 데몬 끄기 확인" className="heartbeat-confirm" role="group">
      <strong>확인하면 이 기기의 하트비트 데몬이 내려가고 그대로 있습니다</strong>
      <p>
        업데이트는 저장소를 갱신하고 데몬을 다시 띄우지만, 이 조작은 데몬을 내리고 그대로 둡니다.
        다시 올리는 것은 사용자가 켜기를 누르는 때입니다.
      </p>

      {/* 화면은 프로젝트 하나의 연동 탭인데 사정거리는 기기 전체다. 그 차이를 누르기 전에 말한다. */}
      <p>
        멈추는 것은 이 프로젝트의 잡만이 아닙니다. 데몬은 이 기기에 하나뿐이라 실행 기록이 있는 잡{" "}
        {recordedJobs.length}개가 모두 멈춥니다.
      </p>
      {recordedJobs.length === 0 ? (
        <p>상태 파일에 실행 기록이 있는 잡이 없습니다.</p>
      ) : (
        <>
          <p>이 프로젝트의 잡 {ours.length}개</p>
          {ours.length > 0 && (
            <ul>
              {ours.map((job) => (
                <li key={job.name}>{job.name}</li>
              ))}
            </ul>
          )}
          <p>그 밖의 잡 {others.length}개</p>
          {others.length > 0 && (
            <ul>
              {others.map((job) => (
                <li key={job.name}>{job.name}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {/* 목록과 별개로 한 문장이 이 사실을 말한다. 어느 이름이 dream 잡인지는 앱이 판정하지
          않는다 — 앱은 잡 이름을 해석하지 않는다(R2). */}
      <p>
        dream 잡도 같은 데몬이 깨웁니다. 하트비트 카드와 dream 카드가 화면에서 갈려 있어도 데몬은
        하나라 함께 멈춥니다.
      </p>

      {/* 세션이 없을 때와 있을 때의 문구가 다르다. 고지만 하면 사용자가 확인 버튼을 습관적으로
          누르게 되므로, 무게 차이를 문구가 감당한다. */}
      {activeLeases.length === 0 ? (
        <p>
          이 프로젝트에 활성 lease가 하나도 없어 지금 끊길 세션이 없습니다. 다만 앱이 읽은 것은 이
          프로젝트의 lease뿐이라, 다른 프로젝트에서 도는 세션이 있으면 그쪽도 함께 끊깁니다 — 앱은
          그 수를 알지 못합니다.
        </p>
      ) : (
        <>
          <p>
            지금 끊기는 세션 {activeLeases.length}개 — 데몬을 내리면 돌고 있는 세션이 끊깁니다. 앱은
            그 세션을 정리하지 않고 lease에도 손대지 않으므로, 끊긴 세션의 작업은 남은 lease가 만료될
            때까지 그대로 멈춰 있습니다. 이 수는 이 프로젝트의 lease만 센 것이고, 다른 프로젝트에서
            도는 세션도 함께 끊기지만 앱은 그 수를 알지 못합니다.
          </p>
          <ul>
            {activeLeases.map((lease) => (
              <li key={lease.leaseId}>
                {lease.agent} · {lease.taskId ?? "워크플로우 작업"}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* 이 조작은 잠깐 내리는 것이지 등록 해제가 아니다(R8). "껐는데 다시 켜져 있다"를 사용자가
          만나기 전에 말해 둔다. */}
      <p>
        재부팅하거나 다시 로그인하면 데몬이 자동으로 다시 켜집니다. 이 조작은 등록물을 지우는 것이
        아니라 잠깐 내리는 것입니다. 자동 시작까지 없애려면 위 설치 마법사의 서비스 등록을 해제해야
        하고, 이 버튼은 그것을 하지 않습니다.
      </p>

      <div className="heartbeat-confirm-actions">
        <button className="primary-button" onClick={onConfirm} type="button">
          확인하고 데몬 끄기
        </button>
        <button className="secondary-button" onClick={onCancel} type="button">
          취소
        </button>
      </div>
    </div>
  );
}

/**
 * 조작 결과(R5·R7). "꺼졌습니다"로 끝나지 않는다 — 명령이 성공했다는 것과 데몬이 실제로 내려갔다는
 * 것은 다른 사실이고, 앱의 실행 여부 판정은 pid 파일 존재 하나다.
 */
function ServiceOutcomeView({
  copied,
  daemonRunning,
  onCopy,
  outcome,
}: {
  copied: boolean | null;
  daemonRunning: boolean;
  onCopy(command: string): void;
  outcome: HeartbeatServiceOutcome;
}) {
  const { operation, result } = outcome;

  if (result.kind === "notRun") {
    return (
      <IntegrationWarning
        title={`앱이 ${serviceOperationLabels[operation]} 명령을 실행하지 못했습니다`}
      >
        <p>{result.message}</p>
        <p>아래 명령을 터미널에서 직접 실행하면 같은 조작을 끝낼 수 있습니다.</p>
        {/* 복사에 실패해도 원문은 여기 남아 사용자가 직접 선택할 수 있다. 업데이트 실행 실패
            표시가 같은 이유로 같은 모양을 쓴다. */}
        <pre className="heartbeat-service-failure-command">
          <code>{result.command}</code>
        </pre>
        <div className="heartbeat-service-failure-copy">
          <button
            aria-label="데몬 조작 명령 복사"
            className="secondary-button heartbeat-service-failure-copy-button"
            onClick={() => onCopy(result.command)}
            type="button"
          >
            명령 복사
          </button>
          {copied !== null && (
            <span
              className={`heartbeat-service-copied${copied ? "" : " copy-failed"}`}
              role="status"
            >
              {copied ? "복사됨" : "복사하지 못했습니다 — 위 명령을 직접 선택해 복사하세요."}
            </span>
          )}
        </div>
      </IntegrationWarning>
    );
  }

  const unresolved = unresolvedFromResult(result);
  if (unresolved) return <ServiceUnresolvedNote view={unresolved} />;
  if (result.kind !== "ran") return null;

  return (
    <div
      aria-label="데몬 조작 결과"
      className={`heartbeat-service-result result-${result.code === 0 ? "ok" : "failed"}`}
      role="group"
    >
      <strong>{serviceOperationLabels[operation]} 명령이 끝났습니다</strong>
      <p>{serviceExitNote(result.code)}</p>
      <p>{serviceStateNote(operation, daemonRunning)}</p>
      <p>
        조작한 대상: {result.label} · {result.plistPath}
      </p>
      {/* 0이 아닌 종료 코드에서 사유를 말하는 것은 이 원문이지 앱이 아니다. 결과 문장을 덮지 않게
          접힌 자리에 둔다 — 업데이트 쪽 원문이 같은 자리를 쓴다. */}
      {result.code !== 0 && (
        <details className="heartbeat-service-output">
          <summary>진단 원문 (stderr)</summary>
          <pre>{result.stderr === "" ? "(비어 있음)" : result.stderr}</pre>
        </details>
      )}
    </div>
  );
}

/**
 * 084 경고 안의 갱신 안내와 그 접힘(R6, 확인 필요 6번의 승인안).
 *
 * 하트비트 카드에는 업데이트 버튼이 있어 안내가 주 통로가 아니므로 접어 둔다. 실행 수단을 찾지
 * 못한 뒤에는 손으로 끝내는 길이 유일하므로 안내가 펼쳐진 주 통로가 된다. 접힘·펼침을 가르는 것은
 * "직전 실행이 무엇으로 끝났는가" 하나이며, 그 값이 뒤집히면 사용자가 고른 상태도 함께 초기화된다
 * — 호출부의 `key`가 그 일을 한다.
 *
 * 감싸기일 뿐 안내 자체는 손대지 않는다. `HeartbeatUpdateGuide`의 문구와 다섯 값이 그대로여야
 * dream 카드와 글자까지 같다(SPEC-034 R7). dream 카드에는 이 감싸기를 쓰지 않는다 — 그쪽에는
 * 업데이트 버튼이 없어 안내가 계속 주 통로다.
 */
function FoldedUpdateGuide({ expanded, guide }: { expanded: boolean; guide: UpdateGuide }) {
  const [open, setOpen] = useState(expanded);
  const guideId = useId();

  return (
    <div className="heartbeat-update-fold">
      <button
        aria-controls={guideId}
        aria-expanded={open}
        className="integration-toggle"
        onClick={() => setOpen(!open)}
        type="button"
      >
        {open ? "갱신 안내 접기" : "갱신 안내 펼치기"}
      </button>
      {/* 접기는 언마운트가 아니다. 조건부 렌더로 빼면 어느 명령을 복사했는지가 사라진다.
          설치 가이드와 연동 카드 본문이 같은 이유로 같은 모양을 쓴다. */}
      <div hidden={!open} id={guideId}>
        <HeartbeatUpdateGuide guide={guide} />
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
  guideExpanded,
}: {
  snapshot: IntegrationsSnapshot;
  writeError: string | null;
  onInstall(roles: RoleJobRequest[], baseline: ManagedRoleJob[]): Promise<boolean>;
  pendingWork?: PendingRoleWork;
  heartbeatRuns: HeartbeatRunControls;
  /** 084 경고 안의 갱신 안내가 펼쳐진 주 통로인가. 판정은 카드가 하고 여기서는 넘기기만 한다. */
  guideExpanded: boolean;
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
      {/*
        역할 정책의 정본은 에이전트 화면으로 옮겨 갔다(SPEC-051). 이 자리는 옛 잡을 확인하고 옮기기
        위한 고급 관리로 남기고, 어디서 설정해야 하는지를 먼저 말한다 — 두 자리가 나란히 "역할 설정"을
        자처하면 사용자가 어느 쪽이 진짜인지 알 수 없다.
      */}
      <p className="integration-note heartbeat-legacy-note">
        역할 설정은 이제 에이전트 화면에서 합니다. 이 아래는 옛 역할 잡을 확인하고 정리하기 위한 고급
        관리이며, 기존 잡은 에이전트 화면의 이전 미리보기로 옮길 수 있습니다.
      </p>
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
                      그래서 상시 표시가 되지 않는다.

                      이제 그 갱신을 앱이 대신 실행하므로 안내는 접힌 자리로 내려간다. 실행 수단을
                      찾지 못한 뒤에만 다시 주 통로가 된다(SPEC-037 확인 필요 6번). */}
                  <FoldedUpdateGuide
                    expanded={guideExpanded}
                    guide={snapshot.updateGuide}
                    key={guideExpanded ? "expanded" : "folded"}
                  />
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
