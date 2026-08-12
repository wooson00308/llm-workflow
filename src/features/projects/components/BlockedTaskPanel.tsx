import { useRef, useState } from "react";
import { useArmedConfirm } from "../../../shared/ui/useArmedConfirm";
import type { BlockedReason } from "../domain/documentSections";
import type {
  TaskDependency,
  TaskDocument,
  TaskRevisionRequestOutcome,
  WorkflowItemSummary,
} from "../domain/types";
import { MarkdownBody } from "./MarkdownBody";
import "./BlockedTaskPanel.css";

const relatedTaskStatusLabels: Record<string, string> = {
  todo: "준비",
  in_progress: "진행 중",
  blocked: "막힘",
  qa_waiting: "QA 대기",
  completed: "완료",
};

interface Props {
  decisionSummary: string | null;
  onOpenRelatedTask(task: WorkflowItemSummary): Promise<void>;
  reason: BlockedReason | null;
  revisionRequest?: RevisionRequestProps;
  tasks: WorkflowItemSummary[];
  updatedAt: string | null;
}

/**
 * 작업 문서가 작성한 현재 막힘 사유와 에이전트 처리 책임을 보여 준다.
 *
 * 값의 뜻을 보완하지 않고, 관련 대상도 현재 작업 목록의 id와 정확히 일치할 때만 링크로 만든다.
 * 구조화 절을 읽지 못한 옛 문서는 결정권자 요약 또는 원문 안내로 폴백한다. 어떤 폴백에서도
 * 사용자 입력이나 재개 조작은 만들지 않는다.
 */
export function BlockedTaskPanel({
  decisionSummary,
  onOpenRelatedTask,
  reason,
  revisionRequest,
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
      <section aria-label="에이전트 처리 안내" className="blocked-task-agent-notice">
        <strong>에이전트가 해결·재시도합니다</strong>
        <p>
          {revisionRequest
            ? "막힘 해결과 재개는 에이전트가 처리합니다. 작업 정의가 잘못된 경우에는 아래에서 별도로 수정을 요청할 수 있습니다."
            : "이 화면은 진행 상태만 보여 줍니다. 막힘 해결과 재개는 에이전트가 처리하며 사용자가 입력하거나 조작할 내용은 없습니다."}
        </p>
      </section>
      {revisionRequest && <TaskRevisionRequestPanel {...revisionRequest} />}
    </section>
  );
}

export interface RevisionRequestProps {
  busy: boolean;
  dependencies: TaskDependency[];
  document: TaskDocument;
  onReload(): Promise<void>;
  onRequest(
    fileName: string,
    expectedUpdatedAt: string,
    reason: string,
    requestId: string,
  ): Promise<TaskRevisionRequestOutcome>;
  preflight: string | null;
}

interface FrozenRequest {
  fileName: string;
  taskId: string;
  updatedAt: string;
  reason: string;
}

