import { createContext, useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  CustomRulesActions,
  CustomRulesState,
  IdeaDocument,
  IntegrationActions,
  IntegrationsState,
  ManagedAssetsState,
  ProjectSummary,
  SpecDecisionOutcome,
  AgentRuntimeActions,
  AgentRuntimeState,
  TaskDocument,
  SpecDocument,
  WorkGroupLifecycleOutcomeResult,
  WorkGroupLifecycleRequest,
  WorkGroupQaSubmission,
  WorkGroupQaSubmissionResult,
  WorkGroupSummary,
  WorkflowItemSummary,
  WorkflowSummary,
} from "../domain/types";
import type { AppUpdaterState } from "../../updater/domain/types";
import {
  DEVELOPMENT_MENU_KEY,
  IDEAS_MENU_KEY,
  MENU_KEYS,
  browserMenuLastSeenStore,
} from "../infrastructure/browserMenuLastSeenStore";
import {
  PANEL_LIMITS,
  defaultPanelWidth,
  resolveRenderedPanelWidths,
  type PanelReclaimInput,
} from "../domain/panelLayout";
import {
  browserPanelLayoutStore,
  type PanelLayoutEntry,
  type PanelLayoutState,
} from "../infrastructure/browserPanelLayoutStore";
import { UpdateControl } from "../../updater/components/UpdateControl";
import { Icon } from "../../../shared/ui/Icon";
import { AgentRuntimeView, ExecutionConsentDialog } from "./agents/AgentRuntimeView";
import { DevelopmentBoard } from "./DevelopmentBoard";
import { HelpView } from "./HelpView";
import { IdeaComposer } from "./IdeaComposer";
import { IdeaInbox } from "./IdeaInbox";
import { MarkdownBody } from "./MarkdownBody";
import {
  PanelCollapseButton,
  PanelCollapsedBar,
  PanelResizeHandle,
} from "./PanelLayoutControls";
import { ProjectSearchDialog, type SearchItemKind } from "./ProjectSearchDialog";
import { QaWorkbench } from "./qa/QaWorkbench";
import { SettingsView } from "./SettingsView";
import { SpecWorkspace } from "./SpecWorkspace";

interface Props {
  busy: boolean;
  customRules: CustomRulesState;
  customRulesActions: CustomRulesActions;
  error: string | null;
  managedAssets: ManagedAssetsState;
  project: ProjectSummary;
  updater: AppUpdaterState;
  /** 전용 연동 화면 제거 전 테스트·호출자 호환. 화면에서는 사용하지 않는다. */
  integrations?: IntegrationsState;
  integrationActions?: IntegrationActions;
  onAddIdea(workflowDirectory: string, content: string): Promise<boolean>;
  onAddWorkflow(name: string): Promise<boolean>;
  onDecideSpec(
    workflowDirectory: string,
    fileName: string,
    outcome: SpecDecisionOutcome,
    comment: string,
  ): Promise<boolean>;
  onMigrate(): Promise<boolean>;
  onReadIdea(
    workflowDirectory: string,
    fileName: string,
  ): Promise<IdeaDocument | null>;
  onReadSpec(
    workflowDirectory: string,
    fileName: string,
  ): Promise<SpecDocument | null>;
  onReadTask(
    workflowDirectory: string,
    fileName: string,
  ): Promise<TaskDocument | null>;
  /** 작업 그룹 revision 전체에 사용자 QA 결정 하나를 기록한다. */
  onWorkGroupQaSubmit?(submission: WorkGroupQaSubmission): Promise<WorkGroupQaSubmissionResult | null>;
  onWorkGroupLifecycle?(request: WorkGroupLifecycleRequest): Promise<WorkGroupLifecycleOutcomeResult>;
  /**
   * 에이전트 화면의 상태와 조작. 주인이 작업 공간 훅이라 화면을 옮겨 다녀도 진행 표시가 남는다.
   * 선택인 것은 이 껍데기를 그리는 검사 리터럴이 아직 이 묶음을 모르기 때문이다.
   */
  agentRuntime?: AgentRuntimeState;
  agentRuntimeActions?: AgentRuntimeActions;
  onRefresh(): Promise<void> | void;
  onSwitchProject(): void;
}

const stages = [
  { key: "ideas", label: "아이디어", icon: "idea" as const },
  { key: "specs", label: "기획서", icon: "stamp" as const },
  { key: "workGroups", label: "개발", icon: "board" as const },
  { key: "reports", label: "완료", icon: "archive" as const },
] as const;

const viewLabels = {
  today: "오늘",
  ideas: "아이디어",
  specs: "기획서",
  tasks: "개발",
  qa: "품질 확인",
  archive: "기록",
  agents: "에이전트",
  help: "도움말",
  settings: "설정",
} as const;

/**
 * 워크플로우 하나가 지금 사용자에게 요구하는 결정을 센다. 사이드 메뉴의 두 숫자, 오늘 화면의
 * "내 선택 대기" 배지, 워크플로우 목록의 대기 점이 모두 이 함수를 거치므로 네 자리가 서로 다른
 * 수를 말하지 않는다. 조건식을 여기 하나로 둔 것이 그 보장의 전부다.
 * 선택된 워크플로우가 아직 정해지지 않은 첫 렌더에서는 workflow가 없고, 그때는 셀 것이 없다.
 */
function pendingDecisions(workflow: WorkflowSummary | undefined) {
  const specs = workflow?.items.specs.filter((item) => item.status === "user_review") ?? [];
  const qaFeatures =
    workflow?.items.workGroups.filter(
      (group) => group.qaMode === "user" && group.displayStatus === "qa_ready",
    ) ?? [];
  return { specs, qaFeatures, total: specs.length + qaFeatures.length };
}

/**
 * 마지막으로 확인한 뒤에 바뀐 문서가 있는지 본다.
 *
 * 확인 기록이 없으면 비교할 기준이 없으므로 켜지 않는다. 마지막 변경 시각이 없거나 시각으로 읽을 수
 * 없는 문서도 판정에서 뺀다. 언제 바뀌었는지 모르는 문서가 점을 켜는 근거가 되면, 그 문서가 남아
 * 있는 동안 점이 꺼지지 않는다.
 */
