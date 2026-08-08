import { useRef, useState } from "react";
import { useArmedConfirm } from "../../../shared/ui/useArmedConfirm";
import type { BlockedReason } from "../domain/documentSections";
import type { TaskResumeOutcome, TaskResumeRecovery, WorkflowItemSummary } from "../domain/types";
import { MarkdownBody } from "./MarkdownBody";
import "./BlockedTaskPanel.css";

const relatedTaskStatusLabels: Record<string, string> = {
  todo: "준비",
  in_progress: "진행 중",
  blocked: "막힘",
  qa_waiting: "QA 대기",
  completed: "완료",
};

/** 해결 근거의 글자 수 상한. 백엔드가 거절하는 값과 같아야 화면이 먼저 막을 수 있다. */
export const RESUME_RESOLUTION_LIMIT = 2_000;

interface Props {
  busy?: boolean;
  decisionSummary: string | null;
  onOpenRelatedTask(task: WorkflowItemSummary): Promise<void>;
  /** 오류 뒤 최신 문서를 다시 읽는다. 재개 통로가 있을 때만 쓰인다. */
  onReloadTask?(): Promise<void>;
  /**
   * 재개 호출. 이 통로가 없으면 재개 영역을 세우지 않는다 — 부를 곳이 없는 화면에 버튼만 내밀지
   * 않는다. 작업 공간은 언제나 이 값을 넘기고, 선택인 것은 이 컴포넌트를 그리는 검사 리터럴이 아직
   * 이 통로를 모르기 때문이다.
   */
  onResume?(resolution: string, requestId: string): Promise<TaskResumeOutcome>;
  reason: BlockedReason | null;
  tasks: WorkflowItemSummary[];
  updatedAt: string | null;
}

/**
 * 작업 문서가 작성한 현재 막힘 사유를 그대로 보여 주고, 그 아래에서 사용자가 해결 근거를 적어
 * 개발 준비 상태로 되돌린다.
 *
 * 값의 뜻을 보완하지 않고, 관련 대상도 현재 작업 목록의 id와 정확히 일치할 때만 링크로 만든다.
 * 구조화 절을 읽지 못한 옛 문서는 결정권자 요약 또는 원문 안내로 폴백하며, 세 경우 모두 재개
 * 영역은 같은 자리에 선다 — 사유를 읽지 못한 것과 재개할 수 없는 것은 다른 사실이다.
 */
