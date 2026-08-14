import { useMemo, useState } from "react";
import { Icon } from "../../../shared/ui/Icon";
import type {
  TaskDocument,
  WorkGroupDisplayStatus,
  WorkGroupSummary,
  WorkflowItemSummary,
  WorkflowSummary,
} from "../domain/types";
import { browserSpecLaneCollapseStore } from "../infrastructure/browserSpecLaneCollapseStore";

/** 태스크는 AI 실행 단위다. 사용자 QA 상태는 작업 그룹에만 존재한다. */
export const taskColumns = [
  { status: "todo", title: "준비", description: "시작할 수 있는 작업", tone: "neutral" },
  { status: "in_progress", title: "진행 중", description: "LLM이 작업하는 범위", tone: "active" },
  { status: "blocked", title: "막힘", description: "해결이 필요한 장애물", tone: "danger" },
  { status: "verified", title: "AI 검증 완료", description: "구현과 자동검증이 끝난 작업", tone: "done" },
] as const;

/** 작업 상태의 이름. 열 제목(`taskColumns`의 `title`)과 달리 완료를 "최근 완료"로 부르지 않는다. */
export const statusLabels: Record<string, string> = {
  todo: "준비",
  in_progress: "진행 중",
  blocked: "막힘",
  verified: "AI 검증 완료",
};

/** 레인 수치와 신호가 무엇을 센 값인지 밝히는 문장. 레인마다 반복하지 않고 목록 위에 한 번만 둔다. */
const LANE_BASIS_NOTE = "작업 그룹 상태는 전체 태스크와 AI 검증 결과를 기준으로 계산됩니다";

const viewModes = [
  { value: "board", label: "보드" },
  { value: "list", label: "리스트" },
  { value: "calendar", label: "타임라인" },
] as const;

export const eventKinds = [
  { kind: "created", label: "생성" },
  { kind: "in_progress", label: "시작" },
  { kind: "blocked", label: "막힘" },
  { kind: "verified", label: "AI 검증 완료" },
  { kind: "migrated_verified", label: "v2 검증 전환" },
  { kind: "qa_waiting", label: "기존 QA 대기" },
  { kind: "completed", label: "기존 완료" },
  // QA 반려와 사용자 재개는 둘 다 작업을 `todo`로 되돌리지만 서로 다른 사실이라 이름을 나눈다.
  // 하나는 사용자가 결과를 물린 것이고, 다른 하나는 막힌 일을 사용자가 다시 연 것이다.
  { kind: "revision_requested", label: "반려" },
  { kind: "resumed", label: "사용자 재개" },
  { kind: "task_revision_requested", label: "정의 수정 요청" },
  { kind: "task_revision_applied", label: "아키텍트 수정" },
] as const;

type ViewMode = (typeof viewModes)[number]["value"];

interface Props {
  onReadTask(fileName: string): Promise<TaskDocument | null>;
  workflow: WorkflowSummary;
}

