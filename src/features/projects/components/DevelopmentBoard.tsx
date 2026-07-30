import { Icon } from "../../../shared/ui/Icon";
import type { WorkflowItemSummary, WorkflowSummary } from "../domain/types";

const taskColumns = [
  { status: "todo", title: "준비", description: "시작할 수 있는 작업", tone: "neutral" },
  { status: "in_progress", title: "진행 중", description: "LLM이 작업하는 범위", tone: "active" },
  { status: "blocked", title: "막힘", description: "해결이 필요한 장애물", tone: "danger" },
  { status: "qa_waiting", title: "QA 대기", description: "사용자 검증이 필요한 작업", tone: "review" },
  { status: "completed", title: "완료", description: "QA까지 끝난 작업", tone: "done" },
] as const;

const statusLabels: Record<string, string> = {
  todo: "준비",
  in_progress: "진행 중",
  blocked: "막힘",
  qa_waiting: "QA 대기",
  completed: "완료",
};

export function DevelopmentBoard({ workflow }: { workflow: WorkflowSummary }) {
  const knownStatuses = new Set<string>(taskColumns.map((column) => column.status));
  const unknown = workflow.items.tasks.filter((item) => !knownStatuses.has(item.status));

  return (
    <section className="development-view">
      <div className="view-heading development-heading">
        <div><p className="eyebrow">DEVELOPMENT BOARD</p><h1>개발 작업</h1><p>같은 작업이 준비부터 사용자 QA까지 이동하는 실제 상태 보드입니다.</p></div>
        <span><strong>{workflow.items.tasks.filter((item) => item.status === "in_progress").length}</strong><small>진행 중</small></span>
      </div>

      <div className="development-summary">
        <span><i className="summary-dot active" />진행 중 {count(workflow.items.tasks, "in_progress")}</span>
        <span><i className="summary-dot danger" />막힘 {count(workflow.items.tasks, "blocked")}</span>
        <span><i className="summary-dot review" />QA 대기 {count(workflow.items.tasks, "qa_waiting")}</span>
      </div>

      <div className="task-board" aria-label="개발 작업 칸반 보드" role="region">
        {taskColumns.map((column) => (
          <TaskColumn
            description={column.description}
            items={workflow.items.tasks.filter((item) => item.status === column.status)}
            key={column.status}
            title={column.title}
            tone={column.tone}
          />
        ))}
        {unknown.length > 0 && <TaskColumn description="규격을 확인해야 하는 상태" items={unknown} title="확인 필요" tone="danger" />}
      </div>
    </section>
  );
}

function TaskColumn({
  description,
  items,
  title,
  tone,
}: {
  description: string;
  items: WorkflowItemSummary[];
  title: string;
  tone: "neutral" | "active" | "danger" | "review" | "done";
}) {
  return (
    <section className={`task-column tone-${tone}`}>
      <header><div><strong>{title}</strong><small>{description}</small></div><span>{items.length}</span></header>
      <div className="task-stack">
        {items.map((item) => (
          <article className="task-card" key={item.fileName}>
            <div><span className={`status-pill status-${item.status}`}>{statusLabels[item.status] ?? item.status}</span><small>{item.id}</small></div>
            <strong>{item.title}</strong>
            {item.excerpt && <p>{item.excerpt}</p>}
            <footer><Icon name="board" /><span>{formatDate(item.updatedAt)}</span></footer>
          </article>
        ))}
        {items.length === 0 && <div className="task-column-empty"><span /><small>작업 없음</small></div>}
      </div>
    </section>
  );
}

function count(items: WorkflowItemSummary[], status: string) {
  return items.filter((item) => item.status === status).length;
}

function formatDate(value: string | null) {
  if (!value) return "업데이트 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
