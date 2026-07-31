import { useEffect, useMemo, useState } from "react";
import type {
  ProjectSummary,
  SpecDecisionOutcome,
  TaskQaOutcome,
  TaskDocument,
  SpecDocument,
  WorkflowItemSummary,
  WorkflowSummary,
} from "../domain/types";
import type { AppUpdaterState } from "../../updater/domain/types";
import { UpdateControl } from "../../updater/components/UpdateControl";
import { Icon } from "../../../shared/ui/Icon";
import { DevelopmentBoard } from "./DevelopmentBoard";
import { HelpView } from "./HelpView";
import { IdeaComposer } from "./IdeaComposer";
import { IdeaInbox } from "./IdeaInbox";
import { ProjectSearchDialog, type SearchItemKind } from "./ProjectSearchDialog";
import { SettingsView } from "./SettingsView";
import { SpecWorkspace } from "./SpecWorkspace";

interface Props {
  busy: boolean;
  error: string | null;
  project: ProjectSummary;
  updater: AppUpdaterState;
  onAddIdea(workflowDirectory: string, content: string): Promise<boolean>;
  onAddWorkflow(name: string): Promise<boolean>;
  onDecideSpec(
    workflowDirectory: string,
    fileName: string,
    outcome: SpecDecisionOutcome,
    comment: string,
  ): Promise<boolean>;
  onMigrate(): Promise<boolean>;
  onReadSpec(
    workflowDirectory: string,
    fileName: string,
  ): Promise<SpecDocument | null>;
  onReadTask(
    workflowDirectory: string,
    fileName: string,
  ): Promise<TaskDocument | null>;
  onTaskQa(
    workflowDirectory: string,
    fileName: string,
    outcome: TaskQaOutcome,
    comment: string,
  ): Promise<boolean>;
  onRefresh(): Promise<void> | void;
  onSwitchProject(): void;
}

const stages = [
  { key: "ideas", label: "아이디어", icon: "idea" as const },
  { key: "specs", label: "기획서", icon: "stamp" as const },
  { key: "tasks", label: "개발", icon: "board" as const },
  { key: "reports", label: "완료", icon: "archive" as const },
] as const;

const viewLabels = {
  today: "오늘",
  ideas: "아이디어",
  specs: "기획서",
  tasks: "개발",
  archive: "기록",
  help: "도움말",
  settings: "설정",
} as const;

