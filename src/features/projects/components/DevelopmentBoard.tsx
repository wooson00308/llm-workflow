import { useMemo, useState } from "react";
import { Icon } from "../../../shared/ui/Icon";
import { useArmedConfirm } from "../../../shared/ui/useArmedConfirm";
import type { TaskDependency, TaskDocument, TaskQaOutcome, WorkflowItemSummary, WorkflowSummary } from "../domain/types";
import { MarkdownBody } from "./MarkdownBody";

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

const dependencyLabels: Record<string, string> = {
  satisfied: "준비됨",
  pending: "대기 중",
  missing: "없는 작업",
  cyclic: "순환 선언",
};

/** 기다려도 풀리지 않는 판정. `pending`과 달리 사람이 선언을 고쳐야 한다. */
const permanentDependencyStates = new Set(["missing", "cyclic"]);

const PERMANENT_DEPENDENCY_NOTE =
  "이 선언은 시간이 지나도 풀리지 않습니다. 작업 문서의 선행 선언을 고쳐야 합니다.";

/** 미분류 레인의 키. 기획서 문서 id에 `#`이 들어가는 경로가 없어 실제 id와 충돌하지 않는다. */
const UNASSIGNED_LANE_KEY = "#unassigned";

const UNASSIGNED_LANE_TITLE = "미분류";

/** 레인 수치와 신호가 무엇을 센 값인지 밝히는 문장. 레인마다 반복하지 않고 목록 위에 한 번만 둔다. */
const LANE_BASIS_NOTE = "레인의 수치와 QA 신호는 필터·완료 절단 이전의 전체 작업을 셉니다";

/** 앞부분이 집계 사실이고 뒷부분이 그 사실의 뜻이다. 판정이 아니라 집계라는 것을 문구가 말한다. */
const LANE_SIGNAL_LABEL = "QA 대기만 남음 · 통째로 QA 가능";

const viewModes = [
  { value: "board", label: "보드" },
  { value: "list", label: "리스트" },
  { value: "calendar", label: "타임라인" },
] as const;

export const eventKinds = [
  { kind: "created", label: "생성" },
  { kind: "in_progress", label: "시작" },
  { kind: "blocked", label: "막힘" },
  { kind: "qa_waiting", label: "QA 대기" },
  { kind: "completed", label: "완료" },
  { kind: "revision_requested", label: "반려" },
] as const;

type ViewMode = (typeof viewModes)[number]["value"];

interface Props {
  busy: boolean;
  onReadTask(fileName: string): Promise<TaskDocument | null>;
  onTaskQa(fileName: string, outcome: TaskQaOutcome, comment: string): Promise<boolean>;
  workflow: WorkflowSummary;
}

export function DevelopmentBoard({ busy, onReadTask, onTaskQa, workflow }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [laneGrouping, setLaneGrouping] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [calendarCursor, setCalendarCursor] = useState(() => startOfMonth(new Date()));
  const [taskDocument, setTaskDocument] = useState<TaskDocument | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);

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

  async function openTask(item: WorkflowItemSummary) {
    setTaskLoading(true);
    const document = await onReadTask(item.fileName);
    if (document) setTaskDocument(document);
    setTaskLoading(false);
  }

  if (taskDocument) {
    return (
      <TaskDetail
        busy={busy}
        document={taskDocument}
        onBack={() => setTaskDocument(null)}
        onTaskQa={async (outcome, comment) => {
          const succeeded = await onTaskQa(taskDocument.summary.fileName, outcome, comment);
          if (succeeded) setTaskDocument(null);
          return succeeded;
        }}
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
        <span><i className="summary-dot review" />QA 대기 {count(workflow.items.tasks, "qa_waiting")}</span>
        <span className="result-count">
          {viewMode === "calendar"
            ? `${timelineTasks.length}개 표시 · 완료 작업까지 전부 표시`
            : `${filteredTasks.length}개 표시 · 완료는 최근 3개만 표시`}
        </span>
      </div>

      {taskLoading && <div className="loading-toast">개발 작업을 불러오는 중…</div>}

      {viewMode === "board" && (
        <>
          <div className="task-lane-controls">
            <button aria-pressed={laneGrouping} onClick={() => setLaneGrouping((value) => !value)}>
              기획서별 묶기
            </button>
          </div>
          {laneGrouping ? (
            <SpecLaneBoard
              allTasks={workflow.items.tasks}
              hasFilters={hasFilters}
              onOpen={(item) => void openTask(item)}
              specs={workflow.items.specs}
              statusFilter={statusFilter}
              visibleTasks={filteredTasks}
            />
          ) : (
            <BoardView items={filteredTasks} onOpen={(item) => void openTask(item)} statusFilter={statusFilter} />
          )}
        </>
      )}
      {viewMode === "list" && <ListView items={filteredTasks} onOpen={(item) => void openTask(item)} />}
      {viewMode === "calendar" && (
        <CalendarView
          cursor={calendarCursor}
          hasFilters={hasFilters}
          items={timelineTasks}
          onCursorChange={setCalendarCursor}
          onOpen={(item) => void openTask(item)}
        />
      )}
    </section>
  );
}

