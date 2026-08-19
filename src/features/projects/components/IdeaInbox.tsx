import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "../../../shared/ui/Icon";
import type {
  IdeaDocument,
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
import { IdeaComposer } from "./IdeaComposer";
import { MarkdownBody } from "./MarkdownBody";
import {
  PanelCollapseButton,
  PanelCollapsedBar,
  PanelResizeHandle,
} from "./PanelLayoutControls";
import { SidebarLayoutContext } from "./WorkspaceShell";

type IdeaBodyState =
  | { kind: "loading" }
  | { kind: "loaded"; body: string }
  | { kind: "failed" };

type IdeaState = "inbox" | "drafting" | "redrafting" | "closed" | "adopted";

/** 백엔드가 파생해 실어 보낸 값이다. 화면이 판정을 다시 하지 않는다(SPEC-012 R6). */
function ideaState(item: WorkflowItemSummary): IdeaState {
  return item.status === "drafting" ||
    item.status === "redrafting" ||
    item.status === "closed" ||
    item.status === "adopted"
    ? item.status
    : "inbox";
}

const stateLabels: Record<IdeaState, string> = {
  inbox: "수집됨",
  drafting: "반영중",
  redrafting: "재반영중",
  closed: "종결",
  adopted: "채택",
};

const stateIcons: Record<IdeaState, IconName> = {
  inbox: "idea",
  drafting: "refresh",
  redrafting: "refresh",
  closed: "archive",
  adopted: "stamp",
};

const statePillClasses: Record<IdeaState, string> = {
  inbox: "",
  drafting: "status-drafting",
  redrafting: "status-redrafting",
  closed: "status-rejected",
  adopted: "status-approved",
};

function isStalled(item: WorkflowItemSummary): boolean {
  return (item.stalledSpecIds?.length ?? 0) > 0;
}

interface Props {
  busy: boolean;
  disabled: boolean;
  /**
   * 패널이 지금 그려져 있는 폭을 재는 자리. jsdom은 배치를 계산하지 않아 실제 측정이 0으로 나오므로,
   * 시험이 이 자리를 바꿔 끼워 기준 너비를 확인한다.
   */
  measurePanelWidth?(element: HTMLElement): number;
  onAdd(content: string): Promise<boolean>;
  onReadIdea(fileName: string): Promise<IdeaDocument | null>;
  workflow: WorkflowSummary;
}

/** 조작 요소의 접근 이름과 툴팁이 이 값에서 나온다. */
const IDEA_LIST_LABEL = "아이디어 목록";

function measureElementWidth(element: HTMLElement) {
  return element.getBoundingClientRect().width;
}

export function IdeaInbox({
  busy,
  disabled,
  measurePanelWidth = measureElementWidth,
  onAdd,
  onReadIdea,
  workflow,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    workflow.items.ideas[0]?.id ?? null,
  );

  useEffect(() => {
    if (!workflow.items.ideas.some((item) => item.id === selectedId)) {
      setSelectedId(workflow.items.ideas[0]?.id ?? null);
    }
  }, [selectedId, workflow.items.ideas]);

  const selected = useMemo(
    () => workflow.items.ideas.find((item) => item.id === selectedId) ?? null,
    [selectedId, workflow.items.ideas],
  );

  const [body, setBody] = useState<IdeaBodyState | null>(null);

  // 패널 배치. 저장소가 정본이고 이 상태는 화면을 다시 그리기 위한 사본이다. 저장 단위가 앱 전체라
  // 이 화면이 다루지 않는 영역의 항목까지 함께 들고 저장한다.
  const [panelLayout, setPanelLayout] = useState<PanelLayoutState>(() => browserPanelLayoutStore.load());
  // 그리는 너비 계산과 좁은 창 판정이 창 폭을 읽는다.
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  // 아직 조절하지 않은 패널이 비율 배치로 그려져 있는 폭. 저장소에 기준 너비가 남기 전까지 여기서 든다.
  const [measured, setMeasured] = useState<number | undefined>(undefined);
  const listPanelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const readWidth = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", readWidth);
    return () => window.removeEventListener("resize", readWidth);
  }, []);

  const listEntry = panelLayout.ideaList;
  const listCollapsed = listEntry?.collapsed ?? false;

  /*
   * 기준 너비를 재는 자리 (SPEC-080 R8, R11). 이 패널은 비율 배치라 스타일이 px를 정하지 않으므로
   * 화면에서 재는 수밖에 없다. 저장소에 기준 너비가 남은 뒤에는 그 값이 정본이라 다시 재지 않고,
   * 접힌 동안에는 요소가 없어 재지 않는다.
   */
  useLayoutEffect(() => {
    if (listPanelRef.current === null || listEntry?.baselineWidth !== undefined) return;
    const width = measurePanelWidth(listPanelRef.current);
    if (width > 0) setMeasured((previous) => (previous === width ? previous : width));
  });

  const baselineWidth = listEntry?.baselineWidth ?? measured;

  /*
   * 그리는 px 너비. 조절하지도 접히지도 않은 패널은 값이 없고, 그때는 격자 규칙의 되돌림 값이 지금과
   * 같은 비율 배치로 그린다. 창이 좁아 저장한 너비를 다 그릴 수 없을 때 값을 줄이는 것도, 접힌 동안
   * 세로 바 폭을 돌려주는 것도 이 계산이 한다.
   */
  const renderedWidth = resolveRenderedPanelWidths({
    windowWidth,
    storedWidths: listEntry?.width === undefined ? {} : { ideaList: listEntry.width },
    collapsed: listCollapsed ? ["ideaList"] : [],
  }).ideaList;

  const sidebarLayout = useContext(SidebarLayoutContext);
  /*
   * 본문이 되찾은 폭 (SPEC-080 R8). 사이드바와 이 화면의 목록 패널이 함께 더해진다. 사이드바 값은
   * 껍데기가 만들어 통로로 내려보낸 것이고, 껍데기 밖에서 이 화면만 그릴 때는 값이 없다.
   */
  const readingWidth = resolveReadingWidth(
    measureReclaimedWidth([
      ...(sidebarLayout === null ? [] : [sidebarLayout]),
      { baselineWidth, renderedWidth, collapsed: listCollapsed },
    ]),
  );

  /** 목록 패널의 항목을 갈아 끼우고 같은 상태를 저장소에 남긴다. 저장 실패는 저장소가 삼킨다. */
  function savePanel(entry: PanelLayoutEntry) {
    const next: PanelLayoutState = { ...panelLayout, ideaList: entry };
    setPanelLayout(next);
    browserPanelLayoutStore.save(next);
  }

  /*
   * 처음 조작하는 순간의 기준 너비를 함께 남긴 항목. 이 패널이 얼마나 좁아졌는지 나중에 잴 자리가
   * 된다. 아직 재지 못했으면 그 자리를 비워 둔다.
   */
  function withBaseline(entry: PanelLayoutEntry): PanelLayoutEntry {
    const kept = entry.baselineWidth ?? baselineWidth;
    return kept === undefined ? entry : { ...entry, baselineWidth: kept };
  }

  /** 드래그와 방향키가 정한 너비. 들어오는 값은 조작 요소가 이미 한계 안으로 자른 값이다. */
  function changeWidth(width: number) {
    savePanel(withBaseline({ ...listEntry, width }));
  }

  /** 더블클릭. 정해 둔 너비를 지워 격자 규칙의 되돌림 값으로 되돌린다 (SPEC-080 R3, R11). */
  function resetWidth() {
    const entry: PanelLayoutEntry = { ...listEntry };
    delete entry.width;
    savePanel(entry);
  }

  /*
   * 접고 펴기. 펼칠 때 따로 너비를 되돌리지 않는다. 접는 동안에도 저장한 너비는 그대로 남아 있어,
   * 접힘만 내리면 접기 직전에 그리던 너비가 그대로 다시 나온다.
   */
  function collapsePanel(collapsed: boolean) {
    savePanel(withBaseline({ ...listEntry, collapsed }));
  }

  const layoutStyle = (
    renderedWidth === undefined ? {} : { "--idea-list-width": `${renderedWidth}px` }
  ) as CSSProperties;
  // 되찾은 폭이 없으면 변수를 싣지 않는다. 스타일 규칙의 되돌림 값이 지금과 같은 620px을 그린다.
  const readingStyle =
    readingWidth === READING_WIDTH_MIN
      ? undefined
      : ({ "--document-reading-width": `${readingWidth}px` } as CSSProperties);
  // 좁은 창에서는 두 영역이 위아래로 쌓이므로 접힌 자리가 가로 막대가 된다 (SPEC-080 R13).
  const collapsedOrientation = windowWidth <= NARROW_WINDOW_WIDTH ? "horizontal" : "vertical";

  // 폴링이 2.5초마다 조회 함수의 정체성을 바꾸므로 효과 의존성에 넣지 않는다.
  const readIdea = useRef(onReadIdea);
  useEffect(() => {
    readIdea.current = onReadIdea;
  }, [onReadIdea]);

  const selectedFileName = selected?.fileName ?? null;
  useEffect(() => {
    if (!selectedFileName) {
      setBody(null);
      return;
    }
    let cancelled = false;
    setBody({ kind: "loading" });
    void readIdea.current(selectedFileName).then(
      (document) => {
        if (cancelled) return;
        setBody(
          document ? { kind: "loaded", body: document.body } : { kind: "failed" },
        );
      },
      () => {
        if (!cancelled) setBody({ kind: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectedFileName]);

  return (
    <section className="idea-inbox-view">
      <ViewHeading
        count={workflow.items.ideas.length}
        description="정리되지 않은 생각을 먼저 수집하고, 기획으로 발전시킬 재료를 골라보세요."
        title="아이디어 인박스"
      />

      <IdeaComposer busy={busy} disabled={disabled} onAdd={onAdd} workflowDirectory={workflow.directory} />

      <div className="idea-inbox-layout" style={layoutStyle}>
        {listCollapsed ? (
          <section className="idea-list-panel panel-collapsed-slot" aria-label={IDEA_LIST_LABEL}>
            <PanelCollapsedBar
              label={IDEA_LIST_LABEL}
              onExpand={() => collapsePanel(false)}
              orientation={collapsedOrientation}
            />
          </section>
        ) : (
        <section className="idea-list-panel" aria-label={IDEA_LIST_LABEL} ref={listPanelRef}>
          <header>
            <div><strong>최근 아이디어</strong><small>최신 업데이트 순</small></div>
            <span>{workflow.items.ideas.length}</span>
            <PanelCollapseButton label={IDEA_LIST_LABEL} onCollapse={() => collapsePanel(true)} />
          </header>
          <div className="idea-list">
            {workflow.items.ideas.map((item) => (
              <IdeaListRow
                item={item}
                key={item.fileName}
                onSelect={() => setSelectedId(item.id)}
                selected={item.id === selectedId}
              />
            ))}
            {workflow.items.ideas.length === 0 && (
              <EmptyPanel
                description="위 입력창에 첫 번째 생각을 남겨보세요."
                title="인박스가 비어 있습니다"
              />
            )}
          </div>
          <PanelResizeHandle
            label={IDEA_LIST_LABEL}
            onReset={resetWidth}
            onWidthChange={changeWidth}
            region="ideaList"
            width={renderedWidth ?? baselineWidth ?? PANEL_LIMITS.ideaList.minWidth}
          />
        </section>
        )}

        <IdeaPreview body={body} item={selected} readingStyle={readingStyle} />
      </div>
    </section>
  );
}

function IdeaListRow({
  item,
  onSelect,
  selected,
}: {
  item: WorkflowItemSummary;
  onSelect(): void;
  selected: boolean;
}) {
  const state = ideaState(item);
  return (
    <button
      aria-pressed={selected}
      className={selected ? "active" : ""}
      onClick={onSelect}
    >
      <span className={`idea-list-icon ${state}`}>
        <Icon name={stateIcons[state]} />
      </span>
      <span>
        <strong>{item.title}</strong>
        <small>{item.excerpt || "내용 미리보기가 없습니다."}</small>
      </span>
      <span className="idea-list-meta">
        <time>{formatDate(item.updatedAt)}</time>
        {(state !== "inbox" || isStalled(item)) && (
          <span className="idea-list-tags">
            {state !== "inbox" && (
              <small className={`idea-state-tag ${state}`}>{stateLabels[state]}</small>
            )}
            {isStalled(item) && <small className="idea-state-tag stalled">중단 의심</small>}
          </span>
        )}
      </span>
    </button>
  );
}

function IdeaPreview({
  body,
  item,
  readingStyle,
}: {
  body: IdeaBodyState | null;
  item: WorkflowItemSummary | null;
  /** 본문의 읽기 폭 상한. 되찾은 폭이 없으면 값이 없고, 그때는 스타일 규칙의 되돌림 값이 그린다. */
  readingStyle: CSSProperties | undefined;
}) {
  if (!item) {
    return (
      <section className="idea-preview empty">
        <Icon name="idea" />
        <strong>아이디어를 선택하세요</strong>
        <p>목록에서 항목을 선택하면 핵심 내용과 문서 정보를 확인할 수 있습니다.</p>
      </section>
    );
  }

  const state = ideaState(item);

  return (
    <article className="idea-preview">
      <header>
        <div>
          <p className="eyebrow">IDEA NOTE</p>
          <h2>{item.title}</h2>
        </div>
        <span className={`status-pill ${statePillClasses[state]}`}>{stateLabels[state]}</span>
      </header>
      {isStalled(item) && (
        <p className="idea-stall-note">
          <strong>중단 의심</strong>
          <span>
            이 아이디어를 선점한 세션이 없는데 작성 중이던 기획서가 남아 있습니다. 걸린 기획서:{" "}
            {item.stalledSpecIds?.join(", ")}. 다음 기획자 세션이 이 문서를 이어받아 계속 작성합니다.
          </span>
        </p>
      )}
      {/*
        중단 의심과 함께 뜨지 않는다. `stalledSpecIds`는 반영중과 재반영중에서만 채워지므로 종결과는
        배타적이고, 그래서 두 안내가 같은 자리·같은 모양을 나눠 쓴다(SPEC-018 R6, SPEC-082 R6).
      */}
      {state === "closed" && (
        <p className="idea-stall-note">
          <strong>종결</strong>
          <span>
            이 아이디어에서 나온 기획서가 모두 반려로 끝났습니다. 자동 처리로 다시 잡히지 않으므로,
            다시 진행하려면 위 입력창에서 새 아이디어로 요청해야 합니다.
          </span>
        </p>
      )}
      <div className="idea-preview-body" key={item.fileName} style={readingStyle}>
        {body?.kind === "loaded" ? (
          <MarkdownBody body={body.body} preserveLineBreaks />
        ) : (
          <p className="idea-preview-note">
            {body?.kind === "failed"
              ? "아이디어 전문을 불러오지 못했습니다."
              : "아이디어를 불러오는 중…"}
          </p>
        )}
      </div>
      <footer>
        <div><span>문서 ID</span><strong>{item.id}</strong></div>
        <div><span>업데이트</span><strong>{formatDate(item.updatedAt)}</strong></div>
        <code>{item.fileName}</code>
      </footer>
    </article>
  );
}

function ViewHeading({
  count,
  description,
  title,
}: {
  count: number;
  description: string;
  title: string;
}) {
  return (
    <div className="view-heading">
      <div><p className="eyebrow">IDEA INBOX</p><h1>{title}</h1><p>{description}</p></div>
      <span><strong>{count}</strong><small>수집된 생각</small></span>
    </div>
  );
}

function EmptyPanel({ description, title }: { description: string; title: string }) {
  return (
    <div className="panel-empty">
      <Icon name="idea" />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "시간 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
}
