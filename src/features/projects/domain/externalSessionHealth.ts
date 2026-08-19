import type { AgentRunStatus } from "./types";

/**
 * 앱 밖 세션 하나를 정상 줄과 카드 중 어디에 둘지, 카드라면 어떤 근거를 말할지 정한다(SPEC-081).
 *
 * 지금 화면은 선점 갱신 시각 하나로만 가른다. 긴 검사나 빌드를 도는 세션은 살아 있어도 갱신 간격이
 * 벌어지므로 실제로 끊긴 세션과 구별되지 않는다. 이 판정은 같은 세션의 실행 기록을 두 번째 근거로
 * 겹쳐, 앱이 생존 근거를 하나도 확인하지 못한 세션만 카드에 남긴다.
 *
 * 결과에는 문구 문자열과 CSS 클래스 이름이 들어가지 않는다. 문장을 짓는 일은 화면의 몫이고, 이
 * 단위는 어느 줄에 서는지와 어떤 근거를 말할지까지만 정한다.
 */

/**
 * 갱신이 뜸하다고 보는 기준이자 마지막 활동이 최근이라고 보는 기준(SPEC-081 R8). 두 판정이 같은
 * 값을 쓴다.
 *
 * 같은 값을 지금 쓰는 자리는 AgentRunDashboard의 `leaseIsStale`이 든 `10 * 60_000`이며, 화면이 이
 * 상수를 가져다 쓰도록 바꾸는 일은 같은 기능의 다음 작업이 맡는다. 실행 상세 화면의 활동 없음
 * 표시가 쓰는 5분 기준(runActivity의 `IDLE_THRESHOLD_SECONDS`)은 다른 판정이라 가져다 쓰지 않는다.
 */
export const EXTERNAL_SESSION_STALE_MS = 10 * 60_000;

/**
 * 앱이 진행 중으로 묶어 보여주는 상태 넷. AgentRunDashboard의 `activeStates`와 같은 목록이고, 두
 * 목록은 같아야 한다. 화면 파일에서 가져오면 이 판정이 화면에 묶이므로 여기에 다시 적는다.
 */
const ACTIVE_STATES = new Set<AgentRunStatus>(["reserved", "queued", "running", "paused"]);

/**
 * 세션의 결과가 아니라 앱 쪽 사정으로 남는 상태 둘. 복구 필요는 앱이 실행을 취소하다가 프로세스
 * 종료나 선점 반납에 실패했을 때 남고, 상태 확인 필요는 계약 밖 상태값이 왔을 때 앱이 붙인다.
 */
const OPERATIONAL_STATES = new Set<AgentRunStatus>(["recovery_required", "unrecognized"]);

/**
 * 앱이 세션 정리를 미루고 종료 처리만 남긴 사유. 이 사유가 붙어 있으면 상태값이 실패나 취소로 와도
 * 세션이 스스로 끝난 것이 아니다.
 *
 * AgentRunDashboard의 실행 사유 문장이 이미 같은 두 값을 "세션 정리를 안전하게 미뤘습니다"로 옮기고
 * 있다. 그쪽은 자유 형식 실패 메시지도 함께 다루느라 부분 문자열로 찾지만, 여기서는 실행 기록이
 * 싣는 사유 값 자체를 보므로 값이 같은지로 가른다.
 */
const OPERATIONAL_REASONS = new Set(["supervisor_identity_unverified", "handle_mismatch"]);

/** 판정이 읽는 실행 행의 값. `AgentRunSummary`에서 이 둘만 쓴다. */
export interface ExternalSessionRun {
  state: AgentRunStatus;
  reason: string | null;
}

/**
 * 그 실행의 활동 기록 조회 결과. 읽지 못한 것과 활동이 없는 것은 다른 사실이므로 형태로 가른다
 * (SPEC-081 R9). 조회를 실제로 수행하는 경로는 같은 기능의 다음 작업이 만든다.
 */
export type ExternalSessionActivity =
  | { read: true; lastActivityAt: string | null }
  | { read: false };

export interface ExternalSessionHealthInput {
  /** 선점 갱신 시각 원문. */
  heartbeatAt: string;
  /** 판정 시각(밀리초). */
  now: number;
  /** 그 선점의 대상 문서를 맡은 실행 행. 앱에 기록이 없으면 null이다. */
  run: ExternalSessionRun | null;
  /** 그 실행의 활동 기록 조회 결과. */
  activity: ExternalSessionActivity;
}