function hasChangedSince(
  items: { updatedAt: string | null }[],
  seenAt: string | undefined,
): boolean {
  const seen = seenAt ? Date.parse(seenAt) : Number.NaN;
  if (!Number.isFinite(seen)) return false;
  return items.some((item) => {
    const changed = item.updatedAt ? Date.parse(item.updatedAt) : Number.NaN;
    return Number.isFinite(changed) && changed > seen;
  });
}

/**
 * 메뉴 이름 옆의 대기 건수. 셀 것이 없으면 요소 자체를 그리지 않아 그 메뉴는 변경 전과 같은 모양,
 * 같은 접근 이름으로 남는다. 숫자는 눈으로만 읽는 표시라 가리고, 무엇이 몇 건인지는 화면 읽기
 * 도구가 버튼 이름으로 함께 듣도록 따로 적는다.
 */
function NavBadge({ count, label }: { count: number; label: string }) {
  if (count < 1) return null;
  return (
    <>
      <span aria-hidden="true" className="nav-badge">{count}</span>
      {/* 접근 이름은 형제 노드를 구분자 없이 잇는다. 쉼표를 앞에 두지 않으면 "기획서승인 대기"로 들린다. */}
      <span className="visually-hidden">, {label} {count}건</span>
    </>
  );
}

/**
 * 메뉴 이름 옆의 변경 점. 켤 조건이 아니면 요소 자체를 그리지 않아 그 메뉴는 변경 전과 같은 모양,
 * 같은 접근 이름으로 남는다. 점은 눈으로만 읽는 표시라 가리고, 무엇이 달라졌는지는 화면 읽기 도구가
 * 버튼 이름으로 함께 듣도록 따로 적는다. 순서는 NavBadge와 같아 메뉴 이름이 앞에 온다.
 */
function NavChangeDot({ changed }: { changed: boolean }) {
  if (!changed) return null;
  return (
    <>
      <span aria-hidden="true" className="nav-change-dot" />
      <span className="visually-hidden">, 새로운 변경 있음</span>
    </>
  );
}

/** 사이드바를 가리키는 이름. 핸들과 접기 버튼과 세로 바의 접근 이름과 툴팁이 이 값에서 나온다. */
const SIDEBAR_LABEL = "사이드바";

/**
 * 사이드바가 지금 차지하고 있는 자리 (SPEC-080 R8). 값 그대로 `measureReclaimedWidth`에 넣을 수 있는
 * 모양이며, 기획서 화면과 아이디어 화면의 읽기 폭 계산이 TASK-S080-04에서 이것을 읽는다.
 *
 * props로 내려보내지 않은 것은 받는 두 화면 파일이 이 작업의 선언 범위 밖이기 때문이다. 그 파일들의
 * props를 여기서 만들 수 없으므로, 값을 만드는 자리만 고쳐 통로를 세우는 방법이 이것뿐이다.
 */
export const SidebarLayoutContext = createContext<PanelReclaimInput | null>(null);

