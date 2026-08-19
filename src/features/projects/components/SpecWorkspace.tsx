import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../../../shared/ui/Icon";
import { useArmedConfirm } from "../../../shared/ui/useArmedConfirm";
import { FOLLOW_UP_LABEL, labelSpecDecisions, specDecisionLabel } from "../domain/specDecisionLabels";
import type {
  SpecDecisionOutcome,
  SpecDocument,
  TaskEvent,
  WorkGroupSummary,
  WorkflowItemSummary,
  WorkflowSummary,
} from "../domain/types";
import {
  NARROW_WINDOW_WIDTH,
  PANEL_LIMITS,
  READING_WIDTH_MIN,
  measureReclaimedWidth,
  resolveReadingWidth,
  resolveRenderedPanelWidths,
} from "../domain/panelLayout";
import {
  browserPanelLayoutStore,
  type PanelLayoutEntry,
  type PanelLayoutState,
} from "../infrastructure/browserPanelLayoutStore";
import { GroupAttentionNote, taskColumns } from "./DevelopmentBoard";
import { DocumentReader } from "./DocumentReader";
import {
  PanelCollapseButton,
  PanelCollapsedBar,
  PanelResizeHandle,
} from "./PanelLayoutControls";
import { SidebarLayoutContext } from "./WorkspaceShell";

interface Props {
  busy: boolean;
  document: SpecDocument | null;
  loading: boolean;
  /**
   * 패널이 지금 그려져 있는 폭을 재는 자리. jsdom은 배치를 계산하지 않아 실제 측정이 0으로 나오므로,
   * 시험이 이 자리를 바꿔 끼워 기준 너비를 확인한다.
   */
  measurePanelWidth?(element: HTMLElement): number;
  onDecision(outcome: SpecDecisionOutcome, comment: string): Promise<boolean>;
  onSelect(item: WorkflowItemSummary): void;
  workflow: WorkflowSummary;
}

/** 이 화면이 조절하는 두 패널. 저장소와 영역 표가 쓰는 식별자를 그대로 쓴다. */
type DocumentPanel = "specList" | "specDecision";

/** 조작 요소의 접근 이름과 툴팁이 이 값에서 나온다. */
const SPEC_LIST_LABEL = "기획서 목록";
const SPEC_DECISION_LABEL = "사용자 결정";

function measureElementWidth(element: HTMLElement) {
  return element.getBoundingClientRect().width;
}

type SpecFilter = "all" | "draft" | "user_review" | "decided";
type CommentDecision = Exclude<SpecDecisionOutcome, "approved">;

const statusLabels: Record<string, string> = {
  draft: "작성 중",
  user_review: "내 선택 대기",
  approved: "승인됨",
  revision_requested: "수정 요청됨",
  rejected: "폐기됨",
};

/**
 * 후속 기획 요청을 기록하기 전에 읽히는 사실 셋(SPEC-042 R3). 앱이 아는 것 이상은 말하지 않는다 —
 * 무엇이 만들어질지도, 다음에 무엇을 해야 할지도 예고하지 않는다.
 */
const FOLLOW_UP_FACTS = [
  "기존 승인 결정은 지워지지 않습니다.",
  "이 기획서에서 나온 개발 작업은 그대로 진행됩니다.",
  "대신 이 기획서가 수정을 요청한 기획으로 바뀝니다.",
];

/** 무엇이 일어나는지 말하는 확인 문구(R4). 개발 작업 QA의 반려 문구와 같은 자리를 쓴다. */
const FOLLOW_UP_CONFIRM_NOTE = "이 기획서에 후속 기획 요청을 기록합니다. 결정 기록은 되돌릴 수 없습니다.";

/** 배지가 무엇을 센 값인지 밝히는 문장. 보드 레인의 `LANE_BASIS_NOTE`와 같은 어법이다. */
const TASK_COUNT_BASIS_NOTE = "현재 작업 그룹을 참조하는 AI 실행 태스크 전체를 셉니다";

const knownTaskStatuses = new Set<string>(taskColumns.map((column) => column.status));