export function WorkspaceShell({
  busy,
  error,
  project,
  updater,
  onAddIdea,
  onAddWorkflow,
  onDecideSpec,
  onMigrate,
  onReadSpec,
  onReadTask,
  onTaskQa,
  onRefresh,
  onSwitchProject,
}: Props) {
  const [selectedDirectory, setSelectedDirectory] = useState(
    project.workflows[0]?.directory ?? "",
  );
  const [showWorkflowForm, setShowWorkflowForm] = useState(false);
  const [workflowName, setWorkflowName] = useState("");
  const [view, setView] = useState<
    "today" | "ideas" | "specs" | "tasks" | "archive" | "help" | "settings"
  >("today");
  const [specDocument, setSpecDocument] = useState<SpecDocument | null>(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!project.workflows.some((item) => item.directory === selectedDirectory)) {
      setSelectedDirectory(project.workflows[0]?.directory ?? "");
    }
  }, [project.workflows, selectedDirectory]);

  useEffect(() => {
    setSpecDocument(null);
  }, [selectedDirectory]);

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

  const workflow = useMemo(
    () => project.workflows.find((item) => item.directory === selectedDirectory),
    [project.workflows, selectedDirectory],
  );

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

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button className="project-switcher" onClick={onSwitchProject}>
          <span className="brand-mark tiny"><Icon name="workflow" /></span>
          <span><strong>{project.name}</strong><small>프로젝트 전환</small></span>
          <Icon className="chevron" name="chevron" />
        </button>

        <nav className="primary-nav" aria-label="주요 메뉴">
          <button className={view === "today" ? "active" : ""} onClick={() => setView("today")}><Icon name="spark" />오늘</button>
          <button className={view === "ideas" ? "active" : ""} onClick={() => setView("ideas")}><Icon name="inbox" />아이디어</button>
          <button className={view === "specs" ? "active" : ""} onClick={() => setView("specs")}><Icon name="stamp" />기획서</button>
          <button className={view === "tasks" ? "active" : ""} onClick={() => setView("tasks")}><Icon name="board" />개발</button>
          <button className={view === "archive" ? "active" : ""} onClick={() => setView("archive")}><Icon name="archive" />기록</button>
        </nav>

        <div className="workflow-nav">
          <div className="nav-label"><span>워크플로우</span><button aria-label="워크플로우 추가" onClick={() => setShowWorkflowForm(true)}><Icon name="plus" /></button></div>
          {project.workflows.map((item) => (
            <button
              className={item.directory === selectedDirectory ? "active" : ""}
              key={item.id}
              onClick={() => setSelectedDirectory(item.directory)}
            >
              <span className="workflow-dot" />
              <span>{item.name}</span>
              <small>{item.counts.tasks}</small>
            </button>
          ))}
          {showWorkflowForm && (
            <form className="inline-workflow-form" onSubmit={addWorkflow}>
              <input autoFocus maxLength={80} onChange={(event) => setWorkflowName(event.target.value)} placeholder="워크플로우 이름" value={workflowName} />
              <div><button type="button" onClick={() => setShowWorkflowForm(false)}>취소</button><button disabled={!workflowName.trim() || busy} type="submit">추가</button></div>
            </form>
          )}
        </div>

        <div className="sidebar-footer">
          <UpdateControl updater={updater} />
          <button className={`settings-link ${view === "help" ? "active" : ""}`} onClick={() => setView("help")}><Icon name="help" />도움말</button>
          <button className={`settings-link ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}><Icon name="settings" />설정</button>
        </div>
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

          {view === "today" && (
            <>
              <div className="today-heading">
                <div><p className="eyebrow">TODAY</p><h1>다시 오셨군요.</h1><p>{workflow?.name}에서 다음 결정을 이어가세요.</p></div>
                <time>{new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(new Date())}</time>
              </div>

              {project.activeLeases.length > 0 && (
                <div className="agent-activity">
                  <span className="pulse" />
                  <div><strong>{project.activeLeases[0].agent}가 문서를 작업 중입니다</strong><small>{project.activeLeases[0].taskId ?? "워크플로우 작업"} · 마이그레이션 보호 활성</small></div>
                  <span>{project.activeLeases.length} active</span>
                </div>
              )}

              <IdeaComposer busy={busy} compact disabled={!writable || !workflow} onAdd={addIdea} />

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
                  <div className="section-heading"><div><p className="eyebrow warm">NEEDS YOU</p><h2>내 선택 대기</h2></div><span className="count-badge">{workflow?.counts.decisions ?? 0}</span></div>
                  {workflow?.counts.decisions ? (
                    <div className="attention-list">
                      {workflow.items.specs.filter((item) => item.status === "user_review").map((item) => (
                        <button key={item.fileName} onClick={() => void openSpecWorkspace(item)}>
                          <span><strong>{item.title}</strong><small>{item.id} · 기획서 승인 필요</small></span>
                          <b>검토하기 →</b>
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

          {workflow && view === "tasks" && <DevelopmentBoard busy={busy} onReadTask={(fileName) => onReadTask(workflow.directory, fileName)} onTaskQa={(fileName, outcome, comment) => onTaskQa(workflow.directory, fileName, outcome, comment)} workflow={workflow} />}

          {workflow && view === "archive" && <ArchiveView workflow={workflow} onOpenSpec={(item) => void openSpecWorkspace(item)} />}

          {view === "help" && <HelpView />}

          {view === "settings" && <SettingsView project={project} updater={updater} onSwitchProject={onSwitchProject} />}

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

    </main>
  );
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
  const value = workflow?.counts[stage.key] ?? 0;
  const subtitles = ["생각을 수집하는 중", "승인 가능한 문서", "실행할 작업", "검증된 결과"];
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
  const specs = workflow.items.specs.filter((item) =>
    ["approved", "rejected"].includes(item.status),
  );
  const tasks = workflow.items.tasks.filter((item) => item.status === "completed");
  return (
    <section className="archive-view">
      <p className="eyebrow">ARCHIVE</p>
      <h1>결정과 완료 기록</h1>
      <p>승인·폐기된 기획서와 완료된 개발 작업을 모아봅니다.</p>
      <div className="archive-grid">
        <section>
          <div className="section-heading"><h2>결정된 기획서</h2><span>{specs.length}</span></div>
          {specs.map((item) => (
            <button key={item.fileName} onClick={() => onOpenSpec(item)}>
              <span className={`status-pill status-${item.status}`}>{item.status === "approved" ? "승인" : "폐기"}</span>
              <strong>{item.title}</strong><small>{item.id}</small>
            </button>
          ))}
          {specs.length === 0 && <p className="archive-empty">아직 결정 기록이 없습니다.</p>}
        </section>
        <section>
          <div className="section-heading"><h2>완료된 개발 작업</h2><span>{tasks.length}</span></div>
          {tasks.map((item) => (
            <article key={item.fileName}><span className="status-pill status-completed">완료</span><strong>{item.title}</strong><small>{item.id}</small></article>
          ))}
          {tasks.length === 0 && <p className="archive-empty">아직 완료 기록이 없습니다.</p>}
        </section>
      </div>
    </section>
  );
}