export function WorkspaceShell({
  agentRuntime,
  agentRuntimeActions,
  busy,
  customRules,
  customRulesActions,
  error,
  managedAssets,
  project,
  updater,
  onAddIdea,
  onAddWorkflow,
  onDecideSpec,
  onMigrate,
  onReadIdea,
  onReadSpec,
  onReadTask,
  onWorkGroupQaSubmit = async () => null,
  onWorkGroupLifecycle = async () => ({ ok: false as const, message: "그룹 결정 통로가 연결되지 않았습니다." }),
  onRefresh,
  onSwitchProject,
}: Props) {
  const [selectedDirectory, setSelectedDirectory] = useState(
    project.workflows[0]?.directory ?? "",
  );
  const [showWorkflowForm, setShowWorkflowForm] = useState(false);
  const [workflowName, setWorkflowName] = useState("");
  const [view, setView] = useState<
    | "today"
    | "ideas"
    | "specs"
    | "tasks"
    | "qa"
    | "archive"
    | "agents"
    | "help"
    | "settings"
  >("today");
  const [specDocument, setSpecDocument] = useState<SpecDocument | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  // 품질 확인 작업대를 열 때 함께 넘길 기능 묶음. 그룹 id는 워크플로우 안에서만 유일할 수 있으므로
  // 디렉터리와 함께 보관한다. 같은 id를 쓰는 다른 워크플로우로 이동해도 그 기능이 잘못 열리지 않는다.
  const [qaFeatureTarget, setQaFeatureTarget] = useState<{
    workflowDirectory: string;
    groupId: string;
  } | null>(null);
  // 지금 고른 워크플로우의 메뉴별 마지막 확인 시각. 저장소가 정본이고 이 상태는 화면을 다시 그리기
  // 위한 사본이다. 기록이 없는 메뉴는 키 자체가 없다.
  const [menuLastSeen, setMenuLastSeen] = useState<Record<string, string>>({});
  // 패널 배치. 저장소가 정본이고 이 상태는 화면을 다시 그리기 위한 사본이다. 이 화면이 다루는 영역은
  // 사이드바 하나지만, 저장 단위가 앱 전체라 다른 영역의 항목까지 함께 들고 저장한다.
  const [panelLayout, setPanelLayout] = useState<PanelLayoutState>(() => browserPanelLayoutStore.load());
  // 그리는 너비 계산이 창 폭을 받으므로 그 값을 상태로 둔다. 창이 넓어지면 줄여 그리던 너비가 저장해
  // 둔 값으로 돌아와야 하고, 다시 그리려면 폭이 바뀐 사실이 상태로 들어와야 한다.
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);

  const activeRuns = (agentRuntime?.queue?.runs ?? []).filter((run) =>
    ["reserved", "queued", "running", "paused"].includes(run.state),
  );
  const runTargets = new Set(activeRuns.map((run) => run.targetId));
  const activeSessionCount =
    activeRuns.length +
    project.activeLeases.filter((lease) => !lease.taskId || !runTargets.has(lease.taskId)).length;

  useEffect(() => {
    if (!project.workflows.some((item) => item.directory === selectedDirectory)) {
      setSelectedDirectory(project.workflows[0]?.directory ?? "");
    }
  }, [project.workflows, selectedDirectory]);

  useEffect(() => {
    setSpecDocument(null);
  }, [selectedDirectory]);

  /*
   * 고른 워크플로우의 확인 시각을 읽고, 기록이 없는 메뉴는 지금을 첫 기준으로 남긴다. 그 메뉴를 열지
   * 않아도 남겨야, 프로젝트를 처음 여는 사용자가 그동안 쌓인 문서를 한꺼번에 변경으로 만나지 않는다.
   * 저장은 고른 워크플로우의 없는 기록에만 하므로 다른 워크플로우의 기록은 전환만으로 달라지지 않고,
   * 되돌아오면 그때 저장된 기록을 그대로 다시 읽는다.
   */
  useEffect(() => {
    if (!selectedDirectory) return;
    const stored = browserMenuLastSeenStore.load(selectedDirectory);
    const seeded = { ...stored };
    const now = new Date().toISOString();
    for (const menuKey of MENU_KEYS) {
      if (seeded[menuKey]) continue;
      browserMenuLastSeenStore.save(selectedDirectory, menuKey, now);
      seeded[menuKey] = now;
    }
    setMenuLastSeen(seeded);
  }, [selectedDirectory]);

  /*
   * 아이디어 화면과 개발 화면에 들어간 사실을 그 메뉴의 확인 시각으로 남긴다. 메뉴 버튼도 검색 결과도
   * 결국 view를 지나가므로, 버튼 처리가 아니라 이 자리에 두어야 어느 경로로 들어와도 걸린다. 들어간
   * 메뉴 하나만 저장하므로 다른 메뉴의 기록은 함께 갱신되지 않는다.
   */
  useEffect(() => {
    if (!selectedDirectory) return;
    const menuKey =
      view === "ideas" ? IDEAS_MENU_KEY : view === "tasks" ? DEVELOPMENT_MENU_KEY : null;
    if (!menuKey) return;
    const now = new Date().toISOString();
    browserMenuLastSeenStore.save(selectedDirectory, menuKey, now);
    setMenuLastSeen((current) => ({ ...current, [menuKey]: now }));
  }, [selectedDirectory, view]);

  useEffect(() => {
    function handleSearchShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((current) => !current);
      }
    }
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  useEffect(() => {
    function handleResize() {
      setWindowWidth(window.innerWidth);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const workflow = useMemo(
    () => project.workflows.find((item) => item.directory === selectedDirectory),
    [project.workflows, selectedDirectory],
  );

  /*
   * 오늘 화면이 함께 세는 품질 확인 대기 기능. 개발 화면과 품질 확인 작업대가 쓰는 판정 모듈을 그대로
   * 불러 세 화면이 같은 수를 말한다. 지금 확인할 수 있는 묶음만 담기므로 아직 열 수 없는 기능은
   * 목록에도 건수에도 들어가지 않는다.
   */
  const decisions = useMemo(() => pendingDecisions(workflow), [workflow]);
  const readyQaFeatures = decisions.qaFeatures;
  const pendingSpecs = decisions.specs;
  // 기획서 승인과 그룹 QA만 사용자 판단이다. 태스크 상태는 이 수치에 들어가지 않는다.
  const decisionCount = decisions.total;

  /*
   * 아이디어 메뉴와 개발 메뉴의 변경 점. 아이디어 메뉴는 아이디어 문서를, 개발 메뉴는 작업 문서와
   * 작업 그룹을 함께 본다. 개수는 붙이지 않으므로 하나라도 바뀌었는지만 판단한다.
   */
  const ideasChanged = useMemo(
    () => hasChangedSince(workflow?.items.ideas ?? [], menuLastSeen[IDEAS_MENU_KEY]),
    [workflow, menuLastSeen],
  );
  const developmentChanged = useMemo(
    () =>
      hasChangedSince(
        [...(workflow?.items.tasks ?? []), ...(workflow?.items.workGroups ?? [])],
        menuLastSeen[DEVELOPMENT_MENU_KEY],
      ),
    [workflow, menuLastSeen],
  );

  const sidebarEntry = panelLayout.sidebar;
  const sidebarCollapsed = sidebarEntry?.collapsed ?? false;
  /*
   * 사이드바의 기준 너비. 조절하기 전에 그려지던 너비이며, 화면에서 재지 않고 영역 표에서 가져온다.
   * 표가 사이드바에 기본 너비를 주므로 이 값은 비지 않는다.
   */
  const sidebarBaselineWidth = defaultPanelWidth("sidebar", windowWidth) ?? PANEL_LIMITS.sidebar.minWidth;
  /*
   * 지금 그리는 px 너비. 한 번도 조절하지 않고 접히지도 않았으면 값이 없고, 그때는 스타일 규칙의
   * 되돌림 값이 사이드바를 그린다. 창이 좁아 저장한 너비를 다 그릴 수 없을 때 값을 줄이는 것도, 접힌
   * 동안 28px을 돌려주는 것도 이 계산이 한다. 저장한 값은 그 사이 바뀌지 않는다.
   */
  const sidebarRenderedWidth = resolveRenderedPanelWidths({
    windowWidth,
    storedWidths: sidebarEntry?.width === undefined ? {} : { sidebar: sidebarEntry.width },
    collapsed: sidebarCollapsed ? ["sidebar"] : [],
  }).sidebar;
  /** 핸들이 잡고 시작하는 너비. 아직 조절하지 않았으면 지금 그려지고 있는 기준 너비다. */
  const sidebarWidth = sidebarRenderedWidth ?? sidebarBaselineWidth;

  const sidebarLayout = useMemo<PanelReclaimInput>(
    () => ({
      baselineWidth: sidebarBaselineWidth,
      renderedWidth: sidebarRenderedWidth,
      collapsed: sidebarCollapsed,
    }),
    [sidebarBaselineWidth, sidebarCollapsed, sidebarRenderedWidth],
  );

  /** 사이드바 항목을 갈아 끼우고 같은 상태를 저장소에 남긴다. 저장 실패는 저장소가 삼킨다. */
  function saveSidebarLayout(entry: PanelLayoutEntry) {
    const next: PanelLayoutState = { ...panelLayout, sidebar: entry };
    setPanelLayout(next);
    browserPanelLayoutStore.save(next);
  }

  /*
   * 드래그와 방향키가 정한 너비. 들어오는 값은 조작 요소가 이미 한계 안으로 자른 값이다. 처음
   * 조작하는 순간의 기준 너비를 함께 남겨, 이 영역이 얼마나 좁아졌는지 나중에 잴 자리를 만든다.
   */
  function changeSidebarWidth(width: number) {
    saveSidebarLayout({
      ...sidebarEntry,
      width,
      baselineWidth: sidebarEntry?.baselineWidth ?? sidebarBaselineWidth,
    });
  }

  /** 더블클릭. 정해 둔 너비를 지워 스타일 규칙의 되돌림 값으로 되돌린다 (SPEC-080 R3, R11). */
  function resetSidebarWidth() {
    const entry: PanelLayoutEntry = { ...sidebarEntry };
    delete entry.width;
    saveSidebarLayout(entry);
  }

  /*
   * 접고 펴기. 펼칠 때 따로 너비를 되돌리지 않는다. 접는 동안에도 저장한 너비는 그대로 남아 있어,
   * 접힘만 내리면 접기 직전에 그리던 너비가 그대로 다시 나온다.
   */
  function collapseSidebar(collapsed: boolean) {
    saveSidebarLayout({ ...sidebarEntry, collapsed });
  }

  /** 기능 하나를 지정해 품질 확인 작업대를 연다. 중간 화면을 거치지 않는다. */
  function openQaFeature(featureKey: string) {
    if (!workflow) return;
    setQaFeatureTarget({ workflowDirectory: workflow.directory, groupId: featureKey });
    setView("qa");
  }

  async function addIdea(content: string) {
    if (!workflow) return false;
    return onAddIdea(workflow.directory, content);
  }

  async function addWorkflow(event: React.FormEvent) {
    event.preventDefault();
    if (!workflowName.trim()) return;
    if (await onAddWorkflow(workflowName.trim())) {
      setWorkflowName("");
      setShowWorkflowForm(false);
    }
  }

  async function openSpec(item: WorkflowItemSummary) {
    if (!workflow) return;
    setSpecLoading(true);
    const document = await onReadSpec(workflow.directory, item.fileName);
    if (document) setSpecDocument(document);
    setSpecLoading(false);
  }

  async function decideSpec(outcome: SpecDecisionOutcome, comment: string) {
    if (!workflow || !specDocument) return false;
    const decided = await onDecideSpec(
      workflow.directory,
      specDocument.summary.fileName,
      outcome,
      comment,
    );
    if (decided) {
      setSpecDocument((current) => current ? {
        ...current,
        summary: { ...current.summary, status: outcome },
      } : current);
    }
    return decided;
  }

  async function openSpecWorkspace(item: WorkflowItemSummary) {
    setView("specs");
    await openSpec(item);
  }

  async function refreshProject() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  async function openSearchResult({
    item,
    kind,
    workflow: resultWorkflow,
  }: {
    item: WorkflowItemSummary;
    kind: SearchItemKind;
    workflow: WorkflowSummary;
  }) {
    setSelectedDirectory(resultWorkflow.directory);
    if (kind === "ideas") {
      setView("ideas");
      return;
    }
    if (kind === "tasks") {
      setView("tasks");
      return;
    }

    setView("specs");
    setSpecLoading(true);
    const document = await onReadSpec(resultWorkflow.directory, item.fileName);
    if (document) setSpecDocument(document);
    setSpecLoading(false);
  }

  const writable = project.compatibility === "current";
  const managedNotice = managedRulesNotice(managedAssets);

  /*
   * 자동 배정을 이미 켜 둔 사용자는 에이전트 화면을 열 이유가 없어 그 안의 동의 요구를 만나지 못한다.
   * 프로젝트를 열 때 읽어 둔 동의 상태를 여기서 읽어 첫 화면에서 알린다. 에이전트 화면을 보고 있는
   * 동안에는 그리지 않는다. 그 화면이 같은 안내를 이미 담고 있어 두 번 보일 이유가 없다.
   */
  const runtimeConsent = agentRuntime?.policy?.consent ?? null;
  const consentAttention =
    view !== "agents" &&
    (agentRuntime?.policy?.policy.automationEnabled ?? false) &&
    runtimeConsent?.status === "required";

  /*
   * 한 번도 조절하지 않고 접히지도 않은 사이드바에는 변수를 싣지 않는다. 그래야 넓은 창에서 250px,
   * 창 폭 980px 이하에서 210px이라는 지금 배치가 스타일 규칙의 되돌림 값으로 그대로 나온다.
   */
  const appShellStyle =
    sidebarRenderedWidth === undefined
      ? undefined
      : ({ "--sidebar-width": `${sidebarRenderedWidth}px` } as CSSProperties);

  return (
    <SidebarLayoutContext.Provider value={sidebarLayout}>
    <main className="app-shell" style={appShellStyle}>
      <aside className={sidebarCollapsed ? "sidebar sidebar-collapsed" : "sidebar"}>
      {sidebarCollapsed ? (
        <PanelCollapsedBar label={SIDEBAR_LABEL} onExpand={() => collapseSidebar(false)} />
      ) : (
        <>
        <div className="sidebar-switcher-row">
          <button className="project-switcher" onClick={onSwitchProject}>
            <span className="brand-mark tiny"><Icon name="workflow" /></span>
            <span><strong>{project.name}</strong><small>프로젝트 전환</small></span>
            <Icon className="chevron" name="chevron" />
          </button>
          <PanelCollapseButton label={SIDEBAR_LABEL} onCollapse={() => collapseSidebar(true)} />
        </div>

        {/* 세 묶음: 결정 허브(오늘) · 작업 흐름(아이디어→품질 확인) · 지난 일(기록·활동) */}
        <nav className="primary-nav" aria-label="주요 메뉴">
          <div className="primary-nav-group">
            <button className={view === "today" ? "active" : ""} onClick={() => setView("today")}><Icon name="spark" />오늘</button>
          </div>
          <div className="primary-nav-group">
            <button className={view === "ideas" ? "active" : ""} onClick={() => setView("ideas")}><Icon name="inbox" />아이디어<NavChangeDot changed={ideasChanged} /></button>
            <button className={view === "specs" ? "active" : ""} onClick={() => setView("specs")}><Icon name="stamp" />기획서<NavBadge count={pendingSpecs.length} label="승인 대기" /></button>
            <button className={view === "tasks" ? "active" : ""} onClick={() => setView("tasks")}><Icon name="board" />개발<NavChangeDot changed={developmentChanged} /></button>
            <button className={view === "qa" ? "active" : ""} onClick={() => { setQaFeatureTarget(null); setView("qa"); }}><Icon name="stamp" />품질 확인<NavBadge count={readyQaFeatures.length} label="확인 가능" /></button>
          </div>
          <div className="primary-nav-group">
            <button className={view === "archive" ? "active" : ""} onClick={() => setView("archive")}><Icon name="archive" />기록</button>
          </div>
        </nav>

        <div className="workflow-nav">
          <div className="nav-label"><span>워크플로우</span><button aria-label="워크플로우 추가" onClick={() => setShowWorkflowForm(true)}><Icon name="plus" /></button></div>
          {project.workflows.map((item) => {
            /* 지금 보고 있지 않은 워크플로우만 부른다. 선택된 워크플로우의 대기는 위 두 메뉴의
               숫자가 이미 말하고 있어, 같은 사실을 목록에서 한 번 더 말하면 표시가 겹친다. */
            const waiting =
              item.directory !== selectedDirectory && pendingDecisions(item).total > 0;
            return (
              <button
                className={item.directory === selectedDirectory ? "active" : ""}
                key={item.id}
                onClick={() => setSelectedDirectory(item.directory)}
              >
                <span className="workflow-dot" />
                <span>{item.name}</span>
                {waiting && (
                  <>
                    <span aria-hidden="true" className="workflow-pending-dot" />
                    <span className="visually-hidden">, 기다리는 결정 있음,</span>
                  </>
                )}
                <small>{item.counts.workGroups}</small>
              </button>
            );
          })}
          {showWorkflowForm && (
            <form className="inline-workflow-form" onSubmit={addWorkflow}>
              <input autoFocus maxLength={80} onChange={(event) => setWorkflowName(event.target.value)} placeholder="워크플로우 이름" value={workflowName} />
              <div><button type="button" onClick={() => setShowWorkflowForm(false)}>취소</button><button disabled={!workflowName.trim() || busy} type="submit">추가</button></div>
            </form>
          )}
        </div>

        <div className="sidebar-footer">
          {/* 좌측 메뉴는 화면 전환 분기 바깥이라 이 자리에 두면 어떤 화면에서도 보인다. 세션이 도는지와
              활성 수만 알리고, 담당자와 대상 문서는 오늘 화면 카드와 에이전트 화면이 맡는다.
              수는 실행 목록(빠른 갱신)과 문서 선점(파일)의 합집합이다 — 실행이 잡은 대상의 선점은
              같은 세션이므로 겹쳐 세지 않고, 선점 전의 실행도 앱 밖 세션도 빠지지 않는다. */}
          {activeSessionCount > 0 && (
            <button
              aria-label={`실행 중인 세션 ${activeSessionCount}개, 에이전트 화면 열기`}
              className="sidebar-activity"
              onClick={() => setView("agents")}
              type="button"
            >
              <span className="sidebar-activity-dot" />
              <span>세션 실행 중</span>
              <small>{activeSessionCount}</small>
            </button>
          )}
          <UpdateControl updater={updater} />
          {/*
            작업 공간이 이 묶음을 넘겨줄 때만 진입점을 세운다. 배선 없이 메뉴만 있으면 사용자가 빈
            화면을 열게 되므로, 통로가 없는 동안에는 자리를 만들지 않는다.
          */}
          {agentRuntime && agentRuntimeActions && (
            <button className={`settings-link ${view === "agents" ? "active" : ""}`} onClick={() => setView("agents")}><Icon name="spark" />에이전트</button>
          )}
          <button className={`settings-link ${view === "help" ? "active" : ""}`} onClick={() => setView("help")}><Icon name="help" />도움말</button>
          <button className={`settings-link ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}><Icon name="settings" />설정</button>
        </div>

        <PanelResizeHandle
          label={SIDEBAR_LABEL}
          onReset={resetSidebarWidth}
          onWidthChange={changeSidebarWidth}
          region="sidebar"
          width={sidebarWidth}
        />
        </>
      )}
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <div className="breadcrumbs"><span>{project.name}</span><b>/</b><span>{workflow?.name}</span><b>/</b><strong>{viewLabels[view]}</strong></div>
            <small>{project.rootPath}</small>
          </div>
          <div className="header-actions">
            <button
              aria-busy={refreshing}
              aria-label={refreshing ? "새로고침 중" : "새로 고침"}
              className={`icon-button refresh-button ${refreshing ? "refreshing" : ""}`}
              disabled={refreshing}
              onClick={() => void refreshProject()}
              title={refreshing ? "프로젝트를 새로고침하는 중입니다" : "프로젝트 새로고침"}
            ><Icon name="refresh" /></button>
            <button className="search-button" onClick={() => setSearchOpen(true)}><Icon name="search" />프로젝트 검색 <kbd>⌘K</kbd></button>
          </div>
        </header>

        <div className="workspace-content">
          {!writable && (
            <div className="compatibility-banner" role="alert">
              <Icon name="archive" />
              <div>
                <strong>{project.compatibility === "future_schema" ? "더 새로운 문서 규격입니다" : "문서 마이그레이션이 필요합니다"}</strong>
                <span>안전을 위해 이 프로젝트는 읽기 전용으로 열렸습니다.</span>
              </div>
              {project.compatibility === "migration_required" && (
                <button
                  disabled={busy || project.activeLeases.length > 0}
                  onClick={() => void onMigrate()}
                >
                  {project.activeLeases.length > 0
                    ? "LLM 작업 종료 대기"
                    : "백업 후 마이그레이션"}
                </button>
              )}
            </div>
          )}

          {error && <div className="error-banner" role="alert">{error}</div>}

          {/* 프로젝트 오류와 다른 자리에 그린다. 동기화가 멈춰도 사이드바와 문서 화면, 설정 화면은
              그대로 쓸 수 있어야 하고, 사용자가 볼 곳은 프로젝트 문서가 아니라 규칙 파일이다. */}
          {managedNotice && (
            <div className="managed-rules-banner" role="alert">
              <Icon name="stamp" />
              <div>
                <strong>{managedNotice.title}</strong>
                <span>{managedNotice.detail}</span>
                <span>{managedNotice.action}</span>
              </div>
            </div>
          )}

          {consentAttention && (
            <section className="agent-runtime-attention" role="status">
              <div><strong>실행 권한 동의 필요</strong><p>자동 배정이 켜져 있지만 실행 권한에 동의하기 전에는 새 세션을 시작하지 않습니다.</p></div>
              <button className="secondary-button agent-compact-action" onClick={() => setConsentOpen(true)} type="button">고지 읽고 동의</button>
            </section>
          )}

          {view === "today" && (
            <>
              <div className="today-heading">
                <div><p className="eyebrow">TODAY</p><h1>다시 오셨군요.</h1><p>{workflow?.name}에서 다음 결정을 이어가세요.</p></div>
                <time>{new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(new Date())}</time>
              </div>

              {project.activeLeases.length > 0 && (
                <button className="agent-activity" onClick={() => setView("agents")} type="button">
                  <span className="pulse" />
                  <div><strong>{project.activeLeases[0].agent}가 문서를 작업 중입니다</strong><small>{project.activeLeases[0].taskId ?? "워크플로우 작업"} · 마이그레이션 보호 활성</small></div>
                  <span className="agent-activity-count">{project.activeLeases.length} active</span>
                  <span className="agent-activity-more">자세히 보기<Icon className="chevron" name="chevron" /></span>
                </button>
              )}

              {/* key가 있어야 워크플로를 바꿨을 때 이전 워크플로의 초안이 입력창에 남지 않는다(R3). */}
              <IdeaComposer busy={busy} compact disabled={!writable || !workflow} key={workflow?.directory} onAdd={addIdea} workflowDirectory={workflow?.directory} />

              <section className="stage-section">
                <div className="section-heading"><div><p className="eyebrow">WORKFLOW</p><h2>흐름 한눈에 보기</h2></div><span className="flow-hint"><Icon name="workflow" />단계 카드를 선택해 전용 화면으로 이동</span></div>
                <div className="stage-grid">
                  {stages.map((stage, index) => (
                    <StageCard
                      index={index}
                      key={stage.key}
                      onOpen={() => setView(index === 0 ? "ideas" : index === 1 ? "specs" : index === 2 ? "tasks" : "archive")}
                      stage={stage}
                      workflow={workflow}
                    />
                  ))}
                </div>
              </section>

              <div className="lower-grid">
                <section className="attention-card">
                  <div className="section-heading"><div><p className="eyebrow warm">NEEDS YOU</p><h2>내 선택 대기</h2></div><span className="count-badge">{decisionCount}</span></div>
                  {decisionCount > 0 ? (
                    <div className="attention-list">
                      {pendingSpecs.map((item) => (
                        <button key={item.fileName} onClick={() => void openSpecWorkspace(item)}>
                          <span><strong>{item.title}</strong><small>{item.id} · 기획서 승인 필요</small></span>
                          <b>검토하기 →</b>
                        </button>
                      ))}
                      {/* 기능 하나가 한 줄이다. 작업 식별자와 개발 상태 수치는 여기서 말하지 않는다 —
                          이 자리는 무엇을 확인할지만 고르는 자리이고, 항목별 상세는 작업대가 맡는다. */}
                      {readyQaFeatures.map((feature) => (
                        <button key={feature.id} onClick={() => openQaFeature(feature.id)}>
                          <span><strong>{feature.title}</strong><small>확인 항목 {feature.scenarios.length}개 · 품질 확인 필요</small></span>
                          <b>품질 확인 시작 →</b>
                        </button>
                      ))}
                    </div>
                  ) : <div className="empty-state"><span>✓</span><div><strong>기다리는 선택이 없습니다</strong><small>LLM이 결정을 요청하면 여기에 나타납니다.</small></div></div>}
                </section>
                <section className="file-contract-card">
                  <p className="eyebrow">FILE CONTRACT</p>
                  <h2>앱과 LLM은 파일로 협업합니다.</h2>
                  <p>앱은 실행을 통제하지 않고 Markdown의 상태를 읽어 보여줍니다.</p>
                  <code>.workflow/{workflow?.directory}/</code>
                </section>
              </div>
            </>
          )}

          {workflow && view === "ideas" && (
            <IdeaInbox
              busy={busy}
              disabled={!writable}
              key={workflow.directory}
              onAdd={addIdea}
              onReadIdea={(fileName) => onReadIdea(workflow.directory, fileName)}
              workflow={workflow}
            />
          )}

          {workflow && view === "specs" && (
            <SpecWorkspace
              busy={busy}
              document={specDocument}
              loading={specLoading}
              onDecision={decideSpec}
              onSelect={(item) => void openSpec(item)}
              workflow={workflow}
            />
          )}

          {workflow && view === "tasks" && (
            <DevelopmentBoard
              key={workflow.directory}
              onOpenQa={openQaFeature}
              onReadTask={(fileName) => onReadTask(workflow.directory, fileName)}
              onWorkGroupLifecycle={onWorkGroupLifecycle}
              workflow={workflow}
            />
          )}

          {workflow && view === "qa" && (
            <QaWorkbench
              initialFeatureKey={qaFeatureTarget?.workflowDirectory === workflow.directory
                ? qaFeatureTarget.groupId
                : null}
              key={workflow.directory}
              onSubmit={onWorkGroupQaSubmit}
              workflow={workflow}
            />
          )}

          {workflow && view === "archive" && <ArchiveView workflow={workflow} onOpenSpec={(item) => void openSpecWorkspace(item)} />}

          {/* 워크플로우와 무관한 화면이라 workflow 조건을 걸지 않는다.

              `heartbeatRuns`를 함께 거는 것은 그 필드가 `IntegrationsState`에서 아직 선택이기
              때문이다(카드 쪽 prop은 필수다). `useProjectWorkspace`는 언제나 채워 내보내므로 이
              조건은 실사용에서 참이고, 손으로 조립한 상태가 이 값을 빠뜨리면 화면이 통째로 비어
              바로 드러난다 — 액션만 조용히 사라지는 것보다 낫다. `heartbeatUpdate`도 같은 이유로
              같은 자리에 걸린다.

              `activeLeases`는 프로젝트 요약이 이미 들고 있는 값이다. 앱이 새로 계산하지 않고
              활동 뷰가 쓰는 그 값을 그대로 카드까지 내린다(SPEC-037 R3).

              `heartbeatSetupRuns`·`heartbeatVersions`·`heartbeatService`는 이 조건에 걸지 않는다.
              없으면 설치 실행 버튼과 버전 표시와 데몬 조작 통로만 빠지고 카드의 나머지는 그대로
              돌아야 한다 — 조회·설치·업데이트가 그 셋을 기다릴 이유가 없다. */}
          {view === "agents" && agentRuntime && agentRuntimeActions && (
            <AgentRuntimeView
              actions={agentRuntimeActions}
              project={project}
              state={agentRuntime}
            />
          )}

          {view === "help" && <HelpView />}

          {view === "settings" && (
            <SettingsView
              customRules={customRules}
              customRulesActions={customRulesActions}
              managedAssets={managedAssets}
              project={project}
              updater={updater}
              onSwitchProject={onSwitchProject}
            />
          )}

          {specLoading && <div className="loading-toast">기획서를 불러오는 중…</div>}
        </div>
      </section>

      {searchOpen && (
        <ProjectSearchDialog
          onClose={() => setSearchOpen(false)}
          onOpen={(result) => void openSearchResult(result)}
          project={project}
        />
      )}

      {/* 동의만 남기고 정책은 저장하지 않는다. 고지 문구와 확인 항목과 동의 호출은 에이전트 화면이
          내보내는 것을 그대로 쓴다. */}
      {consentOpen && agentRuntime && agentRuntimeActions && runtimeConsent && (
        <ExecutionConsentDialog
          actions={agentRuntimeActions}
          consent={runtimeConsent}
          onClose={() => setConsentOpen(false)}
          state={agentRuntime}
        />
      )}

    </main>
    </SidebarLayoutContext.Provider>
  );
}

/**
 * 알림으로 올릴 관리 규칙 상태를 고른다. `current`와 `updated`는 설정 카드에서만 읽으면 되므로
 * 공통 영역을 차지하지 않는다. 재시도와 충돌은 사용자가 할 일이 서로 달라 문구를 나눠 쓴다.
 */
function managedRulesNotice(managedAssets: ManagedAssetsState) {
  if (managedAssets.error) {
    return {
      title: "관리 규칙 동기화 명령이 실패했습니다",
      detail: managedAssets.error,
      action: "프로젝트 문서는 그대로 열려 있습니다. 새로 고침을 누르면 다시 시도합니다.",
    };
  }

  const result = managedAssets.result;
  if (!result) return null;

  if (result.status === "retry_required") {
    return {
      title: "관리 규칙을 나중에 다시 설치해야 합니다",
      detail: result.reason ?? "다른 쓰기 작업이 끝나지 않았습니다.",
      action: "규칙 파일은 바꾸지 않았습니다. 잠시 뒤 새로 고침을 누르면 다시 시도합니다.",
    };
  }

  if (result.status === "conflict") {
    const affected = result.assets.find((asset) => asset.id === result.affectedAsset);
    return {
      title: affected
        ? `관리 규칙 충돌: ${affected.label}`
        : "관리 규칙에서 충돌이 발생했습니다",
      detail: result.reason ?? "앱이 관리 형식을 확인하지 못했습니다.",
      action: "앱은 파일을 덮어쓰지 않았습니다. 설정 화면의 관리 규칙 카드에서 자산별 이유를 확인하세요.",
    };
  }

  return null;
}

function StageCard({
  index,
  onOpen,
  stage,
  workflow,
}: {
  index: number;
  onOpen(): void;
  stage: (typeof stages)[number];
  workflow: WorkflowSummary | undefined;
}) {
  // "완료"는 태스크가 아니라 기능(작업 그룹) 기준으로 센다. 구현 보고서 수는 사용자 언어가 아니다.
  const completedFeatures = workflow?.items.workGroups
    .filter((group) => ["completed", "automatic_completed"].includes(group.displayStatus)).length ?? 0;
  const value = stage.key === "reports" ? completedFeatures : workflow?.counts[stage.key] ?? 0;
  const subtitles = ["생각을 수집하는 중", "승인 가능한 문서", "실행할 작업", "완료된 기능"];
  return (
    <button className={`stage-card tone-${index}`} onClick={onOpen}>
      <div className="stage-top"><span><Icon name={stage.icon} /></span><small>0{index + 1}</small></div>
      <strong>{stage.label}</strong>
      <b>{value}</b>
      <p>{subtitles[index]}</p>
    </button>
  );
}

function ArchiveView({
  onOpenSpec,
  workflow,
}: {
  onOpenSpec(item: WorkflowItemSummary): void;
  workflow: WorkflowSummary;
}) {
  // 완료된 기능은 기록 안에서 한 화면으로 다시 열어 본다. 문서는 이미 다 손안에 있다.
  const [selectedGroup, setSelectedGroup] = useState<WorkGroupSummary | null>(null);
  const specs = workflow.items.specs.filter((item) =>
    ["approved", "rejected"].includes(item.status),
  );
  const groups = workflow.items.workGroups.filter((group) =>
    ["completed", "automatic_completed", "discarded"].includes(group.displayStatus),
  );

  // 두 종류의 기록을 하나의 시간순 이야기로 합친다. 쌓일수록 목록이 아니라 달력처럼 읽히게,
  // 최신이 먼저 오고 달이 바뀔 때마다 머리글이 선다.
  const records: ArchiveRecord[] = [
    ...specs.map((item) => ({
      key: item.fileName,
      kind: (item.status === "approved" ? "spec_approved" : "spec_rejected") as ArchiveRecord["kind"],
      title: item.title,
      meta: item.id,
      at: item.updatedAt,
      spec: item,
    })),
    ...groups.map((group) => ({
      key: group.fileName,
      kind: (group.displayStatus === "discarded" ? "group_discarded" : "group_completed") as ArchiveRecord["kind"],
      title: group.title,
      meta: group.displayStatus === "completed" ? `${group.id} · 사용자 QA 승인` : group.id,
      at: group.updatedAt,
      group,
    })),
  ].sort((left, right) => archiveTime(right.at) - archiveTime(left.at));
  const months = groupRecordsByMonth(records);
  const counts = {
    approved: specs.filter((item) => item.status === "approved").length,
    rejected: specs.filter((item) => item.status === "rejected").length,
    features: groups.length,
  };

  if (selectedGroup) {
    const groupTasks = workflow.items.tasks.filter((task) => task.workGroupId === selectedGroup.id);
    return (
      <section className="archive-view archive-group-detail">
        <button className="text-button qa-scope-back" onClick={() => setSelectedGroup(null)} type="button">← 기록으로 돌아가기</button>
        <p className="qa-feature-kicker">{selectedGroup.displayStatus === "discarded" ? "기능 폐기 기록" : "기능 완료 기록"}</p>
        <h1>{selectedGroup.title}</h1>
        {selectedGroup.description && <p className="qa-feature-goal">{selectedGroup.description}</p>}

        <dl className="archive-group-facts">
          <div><dt>종결 방식</dt><dd>{selectedGroup.displayStatus === "completed" ? "사용자 QA 승인" : selectedGroup.displayStatus === "discarded" ? "사용자 폐기" : "자동 완료"}</dd></div>
          <div><dt>구성 버전</dt><dd>{selectedGroup.revision}</dd></div>
          <div><dt>마지막 갱신</dt><dd>{formatArchiveDate(selectedGroup.updatedAt)}</dd></div>
        </dl>

        {selectedGroup.scenarios.length > 0 && (
          <section aria-label="사용자 확인 플로우" className="archive-group-flow">
            <h2>사용자 확인 플로우</h2>
            {selectedGroup.scenarios.map((scenario) => (
              <section className="qa-flow-section" key={scenario.id}>
                <h2>{scenario.title}</h2>
                <MarkdownBody body={scenario.body} />
              </section>
            ))}
          </section>
        )}

        {groupTasks.length > 0 && (
          <section aria-label="포함된 작업" className="archive-group-tasks">
            <h2>포함된 작업 {groupTasks.length}개</h2>
            <ul>
              {groupTasks.map((task) => (
                <li key={task.fileName}>
                  <span className="status-pill status-verified">완료</span>
                  <strong>{task.title}</strong>
                  <small>{task.id}</small>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    );
  }

  return (
    <section className="archive-view">
      <p className="eyebrow">ARCHIVE</p>
      <h1>결정과 완료 기록</h1>
      <p>승인·폐기된 기획서와 완료된 기능을 시간순으로 모아봅니다.</p>
      {records.length > 0 && (
        <p className="archive-summary">승인 {counts.approved} · 폐기 {counts.rejected} · 완료된 기능 {counts.features}</p>
      )}

      <div className="archive-timeline">
        {months.map(([label, items]) => (
          <section aria-label={label} key={label}>
            <h2>{label}</h2>
            <ul>
              {items.map((record) => {
                const body = (
                  <>
                    <time>{archiveDay(record.at)}</time>
                    <span className={`archive-kind kind-${record.kind}`}>{ARCHIVE_KIND_LABEL[record.kind]}</span>
                    <strong>{record.title}</strong>
                    <small>{record.meta}</small>
                  </>
                );
                return (
                  <li key={record.key}>
                    <button
                      className="archive-row"
                      onClick={() => {
                        if (record.spec) onOpenSpec(record.spec);
                        else if (record.group) setSelectedGroup(record.group);
                      }}
                      type="button"
                    >{body}</button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {records.length === 0 && <p className="archive-empty">아직 남은 기록이 없습니다. 기획서가 결정되거나 기능이 완료되면 여기에 쌓입니다.</p>}
    </section>
  );
}

interface ArchiveRecord {
  key: string;
  kind: "spec_approved" | "spec_rejected" | "group_completed" | "group_discarded";
  title: string;
  meta: string;
  at: string | null;
  spec?: WorkflowItemSummary;
  group?: WorkGroupSummary;
}

const ARCHIVE_KIND_LABEL: Record<ArchiveRecord["kind"], string> = {
  spec_approved: "기획 승인",
  spec_rejected: "기획 폐기",
  group_completed: "기능 완료",
  group_discarded: "기능 폐기",
};

function archiveTime(value: string | null) {
  const parsed = value === null ? Number.NaN : Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function archiveDay(value: string | null) {
  if (value === null) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : `${parsed.getDate()}일`;
}

function formatArchiveDate(value: string | null) {
  if (value === null) return "기록 없음";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "기록 없음";
  return `${parsed.getFullYear()}년 ${parsed.getMonth() + 1}월 ${parsed.getDate()}일`;
}

function groupRecordsByMonth(records: ArchiveRecord[]) {
  const months = new Map<string, ArchiveRecord[]>();
  for (const record of records) {
    const parsed = new Date(record.at ?? Number.NaN);
    const label = Number.isNaN(parsed.getTime())
      ? "날짜 미상"
      : `${parsed.getFullYear()}년 ${parsed.getMonth() + 1}월`;
    months.set(label, [...(months.get(label) ?? []), record]);
  }
  return [...months.entries()];
}