export function DevelopmentBoard({ onReadTask, workflow }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [laneGrouping, setLaneGrouping] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [calendarCursor, setCalendarCursor] = useState(() => startOfMonth(new Date()));
  const [taskDocument, setTaskDocument] = useState<TaskDocument | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  // 게으른 초기화라 렌더마다 저장소를 읽지 않는다.
  const [laneCollapsed, setLaneCollapsed] = useState(() => browserSpecLaneCollapseStore.load(workflow.directory));
  const [collapseDirectory, setCollapseDirectory] = useState(workflow.directory);

  // `WorkspaceShell`이 이 컴포넌트에는 `key`를 주지 않아(`IdeaInbox`와 다르다) 워크플로가 바뀌어도
  // 마운트가 유지된다. 그래서 디렉터리가 바뀌면 그 워크플로의 접힘을 여기서 다시 읽는다.
  // `CalendarView`의 `selectedMonth` 비교와 같은 어법이다.
  if (collapseDirectory !== workflow.directory) {
    setCollapseDirectory(workflow.directory);
    setLaneCollapsed(browserSpecLaneCollapseStore.load(workflow.directory));
  }

  const scopedTasks = useMemo(
    () => tasksForDevelopment(workflow.items.tasks),
    [workflow.items.tasks],
  );
  const filteredTasks = useMemo(
    () => scopedTasks.filter((item) => matchesFilters(item, query, statusFilter)),
    [query, scopedTasks, statusFilter],
  );
  const timelineTasks = useMemo(
    () => workflow.items.tasks.filter((item) => matchesFilters(item, query, statusFilter)),
    [query, statusFilter, workflow.items.tasks],
  );
  const hasFilters = Boolean(query.trim()) || statusFilter !== "all";
  const boardResultCount = filteredTasks.length;

  /**
   * 레인 하나의 접힘을 뒤집고 같은 자리에서 저장한다(`applyPanelWidth`와 같은 어법).
   *
   * 지금 목록에 없는 레인의 저장값은 그대로 둔다. 카드가 없어 빠졌던 레인이 돌아왔을 때 접힘이
   * 남아 있어야 한다(SPEC-029 확인 필요 3번의 비용 항목).
   */
  function toggleLaneCollapsed(key: string) {
    const next = { ...laneCollapsed, [key]: !laneCollapsed[key] };
    setLaneCollapsed(next);
    browserSpecLaneCollapseStore.save(workflow.directory, next);
  }

  async function openTask(fileName: string) {
    setTaskLoading(true);
    const document = await onReadTask(fileName);
    if (document) setTaskDocument(document);
    setTaskLoading(false);
  }

  if (taskDocument) {
    const workGroup = matchingWorkGroup(taskDocument.summary, workflow.items.workGroups);
    return (
      <TaskDetail
        document={taskDocument}
        group={workGroup}
        onBack={() => setTaskDocument(null)}
      />
    );
  }

  return (
    <section className="development-view">
      <div className="view-heading development-heading">
        <div><p className="eyebrow">DEVELOPMENT</p><h1>개발 작업</h1><p>작업 흐름을 보드·리스트·타임라인으로 바꿔 보세요.</p></div>
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
        <span><i className="summary-dot review" />AI 검증 완료 {count(workflow.items.tasks, "verified")}</span>
        <span className="result-count">
          {viewMode === "calendar"
            ? `${timelineTasks.length}개 표시 · 전체 이력 표시`
            : `${viewMode === "board" ? boardResultCount : filteredTasks.length}개 표시`}
        </span>
      </div>

      {taskLoading && <div className="loading-toast">개발 작업을 불러오는 중…</div>}

      {viewMode === "board" && (
        <>
          <div className="task-lane-controls">
            <button onClick={() => setLaneGrouping((value) => !value)}>
              {laneGrouping ? "평면 태스크 보기" : "작업 그룹별 보기"}
            </button>
          </div>
          {laneGrouping ? (
            <WorkGroupLaneBoard
              allTasks={workflow.items.tasks}
              collapsed={laneCollapsed}
              groups={workflow.items.workGroups}
              hasFilters={hasFilters}
              onOpen={(item) => void openTask(item.fileName)}
              onToggleCollapsed={toggleLaneCollapsed}
              statusFilter={statusFilter}
              visibleTasks={filteredTasks}
            />
          ) : (
            <BoardView
              items={filteredTasks}
              onOpen={(item) => void openTask(item.fileName)}
              statusFilter={statusFilter}
            />
          )}
        </>
      )}
      {viewMode === "list" && <ListView items={filteredTasks} onOpen={(item) => void openTask(item.fileName)} />}
      {viewMode === "calendar" && (
        <CalendarView
          cursor={calendarCursor}
          hasFilters={hasFilters}
          items={timelineTasks}
          onCursorChange={setCalendarCursor}
          onOpen={(item) => void openTask(item.fileName)}
        />
      )}
    </section>
  );
}

