import { useMemo, useState } from "react";
import { Icon } from "../../../shared/ui/Icon";
import { useArmedConfirm } from "../../../shared/ui/useArmedConfirm";
import type {
  TaskDependency,
  TaskDocument,
  TaskOverlapBlock,
  TaskQaBatchEntry,
  TaskQaOutcome,
  WorkflowItemSummary,
  WorkflowSummary,
} from "../domain/types";
import { parseBlockedReason, splitSection } from "../domain/documentSections";
import { UNASSIGNED_LANE_KEY, browserSpecLaneCollapseStore } from "../infrastructure/browserSpecLaneCollapseStore";
import { BlockedTaskPanel } from "./BlockedTaskPanel";
import { DECISION_SUMMARY_HEADING, DocumentReader } from "./DocumentReader";
import { MarkdownBody } from "./MarkdownBody";

/** 다섯 상태의 순서와 열 구성. 기획서 화면의 파생 작업 배지가 같은 목록으로 센다(SPEC-039 R5). */
export const taskColumns = [
  { status: "todo", title: "준비", description: "시작할 수 있는 작업", tone: "neutral" },
  { status: "in_progress", title: "진행 중", description: "LLM이 작업하는 범위", tone: "active" },
  { status: "blocked", title: "막힘", description: "해결이 필요한 장애물", tone: "danger" },
  { status: "qa_waiting", title: "QA 대기", description: "사용자 검증이 필요한 작업", tone: "review" },
  { status: "completed", title: "최근 완료", description: "최근 완료된 작업 3개", tone: "done" },
] as const;

/** 작업 상태의 이름. 열 제목(`taskColumns`의 `title`)과 달리 완료를 "최근 완료"로 부르지 않는다. */
export const statusLabels: Record<string, string> = {
  todo: "준비",
  in_progress: "진행 중",
  blocked: "막힘",
  qa_waiting: "QA 대기",
  completed: "완료",
};

/**
 * 기다려도 풀리지 않는 판정이 무엇을 뜻하는지. 선언을 고쳐야 열린다는 것은 판정에서 유도되는 사실이라
 * 말해도 되지만, 무엇으로 고칠지는 앱이 모르므로 말하지 않는다(SPEC-039 R4).
 */
const DECLARATION_FIX_NOTE = "기다려서 풀리지 않고 선언을 고쳐야 열립니다.";

const UNASSIGNED_LANE_TITLE = "미분류";

/** 레인 수치와 신호가 무엇을 센 값인지 밝히는 문장. 레인마다 반복하지 않고 목록 위에 한 번만 둔다. */
const LANE_BASIS_NOTE = "레인의 수치와 QA 신호는 필터·완료 절단 이전의 전체 작업을 셉니다";

/** 앞부분이 집계 사실이고 뒷부분이 그 사실의 뜻이다. 판정이 아니라 집계라는 것을 문구가 말한다. */
const LANE_SIGNAL_LABEL = "QA 대기만 남음 · 통째로 QA 가능";

/**
 * 액션 문구의 건수가 왜 눈앞의 카드 수와 다른지 밝히는 문장. 필터가 걸렸을 때만 붙인다.
 *
 * SPEC-031 확인 필요 3번이 승인한 비용이다. 대상은 필터·완료 절단 이전의 레인 전체 `qa_waiting`이라
 * 카드 3장만 보이던 레인에서 9건이 목록에 뜰 수 있다. 어긋남이 없는 자리에는 이 문장을 늘리지 않는다.
 */
const LANE_QA_BASIS_NOTE = "필터와 무관하게 이 레인의 QA 대기 전체를 셉니다";

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
  // QA 반려와 사용자 재개는 둘 다 작업을 `todo`로 되돌리지만 서로 다른 사실이라 이름을 나눈다.
  // 하나는 사용자가 결과를 물린 것이고, 다른 하나는 막힌 일을 사용자가 다시 연 것이다.
  { kind: "revision_requested", label: "반려" },
  { kind: "resumed", label: "사용자 재개" },
] as const;

