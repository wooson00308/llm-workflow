import { Icon } from "../../../shared/ui/Icon";
import type {
  WorkflowItemSummary,
  WorkflowSummary,
} from "../domain/types";

interface Props {
  focus: "ideas" | "specs" | "tasks";
  workflow: WorkflowSummary;
  onOpenSpec(item: WorkflowItemSummary): void;
}

const statusLabels: Record<string, string> = {
  inbox: "수집됨",
  draft: "작성 중",
  user_review: "선택 대기",
  approved: "승인",
  rejected: "폐기",
  todo: "준비",
  in_progress: "진행 중",
  blocked: "막힘",
  qa_waiting: "QA 대기",
  completed: "완료",
};

export function KanbanBoard({ focus, workflow, onOpenSpec }: Props) {
  return (
    <section className="kanban-view" aria-label="워크플로우 칸반 보드">
      <div className="board-heading">
        <div>
          <p className="eyebrow">WORKFLOW BOARD</p>
          <h1>{workflow.name}</h1>
          <p>외부 LLM이 갱신한 Markdown 상태를 한눈에 확인합니다.</p>
        </div>
        <div className="board-legend">
          <span><i className="legend-dot idea" />아이디어</span>
          <span><i className="legend-dot spec" />기획서</span>
          <span><i className="legend-dot task" />개발</span>
        </div>
      </div>

      <div className="kanban-grid">
        <BoardColumn
          accent="idea"
          description="구체화 전의 생각과 브레인스토밍"
          icon="idea"
          items={workflow.items.ideas}
          focused={focus === "ideas"}
          title="아이디어"
        />
        <BoardColumn
          accent="spec"
          description="요구사항과 기대효과를 담은 승인 문서"
          icon="stamp"
          items={workflow.items.specs}
          focused={focus === "specs"}
          onOpenItem={onOpenSpec}
          title="기획서"
        />
        <BoardColumn
          accent="task"
          description="진행 중 · QA 대기 · 완료 상태의 실행 작업"
          icon="board"
          items={workflow.items.tasks}
          focused={focus === "tasks"}
          title="개발"
        />
      </div>
    </section>
  );
}

function BoardColumn({
  accent,
  description,
  focused,
  icon,
  items,
  onOpenItem,
  title,
}: {
  accent: "idea" | "spec" | "task";
  description: string;
  focused: boolean;
  icon: "idea" | "stamp" | "board";
  items: WorkflowItemSummary[];
  onOpenItem?: (item: WorkflowItemSummary) => void;
  title: string;
}) {
  return (
    <section className={`kanban-column ${accent}${focused ? " focused" : ""}`}>
      <header>
        <span className="column-icon"><Icon name={icon} /></span>
        <div><h2>{title}</h2><p>{description}</p></div>
        <b>{items.length}</b>
      </header>
      <div className="kanban-stack">
        {items.map((item) => {
          const content = (
            <>
              <div className="kanban-card-top">
                <span className={`status-pill status-${item.status}`}>
                  {statusLabels[item.status] ?? item.status}
                </span>
                <small>{item.id}</small>
              </div>
              <strong>{item.title}</strong>
              {item.excerpt && <p>{item.excerpt}</p>}
              <footer>
                <span>{formatDate(item.updatedAt)}</span>
                {onOpenItem && <span className="open-hint">문서 열기 →</span>}
              </footer>
            </>
          );
          return onOpenItem ? (
            <button
              className="kanban-card interactive"
              key={item.fileName}
              onClick={() => onOpenItem(item)}
            >
              {content}
            </button>
          ) : (
            <article className="kanban-card" key={item.fileName}>{content}</article>
          );
        })}
        {items.length === 0 && (
          <div className="column-empty">
            <Icon name={icon} />
            <strong>아직 문서가 없습니다</strong>
            <span>Markdown이 추가되면 자동으로 나타납니다.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function formatDate(value: string | null) {
  if (!value) return "업데이트 시간 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