const QA_PANEL_WIDTH_KEY = "llm-workflow.task-qa-panel-width";
const QA_PANEL_DEFAULT_WIDTH = 340;
const QA_PANEL_MIN_WIDTH = 280;
const QA_PANEL_MAX_WIDTH = 600;

function clampQaPanelWidth(value: number) {
  return Math.min(QA_PANEL_MAX_WIDTH, Math.max(QA_PANEL_MIN_WIDTH, value));
}

function loadQaPanelWidth() {
  try {
    const stored = Number(localStorage.getItem(QA_PANEL_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampQaPanelWidth(stored) : QA_PANEL_DEFAULT_WIDTH;
  } catch {
    return QA_PANEL_DEFAULT_WIDTH;
  }
}

function saveQaPanelWidth(value: number) {
  try {
    localStorage.setItem(QA_PANEL_WIDTH_KEY, String(value));
  } catch {
    return;
  }
}

function TaskDetail({
  busy,
  document,
  onBack,
  onTaskQa,
}: {
  busy: boolean;
  document: TaskDocument;
  onBack(): void;
  onTaskQa(outcome: TaskQaOutcome, comment: string): Promise<boolean>;
}) {
  const [comment, setComment] = useState("");
  const [panelWidth, setPanelWidth] = useState(loadQaPanelWidth);
  const [resizing, setResizing] = useState(false);
  const confirmQa = useArmedConfirm();
  const revisionQa = useArmedConfirm();
  const awaitingQa = document.summary.status === "qa_waiting";

  function applyPanelWidth(value: number) {
    const next = clampQaPanelWidth(value);
    setPanelWidth(next);
    saveQaPanelWidth(next);
  }

  function startPanelResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = panelWidth;
    setResizing(true);
    handle.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      setPanelWidth(clampQaPanelWidth(startWidth + (startX - move.clientX)));
    };
    const onUp = (up: PointerEvent) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      setResizing(false);
      applyPanelWidth(startWidth + (startX - up.clientX));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  function resizePanelByKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === "ArrowLeft" ? 24 : event.key === "ArrowRight" ? -24 : null;
    if (delta === null) return;
    event.preventDefault();
    applyPanelWidth(panelWidth + delta);
  }

  return (
    <section className="task-detail-view">
      <button className="text-button task-detail-back" onClick={onBack}>← 개발 작업으로</button>
      <div className="view-heading task-detail-heading">
        <div><p className="eyebrow">{document.summary.id}</p><h1>{document.summary.title}</h1><p>개발 작업의 범위와 검증 내용을 확인합니다.</p></div>
        <span className={`status-pill status-${document.summary.status}`}>{statusLabels[document.summary.status] ?? document.summary.status}</span>
      </div>
      <div
        className={`task-detail-layout ${resizing ? "resizing" : ""}`}
        style={{ "--qa-panel-width": `${panelWidth}px` } as React.CSSProperties}
      >
        <article className="task-detail-document">
          <div className="task-detail-meta"><span>최근 변경 {formatDate(document.summary.updatedAt)}</span><span>{document.summary.dueAt ? `목표 ${formatDueDate(document.summary.dueAt)}` : "일정 없음"}</span></div>
          <TaskDependencies
            dependencies={document.dependencies ?? []}
            formatError={document.dependencyFormatError ?? false}
          />
          <div className="spec-paper embedded"><MarkdownBody body={document.body} /></div>
        </article>
        <aside className="task-qa-panel">
          <div
            aria-label="QA 패널 너비 조절"
            aria-orientation="vertical"
            aria-valuemax={QA_PANEL_MAX_WIDTH}
            aria-valuemin={QA_PANEL_MIN_WIDTH}
            aria-valuenow={panelWidth}
            className="qa-panel-resize"
            onDoubleClick={() => applyPanelWidth(QA_PANEL_DEFAULT_WIDTH)}
            onKeyDown={resizePanelByKey}
            onPointerDown={startPanelResize}
            role="separator"
            tabIndex={0}
            title="드래그로 너비 조절 · 더블클릭으로 초기화"
          />
          <p className="eyebrow">USER QA</p>
          <h2>{awaitingQa ? "직접 확인해 주세요" : "현재 작업 상태"}</h2>
          {awaitingQa ? (
            <>
              <p>테스트한 순서와 결과를 남기면 완료 기록 또는 개발자 재작업 지시로 전달됩니다.</p>
              <label htmlFor="task-qa-comment">테스트 플로우와 확인 메모</label>
              <textarea
                autoFocus
                id="task-qa-comment"
                maxLength={2_000}
                onChange={(event) => {
                  confirmQa.disarm();
                  revisionQa.disarm();
                  setComment(event.target.value);
                }}
                placeholder={"1. 실행한 동작\n2. 확인한 결과\n3. 기대와 다른 점"}
                value={comment}
              />
              {confirmQa.armed && (
                <p className="confirm-warning" role="status">이 작업을 완료 처리합니다. 되돌릴 수 없습니다.</p>
              )}
              {revisionQa.armed && (
                <p className="confirm-warning" role="status">작업을 개발 준비로 되돌리고 수정 요청을 기록합니다.</p>
              )}
              <div className="task-qa-actions">
                <button
                  className={`secondary-button ${revisionQa.armed ? "armed" : ""}`}
                  disabled={busy || !comment.trim()}
                  onClick={() => {
                    confirmQa.disarm();
                    revisionQa.fire(() => void onTaskQa("revision_requested", comment.trim()));
                  }}
                >
                  {revisionQa.armed ? "한 번 더 누르면 수정 요청" : "수정 요청"}
                  {revisionQa.armed && <i aria-hidden="true" className="confirm-timer" />}
                </button>
                <button
                  className={`stamp-button ${confirmQa.armed ? "armed" : ""}`}
                  disabled={busy}
                  onClick={() => {
                    revisionQa.disarm();
                    confirmQa.fire(() => void onTaskQa("confirmed", comment.trim()));
                  }}
                >
                  {confirmQa.armed ? "한 번 더 누르면 완료" : "확인 완료"}
                  {confirmQa.armed && <i aria-hidden="true" className="confirm-timer" />}
                </button>
              </div>
            </>
          ) : (
            <div className={`decision-result ${document.summary.status === "completed" ? "approved" : ""}`}>
              <Icon name={document.summary.status === "completed" ? "stamp" : "board"} />
              <strong>{statusLabels[document.summary.status] ?? document.summary.status}</strong>
              <p>{document.summary.status === "completed" ? "사용자 QA까지 완료된 작업입니다." : "QA 대기 상태가 되면 확인 도구가 활성화됩니다."}</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

/**
 * 선언된 선행 작업과 각각의 판정을 그린다. 선언이 없고 형식 오류도 아니면 아무것도 그리지 않는다.
 *
 * `missing`·`cyclic`·형식 오류는 기다려서 풀리는 `pending`과 구분해 경고 톤과 안내 문구를 준다.
 * 이 구분이 없으면 사용자가 영원히 열리지 않는 작업을 "기다리면 되는 작업"으로 읽는다.
 */
function TaskDependencies({ dependencies, formatError }: { dependencies: TaskDependency[]; formatError: boolean }) {
  if (!formatError && dependencies.length === 0) return null;
  const startable = !formatError && dependencies.every((entry) => entry.state === "satisfied");
  const permanent = formatError || dependencies.some((entry) => permanentDependencyStates.has(entry.state));

  return (
    <section aria-label="선행 작업" className={`task-dependencies ${startable ? "startable" : "waiting"}`}>
      <header>
        <strong>선행 작업</strong>
        <span className="task-dependency-summary">{startable ? "시작 가능" : "시작할 수 없음"}</span>
      </header>
      {formatError ? (
        <p className="task-dependency-error">선행 선언의 형식이 잘못되어 목록으로 읽지 못했습니다.</p>
      ) : (
        <ul>
          {dependencies.map((entry, index) => (
            <li className={`task-dependency state-${entry.state}`} key={`${entry.id}:${index}`}>
              <strong>{entry.id}</strong>
              <span>{dependencyLabels[entry.state] ?? entry.state}</span>
            </li>
          ))}
        </ul>
      )}
      {permanent && <p className="task-dependency-note">{PERMANENT_DEPENDENCY_NOTE}</p>}
    </section>
  );
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

/**
 * 보드를 기획서별 레인으로 나눠 그린다. 레인 안의 열 구성은 지금의 `BoardView` 그대로다.
 *
 * 묶기를 켰을 때만 마운트되므로 꺼진 보드에서는 파생 비용이 아예 들지 않는다.
 */
function SpecLaneBoard({
  allTasks,
  hasFilters,
  onOpen,
  specs,
  statusFilter,
  visibleTasks,
}: {
  /** 수치와 신호의 계산 집합. 필터와 완료 절단 이전의 워크플로 작업 전체다. */
  allTasks: WorkflowItemSummary[];
  hasFilters: boolean;
  onOpen(item: WorkflowItemSummary): void;
  specs: WorkflowItemSummary[];
  statusFilter: string;
  /** 카드로 그릴 집합. 완료 절단과 검색·상태 필터를 이미 거쳤다. */
  visibleTasks: WorkflowItemSummary[];
}) {
  // 목록은 2.5초마다 다시 읽히는 자리라 매 렌더가 아니라 작업 목록이 바뀔 때만 다시 센다.
  const { hiddenLaneCount, lanes } = useMemo(
    () => buildSpecLanes(allTasks, visibleTasks, specs),
    [allTasks, specs, visibleTasks],
  );

  return (
    <>
      <p className="task-lane-note">{LANE_BASIS_NOTE}</p>
      {lanes.map((lane) => (
        <section className="task-lane" key={lane.key}>
          <header className="task-lane-header">
            <div>
              <strong>{lane.title}</strong>
              {lane.specId && lane.specId !== lane.title && <small>{lane.specId}</small>}
            </div>
            <p className="task-lane-counts">
              <em>전체 기준</em>
              {taskColumns.map((column) => (
                <span key={column.status}>{statusLabels[column.status]} {lane.counts[column.status]}</span>
              ))}
              {lane.unknownCount > 0 && <span>규격 밖 {lane.unknownCount}</span>}
            </p>
            {lane.signal && <span className="task-lane-signal">{LANE_SIGNAL_LABEL}</span>}
          </header>
          {/* region 이름은 제목이 아니라 레인 키로 짓는다. 서로 다른 기획서가 같은 제목을 가질 수 있다. */}
          <BoardView
            items={lane.items}
            label={`${lane.specId ?? UNASSIGNED_LANE_TITLE} 칸반 보드`}
            onOpen={onOpen}
            statusFilter={statusFilter}
          />
        </section>
      ))}
      {lanes.length === 0 && <EmptyTasks />}
      {hiddenLaneCount > 0 && (
        <p className="task-lane-hidden">
          {hasFilters
            ? `조건에 맞는 카드가 없어 표시하지 않은 기획서 ${hiddenLaneCount}개`
            : `완료만 있어 표시하지 않은 기획서 ${hiddenLaneCount}개`}
        </p>
      )}
    </>
  );
}

function ListView({ items, onOpen }: { items: WorkflowItemSummary[]; onOpen(item: WorkflowItemSummary): void }) {
  return (
    <div className="task-list" aria-label="개발 작업 리스트" role="region">
      <table>
        <thead><tr><th>작업</th><th>상태</th><th>목표일</th><th>최근 변경</th></tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.fileName}>
              <td><button className="task-row-open" onClick={() => onOpen(item)}><strong>{item.title}</strong><small>{item.id}{item.excerpt ? ` · ${item.excerpt}` : ""}</small></button></td>
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
        {items.map((item) => (
          <button className="task-card" key={item.fileName} onClick={() => onOpen(item)}>
            <div><span className={`status-pill status-${item.status}`}>{statusLabels[item.status] ?? item.status}</span><small>{item.id}</small></div>
            <strong>{item.title}</strong>
            {item.excerpt && <p>{item.excerpt}</p>}
            <footer><Icon name="board" /><span>{item.dueAt ? `목표 ${formatDueDate(item.dueAt)}` : formatDate(item.updatedAt)}</span></footer>
          </button>
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

interface SpecLane {
  key: string;
  /** 미분류 레인은 `null`이다. */
  specId: string | null;
  title: string;
  /** `taskColumns`의 다섯 상태별 건수. 0이어도 전부 담는다. */
  counts: Record<string, number>;
  /** 그 다섯에 없는 상태의 건수. 규격 밖 작업이 수치에서 조용히 빠지지 않게 따로 센다. */
  unknownCount: number;
  signal: boolean;
  /** 화면에 그릴 카드. */
  items: WorkflowItemSummary[];
}

/**
 * 작업을 기획서별 레인으로 나눈다.
 *
 * 수치와 신호는 `allTasks`를 세고 카드만 `visibleTasks`에서 온다. DECISION-DD348ED0의 확인 필요
 * 1번이 정한 계산 집합이고, 필터에 가려진 `todo` 하나 때문에 "통째로 QA 가능"이 켜지는 것을 막는
 * 자리다. 그래서 헤더 수치와 눈에 보이는 카드 수는 어긋날 수 있고, 그것이 정상이다.
 *
 * 카드가 한 장도 없는 레인은 목록에서 빼고 그 수를 함께 돌려준다. 화면이 그 수를 문장으로 남긴다.
 */
function buildSpecLanes(
  allTasks: WorkflowItemSummary[],
  visibleTasks: WorkflowItemSummary[],
  specs: WorkflowItemSummary[],
) {
  const knownStatuses = new Set<string>(taskColumns.map((column) => column.status));
  const specTitles = new Map(specs.map((spec) => [spec.id, spec.title]));
  const drafts = new Map<string, SpecLane>();

  for (const item of allTasks) {
    const key = laneKeyOf(item);
    const lane = drafts.get(key) ?? emptyLane(key, specTitles);
    if (knownStatuses.has(item.status)) lane.counts[item.status] += 1;
    else lane.unknownCount += 1;
    drafts.set(key, lane);
  }
  // 표시 집합은 전체 집합의 부분이므로 여기서 새 레인이 생기지 않는다.
  for (const item of visibleTasks) drafts.get(laneKeyOf(item))?.items.push(item);

  const lanes: SpecLane[] = [];
  let hiddenLaneCount = 0;
  for (const lane of drafts.values()) {
    lane.signal = laneSignal(lane);
    if (lane.items.length === 0) hiddenLaneCount += 1;
    else lanes.push(lane);
  }
  lanes.sort(compareLanes);
  return { hiddenLaneCount, lanes };
}

function laneKeyOf(item: WorkflowItemSummary) {
  const trimmed = item.sourceSpecId?.trim();
  return trimmed ? trimmed : UNASSIGNED_LANE_KEY;
}

function emptyLane(key: string, specTitles: Map<string, string>): SpecLane {
  const specId = key === UNASSIGNED_LANE_KEY ? null : key;
  return {
    key,
    specId,
    title: specId ? specTitles.get(specId) ?? specId : UNASSIGNED_LANE_TITLE,
    counts: Object.fromEntries(taskColumns.map((column) => [column.status, 0])),
    unknownCount: 0,
    signal: false,
    items: [],
  };
}

/**
 * `todo`·`in_progress`·`blocked`가 0이고 `qa_waiting`이 1건 이상인가.
 *
 * 규격 밖 상태는 막는 쪽에 센다 — 무엇인지 모르는 상태를 "QA 대기만 남았다"의 근거로 삼을 수 없다.
 * 미분류 레인은 하나의 기획서가 아니라 "통째로 QA"의 대상이 아니므로 신호를 붙이지 않는다.
 */
function laneSignal(lane: SpecLane) {
  if (!lane.specId) return false;
  const blocking = lane.counts.todo + lane.counts.in_progress + lane.counts.blocked + lane.unknownCount;
  return blocking === 0 && lane.counts.qa_waiting > 0;
}

/**
 * 신호가 켜진 레인이 위, 그 안에서 기획서 id 오름차순이다.
 *
 * 미분류 레인은 늘 맨 뒤다. 신호가 붙지 않아 아랫 무리에 속하고, 키가 기획서 id가 아니라 id 정렬에
 * 섞을 수 없기 때문이다.
 */
function compareLanes(left: SpecLane, right: SpecLane) {
  if (left.signal !== right.signal) return left.signal ? -1 : 1;
  if (!left.specId) return 1;
  if (!right.specId) return -1;
  return left.specId.localeCompare(right.specId);
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