function TaskDetail({ document, group, onBack }: {
  document: TaskDocument;
  group: WorkGroupSummary | null;
  onBack(): void;
}) {
  const state = taskVerificationState(document.summary.status);
  return (
    <section className="task-detail-view">
      <button className="text-button task-detail-back" onClick={onBack}>← 개발 작업으로</button>
      <div className="view-heading task-detail-heading">
        <div><p className="eyebrow">{document.summary.id}</p><h1>{document.summary.title}</h1><p>AI가 맡은 구현 단위의 현재 상태입니다.</p></div>
        <span className={`status-pill status-${document.summary.status}`}>{state.label}</span>
      </div>
      <div className="task-detail-overview">
        <section aria-label="AI 자동검증 상태" className={`task-detail-summary task-detail-summary-${document.summary.status}`}>
          <Icon name={document.summary.status === "verified" ? "stamp" : "board"} />
          <div><p className="eyebrow">AI VERIFICATION</p><h2>{state.heading}</h2><p>{state.description}</p></div>
        </section>
        <section aria-label="소속 작업 그룹" className={`task-detail-group ${group ? "" : "needs-attention"}`}>
          <p className="eyebrow">WORK GROUP</p>
          {group ? (
            <>
              <div className="task-detail-group-heading">
                <h2>{group.title}</h2>
                <span className={`task-lane-signal group-status-${group.displayStatus}`}>{workGroupStatusLabel(group.displayStatus)}</span>
              </div>
              <dl>
                <div><dt>그룹 ID</dt><dd>{group.id}</dd></div>
                <div><dt>구성 버전</dt><dd>{group.revision}</dd></div>
              </dl>
            </>
          ) : (
            <div className="task-detail-group-missing">
              <h2>소속 그룹 확인 필요</h2>
              <p>이 작업과 연결된 작업 그룹 정보를 확인할 수 없습니다. AI가 구성을 다시 확인합니다.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function taskVerificationState(status: string) {
  return {
    todo: {
      label: "준비",
      heading: "AI 작업 준비 중",
      description: "AI가 아직 이 작업을 시작하지 않았습니다. 차례가 되면 구현과 자동검증을 함께 진행합니다.",
    },
    in_progress: {
      label: "진행 중",
      heading: "AI가 작업하고 있습니다",
      description: "AI가 기능을 구현하고 내부 자동검증을 진행하고 있습니다. 사용자가 따로 실행할 절차는 없습니다.",
    },
    blocked: {
      label: "막힘",
      heading: "AI 작업이 잠시 멈췄습니다",
      description: "AI가 원인을 정리하고 다시 진행할 준비를 하고 있습니다. 내부 확인과 복구는 AI가 맡습니다.",
    },
    verified: {
      label: "AI 검증 완료",
      heading: "구현과 자동검증을 마쳤습니다",
      description: "AI의 내부 검증이 끝났습니다. 사용자 확인이 필요한 경우에는 작업 그룹 전체가 품질 확인에 올라옵니다.",
    },
  }[status] ?? {
    label: "상태 확인 필요",
    heading: "AI 검증 상태를 확인하고 있습니다",
    description: "현재 상태를 일반적인 작업 단계로 읽을 수 없습니다. AI가 작업 기록을 다시 확인합니다.",
  };
}

function matchingWorkGroup(task: WorkflowItemSummary, groups: WorkGroupSummary[]) {
  const group = groups.find((candidate) => candidate.id === task.workGroupId);
  const revision = task.workGroupRevision;
  if (!group || revision === null || revision === undefined || revision < 1 || revision > group.revision) return null;
  if (task.sourceSpecId !== group.sourceSpecId || task.sourceDecisionId !== group.sourceDecisionId) return null;
  return group;
}

function BoardView({
  items,
  label = "개발 작업 칸반 보드",
  onOpen,
  statusFilter,
}: {
  items: WorkflowItemSummary[];
  /** region 이름. 레인 수만큼 보드가 생길 때 같은 이름이 겹치지 않게 레인이 갈아 끼운다. */
  label?: string;
  onOpen(item: WorkflowItemSummary): void;
  statusFilter: string;
}) {
  const knownStatuses = new Set<string>(taskColumns.map((column) => column.status));
  const unknown = items.filter((item) => !knownStatuses.has(item.status));
  const columns = statusFilter === "all"
    ? taskColumns
    : taskColumns.filter((column) => column.status === statusFilter);

  return (
    <div className={`task-board columns-${columns.length}`} aria-label={label} role="region">
      {columns.map((column) => (
        <TaskColumn
          description={column.description}
          items={items.filter((item) => item.status === column.status)}
          key={column.status}
          onOpen={onOpen}
          title={column.title}
          tone={column.tone}
        />
      ))}
      {statusFilter === "all" && unknown.length > 0 && (
        <TaskColumn description="규격을 확인해야 하는 상태" items={unknown} onOpen={onOpen} title="확인 필요" tone="danger" />
      )}
    </div>
  );
}

/** 작업 그룹 문서가 레인의 정본이고, 태스크는 `workGroupId`로 그 안에 들어간다. */
function WorkGroupLaneBoard({
  allTasks,
  collapsed,
  groups,
  hasFilters,
  onOpen,
  onToggleCollapsed,
  statusFilter,
  visibleTasks,
}: {
  allTasks: WorkflowItemSummary[];
  collapsed: Record<string, boolean>;
  groups: WorkGroupSummary[];
  hasFilters: boolean;
  onOpen(item: WorkflowItemSummary): void;
  onToggleCollapsed(key: string): void;
  statusFilter: string;
  visibleTasks: WorkflowItemSummary[];
}) {
  const lanes = useMemo(() => buildWorkGroupLanes(groups, allTasks, visibleTasks, hasFilters), [allTasks, groups, hasFilters, visibleTasks]);

  return (
    <>
      <p className="task-lane-note">{LANE_BASIS_NOTE}</p>
      {lanes.map((lane) => {
        const laneCollapsed = collapsed[lane.group.id] ?? false;
        return (
          <section className={laneCollapsed ? "task-lane collapsed" : "task-lane"} key={lane.group.id}>
            <header className="task-lane-header">
              <div className="task-lane-identity">
                <strong>{lane.group.title}</strong>
                <small>{lane.group.id} · 구성 버전 {lane.group.revision}</small>
              </div>
              <p className="task-lane-counts">
                <span>AI 검증 완료 {lane.counts.verified} / {lane.total}</span>
              </p>
              <span className={`task-lane-signal group-status-${lane.group.displayStatus}`}>
                {workGroupStatusLabel(lane.group.displayStatus)}
              </span>
              <button
                aria-expanded={!laneCollapsed}
                aria-label={`${lane.group.id} 레인 ${laneCollapsed ? "펼치기" : "접기"}`}
                className="task-lane-toggle"
                onClick={() => onToggleCollapsed(lane.group.id)}
                type="button"
              >
                {laneCollapsed ? "펼치기" : "접기"}
              </button>
            </header>
            {!laneCollapsed && (
              <div className="task-lane-scroll">
                {lane.items.length > 0 ? (
                  <BoardView items={lane.items} label={`${lane.group.id} 칸반 보드`} onOpen={onOpen} statusFilter={statusFilter} />
                ) : (
                  <div className="task-list-empty">
                    <strong>{lane.group.status === "preparing" ? "아키텍트가 작업 구성을 작성 중입니다." : "표시할 태스크가 없습니다."}</strong>
                    <small>{lane.group.status === "preparing" ? "구성이 확정되면 이 그룹에 태스크가 나타납니다." : "검색어나 상태 필터를 바꿔 보세요."}</small>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
      {lanes.length === 0 && <EmptyTasks />}
    </>
  );
}

interface WorkGroupLane {
  group: WorkGroupSummary;
  counts: Record<string, number>;
  unknownCount: number;
  total: number;
  items: WorkflowItemSummary[];
}

function buildWorkGroupLanes(
  groups: WorkGroupSummary[],
  allTasks: WorkflowItemSummary[],
  visibleTasks: WorkflowItemSummary[],
  hasFilters: boolean,
): WorkGroupLane[] {
  const knownStatuses = new Set<string>(taskColumns.map((column) => column.status));
  const lanes = groups.map((group) => {
    const all = allTasks.filter((task) => task.workGroupId === group.id);
    const items = visibleTasks.filter((task) => task.workGroupId === group.id);
    return {
      group,
      counts: Object.fromEntries(taskColumns.map((column) => [column.status, all.filter((task) => task.status === column.status).length])),
      unknownCount: all.filter((task) => !knownStatuses.has(task.status)).length,
      total: all.length,
      items,
    };
  }).filter((lane) => !hasFilters || lane.items.length > 0);

  return lanes.sort((left, right) => {
    const priority = workGroupStatusPriority(left.group.displayStatus) - workGroupStatusPriority(right.group.displayStatus);
    return priority || left.group.id.localeCompare(right.group.id, "ko", { numeric: true });
  });
}

function workGroupStatusPriority(status: WorkGroupDisplayStatus) {
  return ["rework", "preparing_stalled", "configuration_error", "blocked", "preparing", "developing", "qa_ready", "automatic_completed", "completed"].indexOf(status);
}

function workGroupStatusLabel(status: WorkGroupDisplayStatus) {
  return {
    completed: "완료",
    rework: "아키텍트 재분류 대기",
    preparing: "아키텍트 구성 중",
    preparing_stalled: "구성 중단 의심",
    blocked: "개발 막힘",
    developing: "개발 중",
    qa_ready: "사용자 QA 대기",
    automatic_completed: "AI 검증 완료",
    configuration_error: "구성 확인 필요",
  }[status];
}

function ListView({ items, onOpen }: { items: WorkflowItemSummary[]; onOpen(item: WorkflowItemSummary): void }) {
  return (
    <div className="task-list" aria-label="개발 작업 리스트" role="region">
      <table>
        <thead><tr><th>작업</th><th>상태</th><th>목표일</th><th>최근 변경</th></tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.fileName}>
              <td><button className="task-row-open" onClick={() => onOpen(item)}><strong>{item.title}</strong><small>{item.id}</small></button></td>
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
  hasFilters,
  items,
  onCursorChange,
  onOpen,
}: {
  cursor: Date;
  hasFilters: boolean;
  items: WorkflowItemSummary[];
  onCursorChange(value: Date): void;
  onOpen(item: WorkflowItemSummary): void;
}) {
  const monthKey = `${cursor.getFullYear()}-${cursor.getMonth()}`;
  const [selectedMonth, setSelectedMonth] = useState(monthKey);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  if (selectedMonth !== monthKey) {
    setSelectedMonth(monthKey);
    setSelectedDate(null);
  }

  const days = calendarDays(cursor);
  const today = localDateKey(new Date());
  const eventsByDate = groupEventsByDate(items);
  const monthEventCount = days
    .filter((day) => day.getMonth() === cursor.getMonth())
    .reduce((total, day) => total + (eventsByDate.get(localDateKey(day))?.length ?? 0), 0);
  const unrecorded = items.filter((item) => timelineEvents(item).length === 0).length;
  const selectedEvents = selectedDate
    ? [...(eventsByDate.get(selectedDate) ?? [])].sort((left, right) => timestamp(left.at) - timestamp(right.at))
    : [];

  return (
    <section className="task-calendar" aria-label="개발 작업 타임라인">
      <header>
        <div>
          <button aria-label="이전 달" onClick={() => onCursorChange(addMonths(cursor, -1))}>‹</button>
          <button className="today-button" onClick={() => onCursorChange(startOfMonth(new Date()))}>오늘</button>
          <button aria-label="다음 달" onClick={() => onCursorChange(addMonths(cursor, 1))}>›</button>
        </div>
        <h2>{new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(cursor)}</h2>
        <small>상태 전이 기록 기준</small>
      </header>
      <div className="calendar-weekdays" aria-hidden="true">
        {["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="calendar-grid">
        {days.map((day) => {
          const key = localDateKey(day);
          const events = eventsByDate.get(key) ?? [];
          const className = `${day.getMonth() === cursor.getMonth() ? "" : "outside"} ${key === today ? "today" : ""}`.trim();
          const content = (
            <>
              <time dateTime={key}>{day.getDate()}</time>
              <div>
                {countEventKinds(events).map((entry) => (
                  <span className={`calendar-count event-${entry.kind}`} key={entry.kind}>
                    <span>{entry.label}</span><b>{entry.count}</b>
                  </span>
                ))}
              </div>
            </>
          );
          if (events.length === 0) return <div className={className} key={key}>{content}</div>;
          return (
            <button
              aria-label={`${formatDayLabel(day)}, 이벤트 ${events.length}건`}
              aria-pressed={selectedDate === key}
              className={className}
              key={key}
              onClick={() => setSelectedDate(selectedDate === key ? null : key)}
            >
              {content}
            </button>
          );
        })}
      </div>
      {monthEventCount === 0 && (
        <p className="calendar-notice">
          {hasFilters ? "필터 조건에 맞는 기록이 이 달에 없습니다." : "이 달에 기록된 전이가 없습니다."}
        </p>
      )}
      {selectedDate && (
        <div className="calendar-day-panel">
          <header>
            <strong>{formatDayLabel(dateFromKey(selectedDate))}</strong>
            <span>이벤트 {selectedEvents.length}건</span>
            <button className="text-button" onClick={() => setSelectedDate(null)}>닫기</button>
          </header>
          {selectedEvents.length === 0 ? (
            <p className="calendar-notice">이 날짜에 표시할 이벤트가 없습니다.</p>
          ) : (
            <ul>
              {selectedEvents.map((event, index) => (
                <li key={`${event.item.fileName}:${event.kind}:${event.at}:${index}`}>
                  <button onClick={() => onOpen(event.item)}>
                    <time dateTime={event.at}>{formatEventTime(event.at)}</time>
                    <span className={`calendar-count event-${event.kind}`}><span>{eventKindLabels.get(event.kind)}</span></span>
                    <small>{event.item.id}</small>
                    <strong>{event.item.title}</strong>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {unrecorded > 0 && (
        <p className="calendar-notice">기록이 없어 타임라인에 표시되지 않는 작업 {unrecorded}건</p>
      )}
    </section>
  );
}

function TaskColumn({
  description,
  items,
  onOpen,
  title,
  tone,
}: {
  description: string;
  items: WorkflowItemSummary[];
  onOpen(item: WorkflowItemSummary): void;
  title: string;
  tone: "neutral" | "active" | "danger" | "review" | "done";
}) {
  return (
    <section className={`task-column tone-${tone}`}>
      <header><div><strong>{title}</strong><small>{description}</small></div><span>{items.length}</span></header>
      <div className="task-stack">
        {items.map((item) => <TaskCard item={item} key={item.fileName} onOpen={onOpen} />)}
        {items.length === 0 && <div className="task-column-empty"><span /><small>작업 없음</small></div>}
      </div>
    </section>
  );
}

function TaskCard({ item, onOpen }: { item: WorkflowItemSummary; onOpen(item: WorkflowItemSummary): void }) {
  return (
    <button className="task-card" onClick={() => onOpen(item)}>
      <div><span className={`status-pill status-${item.status}`}>{statusLabels[item.status] ?? item.status}</span><small>{item.id}</small></div>
      <strong>{item.title}</strong>
      <footer><Icon name="board" /><span>{item.dueAt ? `목표 ${formatDueDate(item.dueAt)}` : formatDate(item.updatedAt)}</span></footer>
    </button>
  );
}

function EmptyTasks() {
  return <div className="task-list-empty"><strong>조건에 맞는 작업이 없습니다.</strong><small>검색어나 상태 필터를 바꿔 보세요.</small></div>;
}

function tasksForDevelopment(items: WorkflowItemSummary[]) {
  return items;
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

interface TimelineEvent {
  at: string;
  dateKey: string;
  kind: string;
  item: WorkflowItemSummary;
}

const eventKindLabels = new Map<string, string>(eventKinds.map((entry) => [entry.kind, entry.label]));

/** 타임라인이 사실로 다루는 이벤트만 남긴다. 시각을 읽을 수 없거나 모르는 종류는 집계·건수·상세에서 모두 빠진다. */
function timelineEvents(item: WorkflowItemSummary): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const event of item.events ?? []) {
    if (!eventKindLabels.has(event.kind)) continue;
    const dateKey = eventDateKey(event.at);
    if (!dateKey) continue;
    events.push({ at: event.at, dateKey, kind: event.kind, item });
  }
  return events;
}

function groupEventsByDate(items: WorkflowItemSummary[]) {
  const grouped = new Map<string, TimelineEvent[]>();
  for (const item of items) {
    for (const event of timelineEvents(item)) {
      grouped.set(event.dateKey, [...(grouped.get(event.dateKey) ?? []), event]);
    }
  }
  return grouped;
}

function countEventKinds(events: TimelineEvent[]) {
  return eventKinds
    .map((entry) => ({ ...entry, count: events.filter((event) => event.kind === entry.kind).length }))
    .filter((entry) => entry.count > 0);
}

function formatDayLabel(value: Date) {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(value);
}

function formatEventTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function eventDateKey(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : localDateKey(parsed);
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