export function SpecWorkspace({
  busy,
  document,
  loading,
  measurePanelWidth = measureElementWidth,
  onDecision,
  onSelect,
  workflow,
}: Props) {
  const [filter, setFilter] = useState<SpecFilter>("all");
  const [commentDecision, setCommentDecision] = useState<CommentDecision | null>(null);
  const [comment, setComment] = useState("");
  const [recorded, setRecorded] = useState<SpecDecisionOutcome | null>(null);
  const approveConfirm = useArmedConfirm();

  useEffect(() => {
    setCommentDecision(null);
    setComment("");
    setRecorded(null);
    approveConfirm.disarm();
  }, [document?.summary.fileName]);

  const filtered = useMemo(
    () => workflow.items.specs.filter((item) => matchesFilter(item, filter)),
    [filter, workflow.items.specs],
  );
  const activeStatus = recorded ?? document?.summary.status;
  const awaitingDecision = activeStatus === "user_review";
  // 승인된 기획서가 여는 칸은 후속 기획 요청 하나뿐이다. 표가 그 밖을 열지 않는다.
  const followUpOpen = !awaitingDecision && openDecisions(activeStatus).includes("revision_requested");
  // 결정 직전에 이 기획서가 승인 상태였는가. 방금 찍은 도장의 이름이 그 답으로 갈린다.
  const stampedAfterApproval = document?.summary.status === "approved";
  // 이력의 원천은 목록 항목이다. `read_spec`은 이벤트를 채우지 않으므로 열린 문서와 같은 파일
  // 이름을 가진 항목에서 찾는다. 결정을 기록하면 그 응답이 목록을 갱신하므로 같은 렌더에서 는다.
  const decisionEvents = useMemo(
    () =>
      workflow.items.specs.find((item) => item.fileName === document?.summary.fileName)?.events ?? [],
    [document?.summary.fileName, workflow.items.specs],
  );

  // 패널 배치. 저장소가 정본이고 이 상태는 화면을 다시 그리기 위한 사본이다. 저장 단위가 앱 전체라
  // 이 화면이 다루지 않는 영역의 항목까지 함께 들고 저장한다.
  const [panelLayout, setPanelLayout] = useState<PanelLayoutState>(() => browserPanelLayoutStore.load());
  // 그리는 너비 계산과 좁은 창 판정이 창 폭을 읽는다. 창이 넓어지면 줄여 그리던 너비가 저장해 둔
  // 값으로 돌아와야 하고, 다시 그리려면 폭이 바뀐 사실이 상태로 들어와야 한다.
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  // 아직 조절하지 않은 패널이 비율 배치로 그려져 있는 폭. 저장소에 기준 너비가 남기 전까지 여기서 든다.
  const [measured, setMeasured] = useState<Partial<Record<DocumentPanel, number>>>({});
  const listRef = useRef<HTMLElement>(null);
  const decisionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const readWidth = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", readWidth);
    return () => window.removeEventListener("resize", readWidth);
  }, []);

  const listEntry = panelLayout.specList;
  const decisionEntry = panelLayout.specDecision;
  const listCollapsed = listEntry?.collapsed ?? false;
  const decisionCollapsed = decisionEntry?.collapsed ?? false;

  /*
   * 기준 너비를 재는 자리 (SPEC-080 R8, R11). 이 화면의 두 패널은 비율 배치라 스타일이 px를 정하지
   * 않으므로 화면에서 재는 수밖에 없다. 저장소에 기준 너비가 남은 뒤에는 그 값이 정본이라 다시 재지
   * 않고, 접힌 동안에는 요소가 없어 재지 않는다. 값이 그대로면 같은 객체를 돌려 다시 그리지 않는다.
   */
  useLayoutEffect(() => {
    setMeasured((previous) => {
      let next = previous;
      for (const [region, element] of [
        ["specList", listRef.current],
        ["specDecision", decisionRef.current],
      ] as const) {
        if (element === null || panelLayout[region]?.baselineWidth !== undefined) continue;
        const width = measurePanelWidth(element);
        if (width <= 0 || next[region] === width) continue;
        next = { ...next, [region]: width };
      }
      return next;
    });
  });

  const baselineWidths: Partial<Record<DocumentPanel, number>> = {
    specList: listEntry?.baselineWidth ?? measured.specList,
    specDecision: decisionEntry?.baselineWidth ?? measured.specDecision,
  };

  /*
   * 그리는 px 너비. 조절하지도 접히지도 않은 패널은 값이 없고, 그때는 격자 규칙의 되돌림 값이 지금과
   * 같은 비율 배치로 그린다. 창이 좁아 저장한 너비를 다 그릴 수 없을 때 값을 줄이는 것도, 접힌 동안
   * 세로 바 폭을 돌려주는 것도 이 계산이 한다. 저장한 값은 그 사이 바뀌지 않는다.
   */
  const renderedWidths = resolveRenderedPanelWidths({
    windowWidth,
    storedWidths: {
      ...(listEntry?.width === undefined ? {} : { specList: listEntry.width }),
      ...(decisionEntry?.width === undefined ? {} : { specDecision: decisionEntry.width }),
    },
    collapsed: [
      ...(listCollapsed ? (["specList"] as const) : []),
      ...(decisionCollapsed ? (["specDecision"] as const) : []),
    ],
  });

  const sidebarLayout = useContext(SidebarLayoutContext);
  /*
   * 본문이 되찾은 폭 (SPEC-080 R8). 사이드바와 이 화면의 두 패널이 함께 더해진다. 사이드바 값은
   * 껍데기가 만들어 통로로 내려보낸 것이고, 껍데기 밖에서 이 화면만 그릴 때는 값이 없다.
   */
  const readingWidth = resolveReadingWidth(
    measureReclaimedWidth([
      ...(sidebarLayout === null ? [] : [sidebarLayout]),
      {
        baselineWidth: baselineWidths.specList,
        renderedWidth: renderedWidths.specList,
        collapsed: listCollapsed,
      },
      {
        baselineWidth: baselineWidths.specDecision,
        renderedWidth: renderedWidths.specDecision,
        collapsed: decisionCollapsed,
      },
    ]),
  );

  /** 한 패널의 항목을 갈아 끼우고 같은 상태를 저장소에 남긴다. 저장 실패는 저장소가 삼킨다. */
  function savePanel(region: DocumentPanel, entry: PanelLayoutEntry) {
    const next: PanelLayoutState = { ...panelLayout, [region]: entry };
    setPanelLayout(next);
    browserPanelLayoutStore.save(next);
  }

  /*
   * 처음 조작하는 순간의 기준 너비를 함께 남긴 항목. 이 패널이 얼마나 좁아졌는지 나중에 잴 자리가
   * 된다. 아직 재지 못했으면 그 자리를 비워 둔다 — 재지 못한 값을 무엇으로 추정하면 읽기 폭이 근거
   * 없이 넓어진다.
   */
  function withBaseline(region: DocumentPanel, entry: PanelLayoutEntry): PanelLayoutEntry {
    const baselineWidth = entry.baselineWidth ?? baselineWidths[region];
    return baselineWidth === undefined ? entry : { ...entry, baselineWidth };
  }

  /** 드래그와 방향키가 정한 너비. 들어오는 값은 조작 요소가 이미 한계 안으로 자른 값이다. */
  function changeWidth(region: DocumentPanel, width: number) {
    savePanel(region, withBaseline(region, { ...panelLayout[region], width }));
  }

  /** 더블클릭. 정해 둔 너비를 지워 격자 규칙의 되돌림 값으로 되돌린다 (SPEC-080 R3, R11). */
  function resetWidth(region: DocumentPanel) {
    const entry: PanelLayoutEntry = { ...panelLayout[region] };
    delete entry.width;
    savePanel(region, entry);
  }

  /*
   * 접고 펴기. 펼칠 때 따로 너비를 되돌리지 않는다. 접는 동안에도 저장한 너비는 그대로 남아 있어,
   * 접힘만 내리면 접기 직전에 그리던 너비가 그대로 다시 나온다. 조절한 적이 없던 패널은 저장한 너비가
   * 없으므로 비율 배치로 돌아간다.
   */
  function collapsePanel(region: DocumentPanel, collapsed: boolean) {
    savePanel(region, withBaseline(region, { ...panelLayout[region], collapsed }));
  }

  const layoutStyle = {
    ...(renderedWidths.specList === undefined ? {} : { "--spec-list-width": `${renderedWidths.specList}px` }),
    ...(renderedWidths.specDecision === undefined
      ? {}
      : { "--spec-decision-width": `${renderedWidths.specDecision}px` }),
  } as CSSProperties;
  // 되찾은 폭이 없으면 변수를 싣지 않는다. 스타일 규칙의 되돌림 값이 지금과 같은 620px을 그린다.
  const readingStyle =
    readingWidth === READING_WIDTH_MIN
      ? undefined
      : ({ "--document-reading-width": `${readingWidth}px` } as CSSProperties);
  // 좁은 창에서는 두 영역이 위아래로 쌓이므로 접힌 자리가 가로 막대가 된다 (SPEC-080 R13).
  const collapsedOrientation = windowWidth <= NARROW_WINDOW_WIDTH ? "horizontal" : "vertical";

  async function decide(outcome: SpecDecisionOutcome) {
    if (outcome !== "approved" && !comment.trim()) return;
    if (await onDecision(outcome, comment.trim())) {
      setRecorded(outcome);
      setCommentDecision(null);
    }
  }

  return (
    <section className="spec-workspace-view">
      <div className="view-heading spec-heading">
        <div>
          <p className="eyebrow">PLANNING REVIEW</p>
          <h1>기획서 검토</h1>
          <p>LLM이 정리한 요구사항을 읽고, 사용자 결정으로 다음 단계를 여세요.</p>
        </div>
        <span className={workflow.items.specs.some((item) => item.status === "user_review") ? "needs-action" : ""}>
          <strong>{workflow.items.specs.filter((item) => item.status === "user_review").length}</strong><small>내 선택 대기</small>
        </span>
      </div>

      <div className="spec-filter-bar" role="tablist" aria-label="기획서 상태 필터">
        {([
          ["all", "전체"],
          ["draft", "작성 중"],
          ["user_review", "선택 대기"],
          ["decided", "결정됨"],
        ] as const).map(([key, label]) => (
          <button
            aria-selected={filter === key}
            className={filter === key ? "active" : ""}
            key={key}
            onClick={() => setFilter(key)}
            role="tab"
          >
            {label}<span>{countFor(workflow.items.specs, key)}</span>
          </button>
        ))}
      </div>

      <div className="spec-workspace-layout" style={layoutStyle}>
        {listCollapsed ? (
          <aside className="spec-list-panel panel-collapsed-slot" aria-label={SPEC_LIST_LABEL}>
            <PanelCollapsedBar
              label={SPEC_LIST_LABEL}
              onExpand={() => collapsePanel("specList", false)}
              orientation={collapsedOrientation}
            />
          </aside>
        ) : (
        <aside className="spec-list-panel" aria-label={SPEC_LIST_LABEL} ref={listRef}>
          <header>
            <strong>{filterLabel(filter)}</strong><small>{filtered.length}개 문서</small>
            <PanelCollapseButton label={SPEC_LIST_LABEL} onCollapse={() => collapsePanel("specList", true)} />
          </header>
          <div className="spec-list-items">
            {filtered.map((item) => (
              <button
                aria-pressed={document?.summary.fileName === item.fileName}
                className={document?.summary.fileName === item.fileName ? "active" : ""}
                key={item.fileName}
                onClick={() => onSelect(item)}
              >
                <span className={`status-pill status-${item.status}`}>
                  {statusLabels[item.status] ?? item.status}
                </span>
                <strong>{item.title}</strong>
                <small>{item.id} · {formatDate(item.updatedAt)}</small>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="panel-empty compact"><Icon name="stamp" /><strong>해당 문서가 없습니다</strong><span>LLM이 기획서를 작성하면 여기에 나타납니다.</span></div>
            )}
          </div>
          <PanelResizeHandle
            label={SPEC_LIST_LABEL}
            onReset={() => resetWidth("specList")}
            onWidthChange={(width) => changeWidth("specList", width)}
            region="specList"
            width={renderedWidths.specList ?? baselineWidths.specList ?? PANEL_LIMITS.specList.minWidth}
          />
        </aside>
        )}

        <section className="spec-reader-panel">
          {loading && <div className="reader-loading">기획서를 불러오는 중…</div>}
          {!loading && !document && (
            <div className="reader-empty"><Icon name="stamp" /><strong>검토할 기획서를 선택하세요</strong><p>목록에서 문서를 선택하면 Markdown 원문과 결정 도구가 열립니다.</p></div>
          )}
          {document && (
            <>
              <header>
                <div><p className="eyebrow">{document.summary.id}</p><h2>{document.summary.title}</h2></div>
                <span className={`status-pill status-${activeStatus}`}>
                  {statusLabels[activeStatus ?? ""] ?? activeStatus}
                </span>
              </header>
              <SpecWorkGroupProgress
                groups={workflow.items.workGroups}
                specId={document.summary.id}
                tasks={workflow.items.tasks}
              />
              <article className="spec-paper embedded" style={readingStyle}>
                {/* 문서가 바뀌면 다시 평문에서 시작한다. 이 자리는 문서만 갈아 끼우므로 `key`가 그 몫이다. */}
                <DocumentReader body={document.body} key={document.summary.fileName} />
                {recorded && (
                  <div
                    aria-live="polite"
                    className={`decision-stamp ${recorded}${stampedAfterApproval ? " follow-up" : ""}`}
                  >
                    <Icon name="stamp" />
                    <strong>{specDecisionLabel(recorded, stampedAfterApproval)}</strong>
                    <small>USER DECISION</small>
                  </div>
                )}
              </article>
            </>
          )}
        </section>

        {decisionCollapsed ? (
          <aside className="decision-panel panel-collapsed-slot">
            <PanelCollapsedBar
              label={SPEC_DECISION_LABEL}
              onExpand={() => collapsePanel("specDecision", false)}
              orientation={collapsedOrientation}
            />
          </aside>
        ) : (
        <aside className="decision-panel" ref={decisionRef}>
          <div className="decision-panel-heading">
            <p className="eyebrow">USER GATE</p>
            <PanelCollapseButton
              label={SPEC_DECISION_LABEL}
              onCollapse={() => collapsePanel("specDecision", true)}
            />
          </div>
          <h2>사용자 결정</h2>
          {!document && <p className="decision-help">기획서를 선택하면 승인·수정 요청·폐기 도구가 활성화됩니다.</p>}
          {document && awaitingDecision && !commentDecision && (
            <>
              <div className="decision-callout"><Icon name="stamp" /><strong>검토가 필요합니다</strong><p>이 결정은 별도 Markdown 감사 로그로 보존됩니다.</p></div>
              {approveConfirm.armed && (
                <p className="confirm-warning" role="status">이 기획서를 승인합니다. 승인 기록은 되돌릴 수 없습니다.</p>
              )}
              <button
                className={`stamp-button full ${approveConfirm.armed ? "armed" : ""}`}
                disabled={busy}
                onClick={() => approveConfirm.fire(() => void decide("approved"))}
              >
                <Icon name="stamp" />{approveConfirm.armed ? "한 번 더 누르면 승인" : "승인 도장 찍기"}
                {approveConfirm.armed && <i aria-hidden="true" className="confirm-timer" />}
              </button>
              <button
                className="secondary-button revision full"
                disabled={busy}
                onClick={() => {
                  approveConfirm.disarm();
                  setCommentDecision("revision_requested");
                }}
              ><Icon name="workflow" />수정 요청</button>
              <button
                className="secondary-button reject full"
                disabled={busy}
                onClick={() => {
                  approveConfirm.disarm();
                  setCommentDecision("rejected");
                }}
              >기획서 폐기</button>
            </>
          )}
          {document && awaitingDecision && commentDecision && (
            <div className="rejection-form side">
              <label htmlFor="decision-comment">{commentDecision === "revision_requested" ? "수정 요청 내용" : "폐기 사유"}</label>
              <textarea
                autoFocus
                id="decision-comment"
                maxLength={2_000}
                onChange={(event) => setComment(event.target.value)}
                placeholder={commentDecision === "revision_requested" ? "다시 검토할 범위와 원하는 방향을 구체적으로 적어주세요." : "폐기 이유를 기록해 주세요."}
                value={comment}
              />
              <div><button className="text-button" onClick={() => setCommentDecision(null)}>취소</button><button className={commentDecision === "revision_requested" ? "secondary-button" : "danger-button"} disabled={busy || !comment.trim()} onClick={() => void decide(commentDecision)}>{commentDecision === "revision_requested" ? "수정 요청 기록" : "폐기 기록"}</button></div>
            </div>
          )}
          {document && !awaitingDecision && (
            <div className={`decision-result ${activeStatus}`}>
              <Icon name={activeStatus === "approved" ? "stamp" : activeStatus === "revision_requested" ? "workflow" : "archive"} />
              <strong>{activeStatus === "approved" ? "승인된 기획입니다" : activeStatus === "revision_requested" ? "수정을 요청한 기획입니다" : activeStatus === "rejected" ? "폐기된 기획입니다" : "아직 작성 중입니다"}</strong>
              {recorded && <p>결정 Markdown을 안전하게 저장했습니다.</p>}
              {!recorded && activeStatus === "draft" && (
                <p>LLM이 status를 user_review로 변경하면 결정을 내릴 수 있습니다.</p>
              )}
              {/*
                결정이 어떻게 보존되는지는 아래 이력이 실물로 답하므로 그 자리에서는 같은 말을 두 번
                하지 않는다. 이력이 설 것이 없는 기획서에서는 이 문장이 남는다 — 없앤 자리를 대신할
                것이 없는데 지우면 화면이 더 적게 말하게 된다.
              */}
              {!recorded && activeStatus !== "draft" && decisionEvents.length === 0 && (
                <p>결정 기록은 원문과 분리되어 보존됩니다.</p>
              )}
            </div>
          )}
          {document && followUpOpen && !commentDecision && (
            <button
              className="secondary-button revision full"
              disabled={busy}
              onClick={() => setCommentDecision("revision_requested")}
            ><Icon name="workflow" />{FOLLOW_UP_LABEL}</button>
          )}
          {document && followUpOpen && commentDecision && (
            <div className="rejection-form side">
              <ul className="follow-up-facts">
                {FOLLOW_UP_FACTS.map((fact) => <li key={fact}>{fact}</li>)}
              </ul>
              <p className="confirm-warning" role="status">{FOLLOW_UP_CONFIRM_NOTE}</p>
              <label htmlFor="follow-up-comment">{FOLLOW_UP_LABEL} 내용</label>
              <textarea
                autoFocus
                id="follow-up-comment"
                maxLength={2_000}
                onChange={(event) => setComment(event.target.value)}
                placeholder="이 기획에 무엇을 더 하고 싶은지 구체적으로 적어주세요."
                value={comment}
              />
              <div>
                <button className="text-button" onClick={() => setCommentDecision(null)}>취소</button>
                <button
                  className="secondary-button"
                  disabled={busy || !comment.trim()}
                  onClick={() => void decide("revision_requested")}
                >{FOLLOW_UP_LABEL} 기록</button>
              </div>
            </div>
          )}
          {document && <SpecDecisionHistory events={decisionEvents} />}
          <PanelResizeHandle
            grabSide="left"
            label={SPEC_DECISION_LABEL}
            onReset={() => resetWidth("specDecision")}
            onWidthChange={(width) => changeWidth("specDecision", width)}
            region="specDecision"
            width={renderedWidths.specDecision ?? baselineWidths.specDecision ?? PANEL_LIMITS.specDecision.minWidth}
          />
        </aside>
        )}
      </div>
    </section>
  );
}

