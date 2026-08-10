import type { BlockedReason } from "../domain/documentSections";
import type { WorkflowItemSummary } from "../domain/types";
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
          이 화면은 진행 상태만 보여 줍니다. 막힘 해결과 재개는 에이전트가 처리하며 사용자가 입력하거나
          조작할 내용은 없습니다.
        </p>
      </section>
    </section>
  );
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
