import { useEffect, useMemo, useState } from "react";
import type { ProjectSummary, WorkflowSummary } from "../domain/types";
import type { AppUpdaterState } from "../../updater/domain/types";
import { UpdateControl } from "../../updater/components/UpdateControl";
import { Icon } from "../../../shared/ui/Icon";

interface Props {
  busy: boolean;
  error: string | null;
  project: ProjectSummary;
  updater: AppUpdaterState;
  onAddIdea(workflowDirectory: string, content: string): Promise<boolean>;
  onAddWorkflow(name: string): Promise<boolean>;
  onMigrate(): Promise<boolean>;
  onRefresh(): void;
  onSwitchProject(): void;
}

const stages = [
  { key: "ideas", label: "아이디어", icon: "idea" as const },
  { key: "specs", label: "기획서", icon: "stamp" as const },
  { key: "tasks", label: "개발", icon: "board" as const },
  { key: "reports", label: "완료", icon: "archive" as const },
] as const;

export function WorkspaceShell({
  busy,
  error,
  project,
  updater,
  onAddIdea,
  onAddWorkflow,
  onMigrate,
  onRefresh,
  onSwitchProject,
}: Props) {
  const [selectedDirectory, setSelectedDirectory] = useState(
    project.workflows[0]?.directory ?? "",
  );
  const [idea, setIdea] = useState("");
  const [showWorkflowForm, setShowWorkflowForm] = useState(false);
  const [workflowName, setWorkflowName] = useState("");

  useEffect(() => {
    if (!project.workflows.some((item) => item.directory === selectedDirectory)) {
      setSelectedDirectory(project.workflows[0]?.directory ?? "");
    }
  }, [project.workflows, selectedDirectory]);

  const workflow = useMemo(
    () => project.workflows.find((item) => item.directory === selectedDirectory),
    [project.workflows, selectedDirectory],
  );

  async function addIdea(event: React.FormEvent) {
    event.preventDefault();
    if (!workflow || !idea.trim()) return;
    if (await onAddIdea(workflow.directory, idea.trim())) setIdea("");
  }

  async function addWorkflow(event: React.FormEvent) {
    event.preventDefault();
    if (!workflowName.trim()) return;
    if (await onAddWorkflow(workflowName.trim())) {
      setWorkflowName("");
      setShowWorkflowForm(false);
    }
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
          <button className="active"><Icon name="spark" />오늘</button>
          <button><Icon name="inbox" />아이디어</button>
          <button><Icon name="stamp" />기획서</button>
          <button><Icon name="board" />개발</button>
          <button><Icon name="archive" />보관함</button>
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
          <button className="settings-link"><Icon name="settings" />설정</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <div className="breadcrumbs"><span>{project.name}</span><b>/</b><strong>{workflow?.name}</strong></div>
            <small>{project.rootPath}</small>
          </div>
          <div className="header-actions">
            <button className="icon-button" aria-label="새로 고침" onClick={onRefresh}><Icon name="refresh" /></button>
            <button className="search-button"><Icon name="search" />프로젝트 검색 <kbd>⌘K</kbd></button>
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

          <section className="idea-composer">
            <div className="composer-icon"><Icon name="idea" /></div>
            <form onSubmit={addIdea}>
              <label htmlFor="quick-idea">무엇을 만들어볼까요?</label>
              <textarea
                disabled={!writable}
                id="quick-idea"
                maxLength={10_000}
                onChange={(event) => setIdea(event.target.value)}
                placeholder="떠오른 아이디어를 편하게 적어주세요. 아직 구체적이지 않아도 괜찮습니다."
                value={idea}
              />
              <div className="composer-footer"><span>Markdown으로 안전하게 저장됩니다</span><button className="primary-button" disabled={busy || !idea.trim() || !workflow || !writable} type="submit"><Icon name="plus" />아이디어 추가</button></div>
            </form>
          </section>

          {error && <div className="error-banner" role="alert">{error}</div>}

          <section className="stage-section">
            <div className="section-heading"><div><p className="eyebrow">WORKFLOW</p><h2>흐름 한눈에 보기</h2></div><button className="text-button">전체 보드 보기 →</button></div>
            <div className="stage-grid">
              {stages.map((stage, index) => (
                <StageCard index={index} key={stage.key} stage={stage} workflow={workflow} />
              ))}
            </div>
          </section>

          <div className="lower-grid">
            <section className="attention-card">
              <div className="section-heading"><div><p className="eyebrow warm">NEEDS YOU</p><h2>내 선택 대기</h2></div><span className="count-badge">{workflow?.counts.decisions ?? 0}</span></div>
              {workflow?.counts.decisions ? <p>결정 문서를 확인해 다음 작업을 이어가세요.</p> : <div className="empty-state"><span>✓</span><div><strong>기다리는 선택이 없습니다</strong><small>LLM이 결정을 요청하면 여기에 나타납니다.</small></div></div>}
            </section>
            <section className="file-contract-card">
              <p className="eyebrow">FILE CONTRACT</p>
              <h2>앱과 LLM은 파일로 협업합니다.</h2>
              <p>앱은 실행을 통제하지 않고 Markdown의 상태를 읽어 보여줍니다.</p>
              <code>.workflow/{workflow?.directory}/</code>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}

function StageCard({
  index,
  stage,
  workflow,
}: {
  index: number;
  stage: (typeof stages)[number];
  workflow: WorkflowSummary | undefined;
}) {
  const value = workflow?.counts[stage.key] ?? 0;
  const subtitles = ["생각을 수집하는 중", "승인 가능한 문서", "실행할 작업", "검증된 결과"];
  return (
    <article className={`stage-card tone-${index}`}>
      <div className="stage-top"><span><Icon name={stage.icon} /></span><small>0{index + 1}</small></div>
      <strong>{stage.label}</strong>
      <b>{value}</b>
      <p>{subtitles[index]}</p>
    </article>
  );
}