type ViewMode = (typeof viewModes)[number]["value"];

interface Props {
  busy: boolean;
  onReadTask(fileName: string): Promise<TaskDocument | null>;
  onTaskQa(fileName: string, outcome: TaskQaOutcome, comment: string): Promise<boolean>;
  /** 일괄은 입구를 하나 더하는 것이지 `onTaskQa`를 대체하지 않는다(SPEC-031 R7). */
  onTaskQaBatch(fileNames: string[], comment: string): Promise<TaskQaBatchEntry[] | null>;
  workflow: WorkflowSummary;
}

export function DevelopmentBoard({ busy, onReadTask, onTaskQa, onTaskQaBatch, workflow }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [laneGrouping, setLaneGrouping] = useState(false);
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
  // 선행을 제목으로 부르는 문장이 쓸 값. 문서 payload에는 선행의 제목이 없고 목록에는 있어서
  // (SPEC-039 확인 사실 6) 여기서 한 번 추려 상세로 넘긴다. 새 조회도 새 필드도 늘지 않는다.
  const taskTitles = useMemo(
    () => new Map(workflow.items.tasks.map((item) => [item.id, item.title])),
    [workflow.items.tasks],
  );
  const hasFilters = Boolean(query.trim()) || statusFilter !== "all";

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
        onOpenRelatedTask={async (item) => {
          const relatedDocument = await onReadTask(item.fileName);
          if (relatedDocument) setTaskDocument(relatedDocument);
        }}
        onTaskQa={async (outcome, comment) => {
          const succeeded = await onTaskQa(taskDocument.summary.fileName, outcome, comment);
          if (succeeded) setTaskDocument(null);
          return succeeded;
        }}
        tasks={workflow.items.tasks}
        taskTitles={taskTitles}
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
              busy={busy}
              collapsed={laneCollapsed}
              hasFilters={hasFilters}
              onOpen={(item) => void openTask(item)}
              onToggleCollapsed={toggleLaneCollapsed}
              onTaskQaBatch={onTaskQaBatch}
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

/**
 * 확인 동선 절의 제목. 개발자 계약이 개발 작업 문서에 요구하는 문자열과 문자 단위로 같다(TASK-118).
 *
 * 이 한 문자열만 찾는다. 후보를 추측하지 않고 대소문자·공백 변형도 만들지 않는다(SPEC-039 R2).
 */
const TASK_WALKTHROUGH_HEADING = "## 확인 동선";

function TaskDetail({
  busy,
  document,
  onBack,
  onOpenRelatedTask,
  onTaskQa,
  tasks,
  taskTitles,
}: {
  busy: boolean;
  document: TaskDocument;
  onBack(): void;
  onOpenRelatedTask(task: WorkflowItemSummary): Promise<void>;
  onTaskQa(outcome: TaskQaOutcome, comment: string): Promise<boolean>;
  tasks: WorkflowItemSummary[];
  /** 작업 id → 제목. 선행을 제목으로 부르는 자리에서만 쓴다. */
  taskTitles: Map<string, string>;
}) {
  const [comment, setComment] = useState("");
  const [panelWidth, setPanelWidth] = useState(loadQaPanelWidth);
  const [resizing, setResizing] = useState(false);
  const confirmQa = useArmedConfirm();
  const revisionQa = useArmedConfirm();
  const blocked = document.summary.status === "blocked";
  const awaitingQa = document.summary.status === "qa_waiting";
  const blockedReason = useMemo(
    () => (blocked ? parseBlockedReason(document.body) : null),
    [blocked, document.body],
  );
  const blockedSummary = useMemo(
    () => (blocked && blockedReason === null
      ? splitSection(document.body, DECISION_SUMMARY_HEADING).section
      : null),
    [blocked, blockedReason, document.body],
  );
  // 개발자가 적어 둔 확인 동선을 도장 옆으로 가져온다(SPEC-039 R7). 이미 읽어 온 본문 위에서 자르고
  // 문서를 다시 읽지 않는다. 확인 도구가 활성화된 `qa_waiting`에서만 찾는다 — 도장이 없는 자리에
  // 확인 동선만 띄우지 않는다. 절이 없으면 `null`이고, 그때 이 자리는 지금 모습 그대로다.
  const walkthrough = useMemo(
    () => (awaitingQa ? splitSection(document.body, TASK_WALKTHROUGH_HEADING).section : null),
    [awaitingQa, document.body],
  );
  // 사용자가 이 작업을 다시 연 사실. 문서 이력에서 그대로 읽고, 없으면 아무 말도 하지 않는다.
  const lastResumed = useMemo(() => {
    const resumed = (document.summary.events ?? []).filter((event) => event.kind === "resumed");
    return resumed.length === 0 ? null : resumed[resumed.length - 1];
  }, [document.summary.events]);
  const dependencies = document.dependencies ?? [];
  const formatError = document.dependencyFormatError ?? false;
  const overlaps = document.overlapBlocks ?? [];
  // 구조 선언이 하나라도 있을 때만 시작 가능 여부를 말한다. 선행도 겹침도 선언하지 않은 작업에는
  // 판정할 구조가 없고, 없는 것을 "시작 가능"으로 부르면 자리를 옮기는 대신 새 사실을 만드는 것이다.
  const declaresStructure = formatError || dependencies.length > 0 || overlaps.length > 0;
  const startable = !formatError && overlaps.length === 0
    && dependencies.every((entry) => entry.state === "satisfied");

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
        {/* 지금 상태와 시작 가능 여부가 같은 자리에서 읽힌다(SPEC-039 R5). 시작 가능 여부는 선행
            상자 헤더에서 이리로 옮겨 온 것이고, 저쪽에는 남지 않는다 — 옮기는 것이지 복제가 아니다. */}
        <span className="task-detail-state">
          <span className={`status-pill status-${document.summary.status}`}>{statusLabels[document.summary.status] ?? document.summary.status}</span>
          {declaresStructure && (
            <span className={`task-start-state ${startable ? "startable" : "waiting"}`}>
              {startable ? "시작 가능" : "시작할 수 없음"}
            </span>
          )}
        </span>
      </div>
      <div
        className={`task-detail-layout ${resizing ? "resizing" : ""}`}
        style={{ "--qa-panel-width": `${panelWidth}px` } as React.CSSProperties}
      >
        <article className="task-detail-document">
          <div className="task-detail-meta"><span>최근 변경 {formatDate(document.summary.updatedAt)}</span><span>{document.summary.dueAt ? `목표 ${formatDueDate(document.summary.dueAt)}` : "일정 없음"}</span></div>
          <TaskDependencies
            dependencies={dependencies}
            formatError={formatError}
            overlaps={overlaps}
            taskTitles={taskTitles}
          />
          <div className="spec-paper embedded">
            <DocumentReader body={document.body} key={document.summary.fileName} />
          </div>
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
          <p className="eyebrow">{blocked ? "BLOCKED TASK" : "USER QA"}</p>
          <h2>{blocked ? "진행이 막혔습니다" : awaitingQa ? "직접 확인해 주세요" : "현재 작업 상태"}</h2>
          {blocked ? (
            <BlockedTaskPanel
              decisionSummary={blockedSummary}
              onOpenRelatedTask={onOpenRelatedTask}
              reason={blockedReason}
              tasks={tasks}
              updatedAt={document.summary.updatedAt}
            />
          ) : awaitingQa ? (
            <>
              <p>테스트한 순서와 결과를 남기면 완료 기록 또는 개발자 재작업 지시로 전달됩니다.</p>
              {/* 문서가 쓴 문장을 그대로 옮긴다. 앱이 이 절의 문장을 조립하지 않는다(SPEC-039 R4). */}
              {walkthrough !== null && (
                <section aria-label="확인 동선" className="task-qa-walkthrough">
                  <MarkdownBody body={walkthrough} />
                </section>
              )}
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
                  {/*
                    기획서 결정의 수정 요청과 같은 말을 쓰지 않는다. 두 자리가 같은 이름을 쓰면
                    승인된 기획에 할 말이 있어 누른 것이 개발 작업의 반려가 된다(SPEC-042 R5).
                    이름이 무엇이 대상이고 무엇이 일어나는지를 말하고, 확인 문구가 그것을 잇는다.
                  */}
                  {revisionQa.armed ? "한 번 더 누르면 되돌리기" : "개발 준비로 되돌리기"}
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
              {lastResumed !== null && (
                <p className="task-resume-record">사용자 재개 {formatDate(lastResumed.at)}</p>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

/**
 * 선언된 선행 작업과 각각의 판정, 그리고 겹침으로 막힌 사실을 그린다. 선언이 없고 형식 오류도 겹침도
 * 없으면 아무것도 그리지 않는다.
 *
 * 판정마다 평문 문장이 하나씩 붙는다(SPEC-039 R3). `missing`·`cyclic`·형식 오류는 기다려서 풀리는
 * `pending`과 다른 문장을 갖는다. 이 구분이 없으면 사용자가 영원히 열리지 않는 작업을 "기다리면 되는
 * 작업"으로 읽는다. 겹침은 lease가 풀리면 열리므로 기다리는 쪽 문장을 쓴다(SPEC-032 R7).
 *
 * 선행 미충족과 겹침은 동시에 성립할 수 있고, 그때 둘 다 보인다. 한쪽이 다른 쪽을 가리지 않는다.
 *
 * 시작 가능 여부는 여기서 말하지 않는다. 그 한 줄은 상태 배지 옆으로 옮겨 갔고(SPEC-039 R5), 같은
 * 사실을 두 자리에서 말하지 않기 위해 이 헤더에는 남기지 않는다.
 */
function TaskDependencies({
  dependencies,
  formatError,
  overlaps,
  taskTitles,
}: {
  dependencies: TaskDependency[];
  formatError: boolean;
  overlaps: TaskOverlapBlock[];
  taskTitles: Map<string, string>;
}) {
  if (!formatError && dependencies.length === 0 && overlaps.length === 0) return null;

  return (
    <section aria-label="선행 작업" className="task-dependencies">
      <header>
        <strong>선행 작업</strong>
      </header>
      {formatError ? (
        <p className="task-dependency-error">선행 선언을 목록으로 읽지 못했습니다. {DECLARATION_FIX_NOTE}</p>
      ) : (
        dependencies.length > 0 && (
          <ul>
            {dependencies.map((entry, index) => (
              <li className={`task-dependency state-${entry.state}`} key={`${entry.id}:${index}`}>
                <strong>{entry.id}</strong>
                <p>{dependencySentence(entry, taskTitles.get(entry.id))}</p>
              </li>
            ))}
          </ul>
        )
      )}
      {overlaps.length > 0 && (
        <div className="task-overlaps">
          <ul>
            {overlaps.map((block, index) => (
              <li className="task-overlap" key={`${block.leaseTargetId}:${index}`}>
                <strong>{block.leaseTargetId}</strong>
                <p>{overlapSentence(block)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * 선행 판정 하나를 평문 문장으로 옮긴다.
 *
 * 제목을 찾은 선행은 제목으로 부르고, 찾지 못하면 id로 부른다. `missing` 판정의 선행은 목록에도 없는
 * 것이 그 판정의 뜻이라 제목을 추정으로 채우지 않는다.
 *
 * 규격 밖 판정값은 규격 밖이라고 말한다. 그 값이 기다리면 풀리는 쪽인지 아닌지는 앱이 모르므로
 * `DECLARATION_FIX_NOTE`도 붙이지 않는다(SPEC-039 R4).
 */
function dependencySentence(entry: TaskDependency, title: string | undefined) {
  const name = title ? `선행 작업 "${title}"` : `선행 작업 ${entry.id}`;
  switch (entry.state) {
    case "satisfied":
      return `${name}의 진행이 끝났습니다.`;
    case "pending":
      return `${name}의 진행이 아직 끝나지 않았습니다. 그 작업이 끝나면 이 선언은 풀립니다.`;
    case "missing":
      return `${name}의 문서가 없습니다. ${DECLARATION_FIX_NOTE}`;
    case "cyclic":
      return `${name}의 선언이 돌아서 어느 쪽도 먼저일 수 없습니다. ${DECLARATION_FIX_NOTE}`;
    default:
      return `${name}의 판정값이 규격 밖입니다(받은 값 ${entry.state}).`;
  }
}

/**
 * 겹침 하나를 평문 문장으로 옮긴다.
 *
 * 공유 경로로 막힌 것과 선언 부재·형식 오류로 막힌 것이 서로 다른 문장을 갖는다. 둘 다 lease가 풀리면
 * 사라지므로 마지막 문장은 같다.
 */
function overlapSentence(block: TaskOverlapBlock) {
  const cause = block.sharedFiles.length > 0
    ? `겹친 경로는 ${block.sharedFiles.join(", ")}입니다.`
    : "두 작업 중 한쪽의 범위 선언이 없거나 형식이 잘못되어 겹친 것으로 봅니다.";
  return `범위가 겹치는 상대는 다른 세션이 잡은 문서 ${block.leaseTargetId}입니다. ${cause} 그 세션의 lease가 풀리면 이 겹침은 사라집니다.`;
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
  busy,
  collapsed,
  hasFilters,
  onOpen,
  onToggleCollapsed,
  onTaskQaBatch,
  specs,
  statusFilter,
  visibleTasks,
}: {
  /** 수치와 신호의 계산 집합. 필터와 완료 절단 이전의 워크플로 작업 전체다. */
  allTasks: WorkflowItemSummary[];
  busy: boolean;
  /** 레인 키 → 접혔는지. 값이 없는 레인은 펼침이다. */
  collapsed: Record<string, boolean>;
  hasFilters: boolean;
  onOpen(item: WorkflowItemSummary): void;
  onToggleCollapsed(key: string): void;
  onTaskQaBatch(fileNames: string[], comment: string): Promise<TaskQaBatchEntry[] | null>;
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
  // 확인 화면은 한 번에 하나만 열린다. 키가 아니라 연 시점의 레인을 그대로 드는 이유는 실행 결과다 —
  // 상태 필터가 걸린 채 전 건이 `completed`가 되면 그 레인은 카드가 0장이 되어 목록에서 빠지는데,
  // 키로 다시 찾는 구조였다면 건별 결과를 읽기 전에 화면이 사라진다(R4).
  const [openLane, setOpenLane] = useState<SpecLane | null>(null);

  return (
    <>
      <p className="task-lane-note">{LANE_BASIS_NOTE}</p>
      {lanes.map((lane) => {
        const laneCollapsed = collapsed[lane.key] ?? false;
        return (
          <section className={laneCollapsed ? "task-lane collapsed" : "task-lane"} key={lane.key}>
            {/* 접혀도 헤더는 통째로 남는다. 접기는 카드를 줄이는 것이지 사실을 감추는 것이 아니다. */}
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
              {/* 신호 하나로 갈린다. 신호가 꺼진 레인과 미분류 레인에는 액션이 없다(R1). 접힌 레인에도
                  헤더는 남으므로 액션도 남는다 — 접기는 카드를 줄이는 것이지 사실을 감추는 것이 아니다. */}
              {lane.signal && (
                <button
                  className="task-lane-batch"
                  onClick={() => setOpenLane(lane)}
                  type="button"
                >
                  이 그룹 {lane.qaWaiting.length}건 QA 확인
                </button>
              )}
              {/* 이름은 제목이 아니라 레인 키로 짓는다. 개정으로 갈린 두 기획서가 같은 제목을 갖고
                  그 둘을 병합하지 않는 것이 SPEC-029의 결정이라, 제목으로 지으면 이름이 겹친다.
                  아래 보드 region과 같은 근거다. 보이는 글자는 이름이 그대로 담는다. */}
              <button
                aria-expanded={!laneCollapsed}
                aria-label={`${lane.specId ?? UNASSIGNED_LANE_TITLE} 레인 ${laneCollapsed ? "펼치기" : "접기"}`}
                className="task-lane-toggle"
                onClick={() => onToggleCollapsed(lane.key)}
                type="button"
              >
                {laneCollapsed ? "펼치기" : "접기"}
              </button>
            </header>
            {/* 숨기지 않고 그리지 않는다. 2.5초마다 다시 읽히는 자리라 접힌 레인의 카드를 계속 그리지 않는 편이 낫다. */}
            {/* region 이름은 제목이 아니라 레인 키로 짓는다. 서로 다른 기획서가 같은 제목을 가질 수 있다. */}
            {!laneCollapsed && (
              // 보드가 최소 950px이라 좁은 창에서 레인 상자 밖으로 넘친다. 스크롤 상자를 보드에만
              // 씌워 레인 테두리 안에 가둔다. 헤더는 이 상자 밖이라 스크롤해도 자리를 지킨다.
              <div className="task-lane-scroll">
                <BoardView
                  items={lane.items}
                  label={`${lane.specId ?? UNASSIGNED_LANE_TITLE} 칸반 보드`}
                  onOpen={onOpen}
                  statusFilter={statusFilter}
                />
              </div>
            )}
          </section>
        );
      })}
      {lanes.length === 0 && <EmptyTasks />}
      {hiddenLaneCount > 0 && (
        <p className="task-lane-hidden">
          {hasFilters
            ? `조건에 맞는 카드가 없어 표시하지 않은 기획서 ${hiddenLaneCount}개`
            : `완료만 있어 표시하지 않은 기획서 ${hiddenLaneCount}개`}
        </p>
      )}
      {openLane && (
        <LaneQaDialog
          busy={busy}
          hasFilters={hasFilters}
          key={openLane.key}
          lane={openLane}
          onClose={() => setOpenLane(null)}
          onConfirm={onTaskQaBatch}
        />
      )}
    </>
  );
}

/** 실행 결과. `entries`가 `null`이면 호출 자체가 실패한 것이고, 아직 실행 전이면 이 값이 없다. */
interface LaneQaOutcome {
  entries: TaskQaBatchEntry[] | null;
}

/**
 * 레인 하나를 통째로 QA 확인하는 화면.
 *
 * 대상은 `lane.qaWaiting`, 즉 필터·완료 절단 이전의 레인 전체 `qa_waiting`이다(승인된 확인 필요 3번).
 * 실행은 콜백을 **한 번**만 부르고, 끝난 뒤 건별 결과를 이 화면 안에서 말한다 — 전역 에러 문구 하나에
 * 맡기면 42건 중 어느 건이 실패했는지 읽을 수 없다(R4).
 *
 * `lane`은 연 시점의 스냅샷이라 이 화면이 떠 있는 동안 목록이 흔들리지 않는다. 실행 뒤 대상이
 * `completed`가 되어도 결과와 목록이 같은 건을 가리킨다.
 */
function LaneQaDialog({
  busy,
  hasFilters,
  lane,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  hasFilters: boolean;
  lane: SpecLane;
  onClose(): void;
  onConfirm(fileNames: string[], comment: string): Promise<TaskQaBatchEntry[] | null>;
}) {
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [comment, setComment] = useState("");
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<LaneQaOutcome | null>(null);
  const confirmBatch = useArmedConfirm();

  const selected = lane.qaWaiting.filter((item) => !excluded.has(item.fileName));
  const locked = busy || running;
  const titleId = `lane-qa-title-${lane.key}`;
  const commentId = `lane-qa-comment-${lane.key}`;

  function toggleTarget(fileName: string) {
    // 목록이 바뀌면 무장을 푼다. 단건 패널이 코멘트 입력에서 하는 것과 같은 어법이다.
    confirmBatch.disarm();
    const next = new Set(excluded);
    if (next.has(fileName)) next.delete(fileName);
    else next.add(fileName);
    setExcluded(next);
  }

  async function run() {
    setRunning(true);
    const entries = await onConfirm(selected.map((item) => item.fileName), comment.trim());
    setRunning(false);
    // 전 건이 기록되면 읽을 실패가 없으므로 결과 화면을 붙들지 않고 닫는다. 완료로 바뀐
    // 보드가 곧 피드백이다. 하나라도 실패하거나 호출이 실패하면 열어 둔 채 건별로 말한다(R4).
    if (entries !== null && entries.length > 0 && entries.every((entry) => entry.recorded)) {
      onClose();
      return;
    }
    setOutcome({ entries });
  }

  const failures = outcome?.entries?.filter((entry) => !entry.recorded) ?? [];
  const recorded = outcome?.entries?.filter((entry) => entry.recorded).length ?? 0;

  return (
    <div
      className="lane-qa-overlay"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !running) onClose();
      }}
    >
      <section aria-labelledby={titleId} aria-modal="true" className="lane-qa-dialog" role="dialog">
        <h2 id={titleId}>{lane.title} · QA 대기 {lane.qaWaiting.length}건 일괄 확인</h2>
        {hasFilters && <p className="lane-qa-note">{LANE_QA_BASIS_NOTE}</p>}
        <ul className="lane-qa-targets">
          {lane.qaWaiting.map((item) => (
            <li key={item.fileName}>
              <label>
                <input
                  checked={!excluded.has(item.fileName)}
                  disabled={locked}
                  onChange={() => toggleTarget(item.fileName)}
                  type="checkbox"
                />
                <strong>{item.id}</strong>
                <span>{item.title}</span>
              </label>
            </li>
          ))}
        </ul>
        <label htmlFor={commentId}>전 건에 함께 남길 확인 메모</label>
        <textarea
          id={commentId}
          maxLength={2_000}
          onChange={(event) => {
            confirmBatch.disarm();
            setComment(event.target.value);
          }}
          placeholder={"1. 실행한 동작\n2. 확인한 결과"}
          value={comment}
        />
        {confirmBatch.armed && (
          <p className="confirm-warning" role="status">
            선택한 {selected.length}건을 완료 처리합니다. 되돌릴 수 없습니다.
          </p>
        )}
        {outcome && (
          <div className="lane-qa-result" role="status">
            {outcome.entries === null ? (
              <strong>일괄 확인 호출이 실패해 건별 결과를 받지 못했습니다.</strong>
            ) : (
              <>
                <strong>{recorded}건을 기록했습니다.</strong>
                {failures.length > 0 && (
                  <ul className="lane-qa-failures">
                    {failures.map((entry) => (
                      <li key={entry.fileName}>
                        {/* 문서를 읽지 못하면 앱이 `taskId`를 `null`로 돌려준다. 추정으로 채우지 않고 파일 이름을 쓴다. */}
                        <strong>{entry.taskId ?? entry.fileName}</strong>
                        <span>{entry.message ?? "사유가 기록되지 않았습니다."}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
        <div className="task-qa-actions">
          <button className="secondary-button" disabled={running} onClick={onClose} type="button">
            닫기
          </button>
          <button
            className={`stamp-button ${confirmBatch.armed ? "armed" : ""}`}
            disabled={locked || selected.length === 0}
            onClick={() => confirmBatch.fire(() => void run())}
            type="button"
          >
            {confirmBatch.armed ? "한 번 더 누르면 완료" : `선택한 ${selected.length}건 확인 완료`}
            {confirmBatch.armed && <i aria-hidden="true" className="confirm-timer" />}
          </button>
        </div>
      </section>
    </div>
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
  /** 이 레인의 `qa_waiting` 전체. 필터와 완료 절단 이전 집합이라 `items`와 어긋날 수 있다. */
  qaWaiting: WorkflowItemSummary[];
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
    // 일괄 확인의 대상도 이 순회에서 모은다. `visibleTasks` 쪽에서 모으면 필터에 가려진 건이 빠져
    // 액션 문구의 건수와 목록의 건수가 어긋난다(승인된 확인 필요 3번).
    if (item.status === "qa_waiting") lane.qaWaiting.push(item);
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
    qaWaiting: [],
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