function nextRequestId() {
  return `task-revision-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** 정의 수정 요청의 사전 정보, 두 단계 확인, 저장 결과를 한 읽기 순서로 그린다. */
export function TaskRevisionRequestPanel({
  busy,
  dependencies,
  document,
  onReload,
  onRequest,
  preflight,
}: RevisionRequestProps) {
  const [reason, setReason] = useState("");
  const [frozen, setFrozen] = useState<FrozenRequest | null>(null);
  const [requestId, setRequestId] = useState(nextRequestId);
  const [message, setMessage] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingNow = useRef(false);
  const confirm = useArmedConfirm();
  const updatedAt = document.summary.updatedAt;
  const trimmed = reason.trim();
  const reasonLength = Array.from(reason).length;
  const tooLong = reasonLength > 2_000;
  const canSubmit = updatedAt !== null && trimmed.length > 0 && !tooLong && !busy && !submitting;
  const scope = document.scopeDeclaration ?? { status: "absent" as const, files: [] as [] };
  const requests = document.revisionRequests ?? [];

  async function submit(request: FrozenRequest) {
    if (submittingNow.current) return;
    submittingNow.current = true;
    setSubmitting(true);
    setMessage(null);
    setNeedsReload(false);
    try {
      const outcome = await onRequest(
        request.fileName,
        request.updatedAt,
        request.reason,
        requestId,
      );
      if (!outcome.ok) {
        setMessage(outcome.message);
        setNeedsReload(true);
        return;
      }
      if (outcome.result.status === "already_pending") {
        setMessage("아직 처리되지 않은 정의 수정 요청이 이미 있습니다.");
        setNeedsReload(true);
        return;
      }
      setMessage("정의 수정 요청을 기록했습니다.");
      setReason("");
      setFrozen(null);
      setRequestId(nextRequestId());
      await onReload();
    } finally {
      submittingNow.current = false;
      setSubmitting(false);
    }
  }

  function confirmRequest() {
    const current: FrozenRequest | null = updatedAt === null ? null : {
      fileName: document.summary.fileName,
      taskId: document.summary.id,
      updatedAt,
      reason: trimmed,
    };
    if (!confirm.armed) setFrozen(current);
    confirm.fire(() => {
      if (frozen) void submit(frozen);
    });
  }

  return (
    <section aria-label="정의 수정 요청" className="task-revision-request">
      <header>
        <p className="eyebrow">DEFINITION REVISION</p>
        <h3>작업 정의 수정 요청</h3>
        <p>작업을 재개하지 않고, 현재 정의를 아키텍트가 다시 검토하도록 기록합니다.</p>
      </header>

      <dl className="task-revision-facts">
        <div><dt>대상과 상태</dt><dd>{document.summary.id} · {statusName(document.summary.status)}</dd></div>
        <div><dt>확인한 갱신 시각</dt><dd>{updatedAt ?? "확인할 수 없음"}</dd></div>
        <div><dt>선행 관계</dt><dd>{dependencies.length === 0 ? "선행 작업 없음" : dependencies.map((entry) => `${entry.id} (${dependencyName(entry.state)})`).join(", ")}</dd></div>
        <div>
          <dt>현재 범위 선언</dt>
          <dd>
            {scope.status === "declared" ? (
              scope.files.length === 0 ? "변경 파일 없음 (빈 목록으로 선언됨)" : (
                <ul>{scope.files.map((file, index) => <li key={`${file}:${index}`}><code>{file}</code></li>)}</ul>
              )
            ) : scope.status === "malformed" ? "선언을 목록으로 읽지 못함" : "범위 선언 없음"}
          </dd>
        </div>
      </dl>

      {requests.length > 0 && (
        <section aria-label="기존 정의 수정 요청" className="task-revision-history">
          <h4>기존 요청과 처리 결과</h4>
          <ul>
            {requests.map((request) => (
              <li key={request.id}>
                <strong>{request.handled ? "처리 완료" : "미처리"} · {request.id}</strong>
                <span>요청 {request.createdAt}</span>
                {request.handled && updatedAt && <span>처리 {updatedAt}</span>}
                <p>{request.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {preflight !== null && (
        <details className="task-revision-preflight">
          <summary>범위 사전 검사 근거</summary>
          <MarkdownBody body={preflight} />
        </details>
      )}

      <label htmlFor={`task-revision-reason-${document.summary.id}`}>수정이 필요한 이유</label>
      <textarea
        aria-describedby={`task-revision-count-${document.summary.id}`}
        disabled={busy || submitting}
        id={`task-revision-reason-${document.summary.id}`}
        onChange={(event) => {
          confirm.disarm();
          setFrozen(null);
          setMessage(null);
          setNeedsReload(false);
          setReason(event.target.value);
        }}
        placeholder="현재 범위나 선행 관계에서 무엇을 고쳐야 하는지 적어 주세요."
        value={reason}
      />
      <p id={`task-revision-count-${document.summary.id}`} className={tooLong ? "task-revision-count error" : "task-revision-count"}>
        {reasonLength.toLocaleString()} / 2,000자
      </p>

      {confirm.armed && frozen && (
        <div className="task-revision-confirm" role="status">
          <strong>{frozen.taskId}에 다음 이유를 기록합니다.</strong>
          <span>{frozen.updatedAt}</span>
          <p>{frozen.reason}</p>
        </div>
      )}
      {message && <p className={needsReload ? "task-revision-result error" : "task-revision-result"} role="status">{message}</p>}
      <div className="task-revision-actions">
        <button
          className={`secondary-button ${confirm.armed ? "armed" : ""}`}
          disabled={!canSubmit}
          onClick={confirmRequest}
          type="button"
        >
          {confirm.armed ? "한 번 더 누르면 수정 요청" : "정의 수정 요청 확인"}
        </button>
        {needsReload && (
          <button className="text-button" disabled={busy || submitting} onClick={() => void onReload()} type="button">
            최신 작업 다시 읽기
          </button>
        )}
      </div>
    </section>
  );
}

function statusName(status: string) {
  return relatedTaskStatusLabels[status] ?? status;
}

function dependencyName(state: TaskDependency["state"]) {
  return { satisfied: "충족", pending: "대기", missing: "누락", cyclic: "순환" }[state];
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