/**
 * 카드에 말할 근거. 마지막 활동 시각을 함께 말해야 하는 근거는 종료로 남은 실행 하나뿐이라, 그 값도
 * 이 근거에 함께 실린다.
 */
export type ExternalSessionEvidence =
  /** 실행이 종료로 남음. */
  | {
      kind: "run_ended";
      /** 그 실행의 상태값. */
      runState: AgentRunStatus;
      /** 마지막 활동 시각. 활동 기록을 읽지 못했거나 값이 없으면 null이다. */
      lastActivityAt: string | null;
      /** 활동 기록을 읽었는지. false면 `lastActivityAt`이 null인 이유가 조회 실패다. */
      activityRead: boolean;
    }
  /** 앱에 실행 기록 없음. */
  | { kind: "run_missing" }
  /** 앱 쪽 운영 사유로 종료 처리됨. */
  | { kind: "operational_stop" };

export interface ExternalSessionHealth {
  /** 정상 줄과 카드 중 어디에 서는지. */
  placement: "healthy" | "attention";
  /** 앱이 확인한 생존 여부. */
  liveness: "alive" | "ended" | "unknown";
  /**
   * 선점 갱신이 뜸한 채로 이 판정이 섰는지. 정상 줄에 보조 문구를 덧붙일지를 화면이 이 값으로
   * 정한다. 카드는 갱신이 뜸할 때만 서므로 언제나 true다.
   */
  heartbeatStale: boolean;
  /** 카드에 말할 근거. 정상 줄이면 null이다. */
  evidence: ExternalSessionEvidence | null;
}

/** 갱신 시각을 파싱하지 못한 선점은 지금 화면과 같이 뜸하지 않은 것으로 다룬다. */
function heartbeatIsStale(heartbeatAt: string, now: number): boolean {
  const at = Date.parse(heartbeatAt);
  return !Number.isNaN(at) && now - at > EXTERNAL_SESSION_STALE_MS;
}

function isOperationalStop(run: ExternalSessionRun): boolean {
  return OPERATIONAL_STATES.has(run.state) || (run.reason !== null && OPERATIONAL_REASONS.has(run.reason));
}

/** 활동 기록을 읽지 못한 경우는 활동이 없는 것으로 세지 않고 최근이 아닌 쪽으로 둔다. */
function lastActivityIsRecent(activity: ExternalSessionActivity, now: number): boolean {
  if (!activity.read || activity.lastActivityAt === null) return false;
  const at = Date.parse(activity.lastActivityAt);
  return !Number.isNaN(at) && now - at <= EXTERNAL_SESSION_STALE_MS;
}

function healthy(heartbeatStale: boolean): ExternalSessionHealth {
  return { placement: "healthy", liveness: "alive", heartbeatStale, evidence: null };
}

function attention(liveness: "ended" | "unknown", evidence: ExternalSessionEvidence): ExternalSessionHealth {
  return { placement: "attention", liveness, heartbeatStale: true, evidence };
}

/** 선점 하나와 그 대상을 맡은 실행 기록을 겹쳐 표시를 정한다. */
export function judgeExternalSessionHealth(input: ExternalSessionHealthInput): ExternalSessionHealth {
  // 갱신이 최근이면 그것만으로 생존 근거가 선다. 실행 기록은 보지 않는다.
  if (!heartbeatIsStale(input.heartbeatAt, input.now)) return healthy(false);
  // 갱신이 뜸한데 실행 기록도 없으면 확인할 근거가 하나도 없다. 생존 쪽으로 추정하지 않는다.
  if (input.run === null) return attention("unknown", { kind: "run_missing" });
  // 앱 쪽 사정으로 남은 실행은 상태값이 세션의 결과를 말하지 않으므로, 상태값 판정보다 앞에서
  // 가른다. 이 경우 생존 여부는 마지막 활동만이 말한다.
  if (isOperationalStop(input.run)) {
    return lastActivityIsRecent(input.activity, input.now)
      ? healthy(true)
      : attention("unknown", { kind: "operational_stop" });
  }
  // 진행 중으로 묶이는 상태는 그 자체가 생존 근거다. 활동 공백 길이는 보지 않는다.
  if (ACTIVE_STATES.has(input.run.state)) return healthy(true);
  // 남는 상태는 세션 자신의 결과로 끝난 셋(succeeded, failed, cancelled)뿐이다.
  return attention("ended", {
    kind: "run_ended",
    runState: input.run.state,
    lastActivityAt: input.activity.read ? input.activity.lastActivityAt : null,
    activityRead: input.activity.read,
  });
}
