import { useMemo, useState } from "react";
import { Icon } from "../../../shared/ui/Icon";
import type { WorkflowItemSummary, WorkflowSummary } from "../domain/types";

const taskColumns = [
  { status: "todo", title: "준비", description: "시작할 수 있는 작업", tone: "neutral" },
  { status: "in_progress", title: "진행 중", description: "LLM이 작업하는 범위", tone: "active" },
  { status: "blocked", title: "막힘", description: "해결이 필요한 장애물", tone: "danger" },
  { status: "qa_waiting", title: "QA 대기", description: "사용자 검증이 필요한 작업", tone: "review" },
  { status: "completed", title: "최근 완료", description: "최근 완료된 작업 3개", tone: "done" },
] as const;

const statusLabels: Record<string, string> = {
  todo: "준비",
  in_progress: "진행 중",
  blocked: "막힘",
  qa_waiting: "QA 대기",
  completed: "완료",
};

const viewModes = [
  { value: "board", label: "보드" },
  { value: "list", label: "리스트" },
  { value: "calendar", label: "캘린더" },
] as const;

type ViewMode = (typeof viewModes)[number]["value"];

export function DevelopmentBoard({ workflow }: { workflow: WorkflowSummary }) {
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [calendarCursor, setCalendarCursor] = useState(() => startOfMonth(new Date()));

  const scopedTasks = useMemo(
    () => tasksForDevelopment(workflow.items.tasks),
    [workflow.items.tasks],
  );
  const filteredTasks = useMemo(
    () => scopedTasks.filter((item) => matchesFilters(item, query, statusFilter)),
    [query, scopedTasks, statusFilter],
  );
  const hasFilters = Boolean(query.trim()) || statusFilter !== "all";

  return (
    <section className="development-view">
      <div className="view-heading development-heading">
        <div><p className="eyebrow">DEVELOPMENT</p><h1>개발 작업</h1><p>작업 흐름을 보드·리스트·일정으로 바꿔 보세요.</p></div>
        <span><strong>{count(workflow.items.tasks, "in_progress")}</strong><small>진행 중</small></span>
      </div>

      <div className="development-toolbar">
        <label className="task-search">
          <span>⌕</span>
          <input
            aria-label="작업 검색"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="작업명, ID, 내용 검색"
            value={query}
          />
        </label>
        <select
          aria-label="상태 필터"
          onChange={(event) => setStatusFilter(event.target.value)}
          value={statusFilter}
        >
          <option value="all">모든 상태</option>
          {taskColumns.map((column) => (
            <option key={column.status} value={column.status}>{column.title}</option>
          ))}
        </select>
        {hasFilters && (
          <button className="filter-reset" onClick={() => { setQuery(""); setStatusFilter("all"); }}>
            필터 초기화
          </button>
        )}
        <div className="view-switcher" aria-label="개발 작업 보기" role="group">
          {viewModes.map((mode) => (
            <button
              aria-pressed={viewMode === mode.value}
              className={viewMode === mode.value ? "active" : ""}
              key={mode.value}
              onClick={() => setViewMode(mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div className="development-summary">
        <span><i className="summary-dot active" />진행 중 {count(workflow.items.tasks, "in_progress")}</span>
        <span><i className="summary-dot danger" />막힘 {count(workflow.items.tasks, "blocked")}</span>
        <span><i className="summary-dot review" />QA 대기 {count(workflow.items.tasks, "qa_waiting")}</span>
        <span className="result-count">{filteredTasks.length}개 표시 · 완료는 최근 3개만 표시</span>
      </div>

      {viewMode === "board" && (
        <BoardView items={filteredTasks} statusFilter={statusFilter} />
      )}
      {viewMode === "list" && <ListView items={filteredTasks} />}
      {viewMode === "calendar" && (
        <CalendarView
          cursor={calendarCursor}
          items={filteredTasks}
          onCursorChange={setCalendarCursor}
        />
      )}
    </section>
  );
}

function BoardView({ items, statusFilter }: { items: WorkflowItemSummary[]; statusFilter: string }) {
  const knownStatuses = new Set<string>(taskColumns.map((column) => column.status));
  const unknown = items.filter((item) => !knownStatuses.has(item.status));
  const columns = statusFilter === "all"
    ? taskColumns
    : taskColumns.filter((column) => column.status === statusFilter);

  return (
    <div className={`task-board columns-${columns.length}`} aria-label="개발 작업 칸반 보드" role="region">
      {columns.map((column) => (
        <TaskColumn
          description={column.description}
          items={items.filter((item) => item.status === column.status)}
          key={column.status}
          title={column.title}
          tone={column.tone}
        />
      ))}
      {statusFilter === "all" && unknown.length > 0 && (
        <TaskColumn description="규격을 확인해야 하는 상태" items={unknown} title="확인 필요" tone="danger" />
      )}
    </div>
  );
}

function ListView({ items }: { items: WorkflowItemSummary[] }) {
  return (
    <div className="task-list" aria-label="개발 작업 리스트" role="region">
      <table>
        <thead><tr><th>작업</th><th>상태</th><th>목표일</th><th>최근 변경</th></tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.fileName}>
              <td><strong>{item.title}</strong><small>{item.id}{item.excerpt ? ` · ${item.excerpt}` : ""}</small></td>
              <td><span className={`status-pill status-${item.status}`}>{statusLabels[item.status] ?? item.status}</span></td>
              <td>{formatDueDate(item.dueAt)}</td>
              <td>{formatDate(item.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <EmptyTasks />}
    </div>
  );
}

function CalendarView({
  cursor,
  items,
  onCursorChange,
}: {
  cursor: Date;
  items: WorkflowItemSummary[];
  onCursorChange(value: Date): void;
}) {
  const days = calendarDays(cursor);
  const today = localDateKey(new Date());
  const scheduled = new Map<string, WorkflowItemSummary[]>();
  const unscheduled: WorkflowItemSummary[] = [];

  for (const item of items) {
    const key = calendarDateKey(item.dueAt);
    if (!key) {
      unscheduled.push(item);
      continue;
    }
    scheduled.set(key, [...(scheduled.get(key) ?? []), item]);
  }

  return (
    <section className="task-calendar" aria-label="개발 작업 캘린더">
      <header>
        <div>
          <button aria-label="이전 달" onClick={() => onCursorChange(addMonths(cursor, -1))}>‹</button>
          <button className="today-button" onClick={() => onCursorChange(startOfMonth(new Date()))}>오늘</button>
          <button aria-label="다음 달" onClick={() => onCursorChange(addMonths(cursor, 1))}>›</button>
        </div>
        <h2>{new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(cursor)}</h2>
        <small><code>due_at</code> 기준</small>
      </header>
      <div className="calendar-weekdays" aria-hidden="true">
        {["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="calendar-grid">
        {days.map((day) => {
          const key = localDateKey(day);
          return (
            <div
              className={`${day.getMonth() === cursor.getMonth() ? "" : "outside"} ${key === today ? "today" : ""}`.trim()}
              key={key}
            >
              <time dateTime={key}>{day.getDate()}</time>
              <div>
                {(scheduled.get(key) ?? []).map((item) => (
                  <article className={`calendar-task status-border-${item.status}`} key={item.fileName} title={item.title}>
                    <span>{item.title}</span><small>{item.id}</small>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <section className="unscheduled-tasks">
        <div><strong>일정 미지정</strong><span>{unscheduled.length}</span><small><code>due_at</code>을 추가하면 캘린더에 배치됩니다.</small></div>
        {unscheduled.length > 0 ? (
          <div>{unscheduled.map((item) => <span key={item.fileName}><b>{item.title}</b><small>{item.id}</small></span>)}</div>
        ) : <p>모든 작업에 목표일이 있습니다.</p>}
      </section>
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
            <footer><Icon name="board" /><span>{item.dueAt ? `목표 ${formatDueDate(item.dueAt)}` : formatDate(item.updatedAt)}</span></footer>
          </article>
        ))}
        {items.length === 0 && <div className="task-column-empty"><span /><small>작업 없음</small></div>}
      </div>
    </section>
  );
}

function EmptyTasks() {
  return <div className="task-list-empty"><strong>조건에 맞는 작업이 없습니다.</strong><small>검색어나 상태 필터를 바꿔 보세요.</small></div>;
}

function tasksForDevelopment(items: WorkflowItemSummary[]) {
  const recentCompleted = [...items]
    .filter((item) => item.status === "completed")
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt) || left.fileName.localeCompare(right.fileName))
    .slice(0, 3);
  const recentFiles = new Set(recentCompleted.map((item) => item.fileName));
  return items.filter((item) => item.status !== "completed" || recentFiles.has(item.fileName));
}

function matchesFilters(item: WorkflowItemSummary, query: string, statusFilter: string) {
  if (statusFilter !== "all" && item.status !== statusFilter) return false;
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  if (!normalized) return true;
  return [item.title, item.id, item.excerpt]
    .join(" ")
    .toLocaleLowerCase("ko-KR")
    .includes(normalized);
}

function count(items: WorkflowItemSummary[], status: string) {
  return items.filter((item) => item.status === status).length;
}

function timestamp(value: string | null) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDate(value: string | null) {
  if (!value) return "업데이트 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDueDate(value: string | null | undefined) {
  const key = calendarDateKey(value);
  if (!key) return "일정 없음";
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", weekday: "short" }).format(new Date(year, month - 1, day));
}

function calendarDateKey(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${yearText}-${monthText}-${dayText}`;
}

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function addMonths(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}

function calendarDays(cursor: Date) {
  const first = startOfMonth(cursor);
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => (
    new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index)
  ));
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