/**
 * 이 기획서에 찍힌 도장을 시각순으로 읽는 자리(SPEC-042 R7).
 *
 * 결정이 하나뿐인 기획서에서도 한 줄로 편다. 갈래를 두면 어느 기획서에서 이력을 볼 수 있는지
 * 사용자가 미리 알 수 없다(확인 필요 3번). 항목 이름은 `specDecisionLabels`가 정한다.
 *
 * 읽기 전용이다. 결정을 고치거나 지우는 자리를 만들지 않는다 — 감사 로그는 덧쓰기만 한다.
 */
function SpecDecisionHistory({ events }: { events: TaskEvent[] }) {
  const entries = useMemo(() => labelSpecDecisions(events), [events]);

  // 결정이 아직 없는 기획서에는 읽을 이력이 없다. 빈 상자를 그리지 않는다.
  if (entries.length === 0) return null;

  return (
    <section aria-label="결정 이력" className="spec-decision-history">
      <strong>결정 이력</strong>
      <ol>
        {entries.map((entry) => (
          <li key={`${entry.at}-${entry.kind}`}>
            <span>{entry.label}</span>
            <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 기획서의 작업 그룹 상태와 AI 검증 진척을 한 줄로 보여 준다. */
function SpecWorkGroupProgress({ groups, specId, tasks }: {
  groups: WorkGroupSummary[];
  specId: string;
  tasks: WorkflowItemSummary[];
}) {
  const group = groups.find((candidate) => candidate.sourceSpecId === specId) ?? null;
  const counts = useMemo(
    () => group ? countTasksOfGroup(group.id, tasks) : { byStatus: {}, total: 0, unknown: 0 },
    [group, tasks],
  );

  return (
    <section aria-label="작업 그룹 진행" className="spec-task-counts">
      {!group ? (
        <p className="spec-task-counts-empty">승인 뒤 아키텍트가 작업 그룹을 만들면 진행 상태가 여기에 나타납니다.</p>
      ) : (
        <>
          <p className="spec-task-counts-list">
            <span>{workGroupStatusLabel(group)}</span>
            <span>완료 {counts.byStatus.verified ?? 0} / {counts.total}</span>
            {counts.unknown > 0 && <span>규격 밖 {counts.unknown}</span>}
          </p>
          <small>{group.id} · revision {group.revision}</small>
        </>
      )}
      {group && <small>{TASK_COUNT_BASIS_NOTE}</small>}
      {group && <GroupAttentionNote group={group} />}
    </section>
  );
}

function countTasksOfGroup(groupId: string, tasks: WorkflowItemSummary[]) {
  const byStatus: Record<string, number> = Object.fromEntries(taskColumns.map((column) => [column.status, 0]));
  let total = 0;
  let unknown = 0;

  for (const task of tasks) {
    if (task.workGroupId !== groupId) continue;
    total += 1;
    if (knownTaskStatuses.has(task.status)) byStatus[task.status] += 1;
    else unknown += 1;
  }

  return { byStatus, total, unknown };
}

function workGroupStatusLabel(group: WorkGroupSummary) {
  return {
    completed: "사용자 QA 완료",
    rework: "아키텍트 재분류 대기",
    preparing: "아키텍트 구성 중",
    preparing_stalled: "구성 중단 의심",
    blocked: "개발 막힘",
    developing: "개발 중",
    qa_ready: "사용자 QA 대기",
    automatic_completed: "완료",
    configuration_error: "구성 확인 필요",
    human_judgment_required: "사람 판단 필요",
    suspended: "중단됨",
    discarded: "폐기됨",
  }[group.displayStatus];
}

/**
 * 이 상태의 기획서에서 화면이 여는 결정. TASK-127이 쓰기 경로에 세운 허용 조합 표와 같은 조합이다.
 *
 * 표에 없는 상태는 아무것도 열지 않는다. 화면이 표보다 넓게 열면 사용자가 버튼을 누르고 오류를
 * 보고, 좁게 열면 쓰기 경로에 난 길이 닿지 않는다.
 */
function openDecisions(status: string | undefined): SpecDecisionOutcome[] {
  if (status === "user_review") return ["approved", "revision_requested", "rejected"];
  if (status === "approved") return ["revision_requested"];
  return [];
}

function matchesFilter(item: WorkflowItemSummary, filter: SpecFilter) {
  if (filter === "all") return true;
  if (filter === "decided") return ["approved", "revision_requested", "rejected"].includes(item.status);
  return item.status === filter;
}

function countFor(items: WorkflowItemSummary[], filter: SpecFilter) {
  return items.filter((item) => matchesFilter(item, filter)).length;
}

function filterLabel(filter: SpecFilter) {
  return { all: "모든 기획서", draft: "작성 중", user_review: "내 선택 대기", decided: "결정된 기획서" }[filter];
}

function formatDate(value: string | null) {
  if (!value) return "시간 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(date);
}

/** 이력은 "언제"를 묻는 자리라 날짜만으로는 같은 날 찍힌 두 도장이 갈리지 않는다. */
function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