export function BlockedTaskPanel({
  busy = false,
  decisionSummary,
  onOpenRelatedTask,
  onReloadTask,
  onResume,
  reason,
  tasks,
  updatedAt,
}: Props) {
  return (
    <section aria-label="막힌 작업 상세" className="blocked-task-panel">
      {reason === null ? (
        decisionSummary !== null ? (
          <>
            <p className="blocked-task-fallback-note">구조화된 막힘 사유를 읽을 수 없어 작성된 결정권자 요약을 표시합니다.</p>
            <div className="blocked-task-summary">
              <MarkdownBody body={decisionSummary} />
            </div>
          </>
        ) : (
          <div className="blocked-task-empty">
            <strong>구조화된 막힘 사유가 없습니다</strong>
            <p>왼쪽 문서에 표시된 원문에서 현재 기록을 확인해 주세요.</p>
          </div>
        )
      ) : (
        <>
          <p className="blocked-task-updated">{formatUpdatedAt(updatedAt)}</p>
          <p className="blocked-task-source">작성된 막힘 사유</p>
          <dl className="blocked-task-fields">
            <BlockedValue label="막힌 지점" value={reason.blockedPoint} />
            <BlockedValue label="필요한 해결" value={reason.requiredResolution} />
            <BlockedValue label="재개 조건" value={reason.resumeCondition} />
            <div className="blocked-task-field">
              <dt>관련 대상</dt>
              <dd>
                {reason.relatedTargets.length === 0 ? (
                  <span className="blocked-task-no-targets">{reason.relatedTargetsRaw}</span>
                ) : (
                  <ul className="blocked-task-targets">
                    {reason.relatedTargets.map((target, index) => {
                      const task = tasks.find((item) => item.id === target);
                      return (
                        <li key={`${target}:${index}`}>
                          {task ? (
                            <button
                              aria-label={`${task.id} ${task.title} 작업 열기`}
                              className="blocked-task-target-button"
                              onClick={() => void onOpenRelatedTask(task)}
                              type="button"
                            >
                              <span className="blocked-task-target-kind">실제 작업</span>
                              <strong>{task.id}</strong>
                              <span>{task.title}</span>
                              <span className={`status-pill status-${task.status}`}>
                                현재 상태 {relatedTaskStatusLabels[task.status] ?? task.status}
                              </span>
                            </button>
                          ) : (
                            <div className="blocked-task-target-text">
                              <span className="blocked-task-target-kind">작성된 대상</span>
                              <span>{target}</span>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
        </>
      )}
      {onResume && (
        <ResumeControl
          busy={busy}
          onReloadTask={onReloadTask}
          onResume={onResume}
          resumeCondition={reason?.resumeCondition ?? null}
          updatedAt={updatedAt}
        />
      )}
    </section>
  );
}

/**
 * 사용자가 해결 근거를 적고 두 번 확인해 재개하는 영역.
 *
 * 첫 확인은 무엇을 어떤 값으로 기록하는지 고정해 보여 주기만 하고, 두 번째 확인만 호출한다. 근거를
 * 앱이 대신 짓지 않으므로 빈 입력에서는 호출 자체가 없고, 실패해도 입력을 지우지 않는다.
 */
function ResumeControl({
  busy,
  onReloadTask,
  onResume,
  resumeCondition,
  updatedAt,
}: {
  busy: boolean;
  onReloadTask?(): Promise<void>;
  onResume(resolution: string, requestId: string): Promise<TaskResumeOutcome>;
  resumeCondition: string | null;
  updatedAt: string | null;
}) {
  const [resolution, setResolution] = useState("");
  const [running, setRunning] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const confirm = useArmedConfirm();
  // 같은 입력을 다시 보내는 재시도는 같은 식별자를 쓴다. 응답을 잃은 뒤 다시 눌러도 앱이 기록을
  // 두 벌 만들지 않게 하는 값이고, 입력이 바뀌면 다른 조작이므로 새로 만든다.
  const requestId = useRef<string | null>(null);

  const trimmed = resolution.trim();
  const tooLong = resolution.length > RESUME_RESOLUTION_LIMIT;
  const missingUpdatedAt = updatedAt === null;
  const blockedFromCalling = trimmed.length === 0 || tooLong || missingUpdatedAt;
  const locked = running || busy;

  function changeResolution(value: string) {
    confirm.disarm();
    setFailure(null);
    requestId.current = null;
    setResolution(value);
  }

  async function resume() {
    if (blockedFromCalling || locked || updatedAt === null) return;
    if (requestId.current === null) requestId.current = createRequestId();
    setRunning(true);
    setFailure(null);
    try {
      const outcome = await onResume(trimmed, requestId.current);
      if (!outcome.ok) {
        setFailure(outcome.message);
        return;
      }
      if (outcome.result.status !== "resumed") {
        setFailure(recoveryMessage(outcome.result.recovery));
        return;
      }
      // 성공한 조작의 식별자는 다시 쓰지 않는다. 상세가 다시 읽히면 이 영역은 사라진다.
      requestId.current = null;
    } finally {
      setRunning(false);
    }
  }

  async function reload() {
    if (!onReloadTask || reloading) return;
    setReloading(true);
    try {
      await onReloadTask();
    } finally {
      setReloading(false);
    }
  }

  return (
    <section aria-label="개발 준비로 돌리기" className="task-resume">
      <h3>개발 준비로 돌리기</h3>
      <p className="task-resume-guide">
        막힘이 해결됐다면 무엇이 해결됐는지 사실로 적어 주세요. 적은 문장이 그대로 기록에 남고 앱이
        대신 만들지 않습니다.
      </p>
      <dl className="task-resume-facts">
        <div>
          <dt>확인한 갱신 시각</dt>
          <dd>{updatedAt ?? "확인할 수 없음"}</dd>
        </div>
        <div>
          <dt>재개 조건</dt>
          <dd>{resumeCondition ?? "작성된 재개 조건이 없습니다. 왼쪽 문서 원문에서 확인해 주세요."}</dd>
        </div>
      </dl>
      <label htmlFor="task-resume-resolution">해결 근거</label>
      <textarea
        disabled={locked}
        id="task-resume-resolution"
        maxLength={RESUME_RESOLUTION_LIMIT}
        onChange={(event) => changeResolution(event.target.value)}
        placeholder={"1. 무엇이 막고 있었는지\n2. 그것이 어떻게 해결됐는지\n3. 무엇으로 확인했는지"}
        value={resolution}
      />
      <p className="task-resume-count">
        {resolution.length.toLocaleString("ko-KR")} / {RESUME_RESOLUTION_LIMIT.toLocaleString("ko-KR")}자
      </p>
      {missingUpdatedAt && (
        <p className="task-resume-warning" role="status">
          문서 갱신 시각을 읽지 못해 재개할 수 없습니다. 문서를 다시 읽어 주세요.
        </p>
      )}
      {tooLong && (
        <p className="task-resume-warning" role="status">
          해결 근거는 {RESUME_RESOLUTION_LIMIT.toLocaleString("ko-KR")}자 이하여야 합니다.
        </p>
      )}
      {confirm.armed && (
        <p className="confirm-warning" role="status">
          이 작업을 개발 준비 상태로 되돌리고 적은 근거를 사용자 기록으로 남깁니다.
        </p>
      )}
      {failure !== null && (
        <div className="task-resume-failure" role="status">
          <p>{failure}</p>
          {onReloadTask && (
            <button
              className="secondary-button"
              disabled={reloading || locked}
              onClick={() => void reload()}
              type="button"
            >
              {reloading ? "문서를 다시 읽는 중" : "문서 다시 읽기"}
            </button>
          )}
        </div>
      )}
      <button
        className={`stamp-button ${confirm.armed ? "armed" : ""}`}
        disabled={blockedFromCalling || locked}
        onClick={() => confirm.fire(() => void resume())}
        type="button"
      >
        {running ? "재개하는 중" : confirm.armed ? "한 번 더 누르면 재개" : "개발 준비로 되돌리기"}
        {confirm.armed && <i aria-hidden="true" className="confirm-timer" />}
      </button>
    </section>
  );
}

/** 부분 저장으로 끝난 결과의 문장. 앱이 성공으로 부르지 않고 남은 파일을 그대로 밝힌다. */
function recoveryMessage(recovery: TaskResumeRecovery | null) {
  const base = "재개 기록만 남고 작업 문서를 바꾸지 못했습니다.";
  if (recovery === null) return base;
  const paths = recovery.createdPaths.join(", ");
  return `${base} ${recovery.action}${paths ? ` 남은 파일: ${paths}` : ""}`;
}

/** 조작 하나를 한 번만 기록하기 위한 식별자. 사용자 사실이 아니라 재시도를 알아보는 값이다. */
function createRequestId() {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === "function") return source.randomUUID();
  return `resume-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function BlockedValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="blocked-task-field">
      <dt>{label}</dt>
      <dd><MarkdownBody body={value} /></dd>
    </div>
  );
}

function formatUpdatedAt(value: string | null) {
  if (!value) return "문서 갱신 시각을 확인할 수 없습니다.";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "문서 갱신 시각을 확인할 수 없습니다.";
  const formatted = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `문서 갱신 ${formatted}`;
}
