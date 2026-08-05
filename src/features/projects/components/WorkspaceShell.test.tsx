import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { IntegrationsSnapshot, IntegrationsState, ProjectSummary } from "../domain/types";
import type { AppUpdaterState } from "../../updater/domain/types";
import { WorkspaceShell } from "./WorkspaceShell";

afterEach(cleanup);

const project: ProjectSummary = {
  rootPath: "/projects/workflow-labs",
  initialized: true,
  projectId: "prj_1",
  name: "workflow-labs",
  compatibility: "current",
  activeLeases: [],
  workflows: [{
    id: "wf_1",
    directory: "feature--wf_1",
    name: "Feature",
    status: "active",
    createdAt: "2026-07-30T00:00:00Z",
    counts: { ideas: 0, specs: 0, decisions: 0, tasks: 0, reports: 0 },
    items: { ideas: [], specs: [], tasks: [] },
  }],
};

const updater: AppUpdaterState = {
  phase: "idle",
  version: null,
  progress: null,
  error: null,
  check: vi.fn().mockResolvedValue(undefined),
  install: vi.fn().mockResolvedValue(undefined),
  restart: vi.fn().mockResolvedValue(undefined),
};

const integrations: IntegrationsState = {
  snapshot: null,
  error: null,
  writeError: null,
  heartbeatRuns: { running: [], failure: null, run: vi.fn().mockResolvedValue(true) },
  heartbeatUpdate: { running: false, result: null, update: vi.fn().mockResolvedValue(undefined) },
};
const integrationActions = {
  installHeartbeatJobs: vi.fn().mockResolvedValue(true),
  installDreamJob: vi.fn().mockResolvedValue(true),
};

describe("WorkspaceShell", () => {
  it("opens a purpose-built screen for each primary menu", () => {
    render(
      <WorkspaceShell
        busy={false}
        error={null}
        project={project}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onTaskQa={vi.fn().mockResolvedValue(true)}
        onTaskQaBatch={vi.fn().mockResolvedValue([])}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "아이디어" }));
    expect(screen.getByRole("heading", { name: "아이디어 인박스" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "기획서" }));
    expect(screen.getByRole("heading", { name: "기획서 검토" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "개발" }));
    expect(screen.getByRole("heading", { name: "개발 작업" })).toBeInTheDocument();
  });

  it("keeps the full completed task history in the archive", () => {
    const completedTasks = [1, 2, 3, 4].map((day) => ({
      fileName: `TASK-00${day}.md`,
      id: `TASK-00${day}`,
      title: `완료 기록 ${day}`,
      status: "completed",
      updatedAt: `2026-07-0${day}T00:00:00Z`,
      dueAt: null,
      excerpt: "",
    }));
    const completedProject: ProjectSummary = {
      ...project,
      workflows: [{
        ...project.workflows[0],
        counts: { ...project.workflows[0].counts, tasks: 4 },
        items: { ...project.workflows[0].items, tasks: completedTasks },
      }],
    };

    render(
      <WorkspaceShell
        busy={false}
        error={null}
        project={completedProject}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onTaskQa={vi.fn().mockResolvedValue(true)}
        onTaskQaBatch={vi.fn().mockResolvedValue([])}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "개발" }));
    expect(screen.queryByText("완료 기록 1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "기록" }));
    expect(screen.getByText("완료 기록 1")).toBeInTheDocument();
    expect(screen.getAllByText(/완료 기록 [1-4]/)).toHaveLength(4);
  });

  it("refreshes the project with visible interaction feedback", async () => {
    let finishRefresh!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => {
      finishRefresh = resolve;
    }));

    render(
      <WorkspaceShell
        busy={false}
        error={null}
        project={project}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onTaskQa={vi.fn().mockResolvedValue(true)}
        onTaskQaBatch={vi.fn().mockResolvedValue([])}
        onRefresh={onRefresh}
        onSwitchProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "새로 고침" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "새로고침 중" })).toBeDisabled();

    finishRefresh();
    await waitFor(() => expect(screen.getByRole("button", { name: "새로 고침" })).toBeEnabled());
  });

  it("searches project documents from the button and keyboard shortcut", () => {
    const searchableProject: ProjectSummary = {
      ...project,
      workflows: [{
        ...project.workflows[0],
        items: {
          ...project.workflows[0].items,
          tasks: [{
            fileName: "TASK-007.md",
            id: "TASK-007",
            title: "상태 파서 구현",
            status: "in_progress",
            updatedAt: "2026-07-31T00:00:00Z",
            dueAt: null,
            excerpt: "기획서 상태와 결정을 함께 읽는다.",
          }],
        },
      }],
    };

    render(
      <WorkspaceShell
        busy={false}
        error={null}
        project={searchableProject}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onTaskQa={vi.fn().mockResolvedValue(true)}
        onTaskQaBatch={vi.fn().mockResolvedValue([])}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog", { name: "프로젝트 검색" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "프로젝트 검색" }), { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: /프로젝트 검색/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "프로젝트 검색" }), { target: { value: "파서" } });
    fireEvent.click(screen.getByRole("option", { name: /상태 파서 구현/ }));

    expect(screen.getByRole("heading", { name: "개발 작업" })).toBeInTheDocument();
  });

  it("opens a first-run help guide from the sidebar", () => {
    render(
      <WorkspaceShell
        busy={false}
        error={null}
        project={project}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onTaskQa={vi.fn().mockResolvedValue(true)}
        onTaskQaBatch={vi.fn().mockResolvedValue([])}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "도움말" }));
    expect(screen.getByRole("heading", { name: "도움말" })).toBeInTheDocument();
    expect(screen.getByText(/도장을 찍는다/)).toBeInTheDocument();
    expect(screen.getByText(/LLM에게 어떻게 시키나요/)).toBeInTheDocument();
    expect(screen.getByText("아키텍트")).toBeInTheDocument();
  });

  it("opens the integrations view from its own sidebar menu", () => {
    const { container } = render(
      <WorkspaceShell
        busy={false}
        error={null}
        project={project}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onTaskQa={vi.fn().mockResolvedValue(true)}
        onTaskQaBatch={vi.fn().mockResolvedValue([])}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "연동" }));

    expect(screen.getByRole("region", { name: "연동" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "연동" })).toHaveClass("active");
    expect(container.querySelector(".breadcrumbs")).toHaveTextContent("연동");
  });

  // R1. 연동은 워크플로우가 아니라 사용자 환경을 다루는 화면이다. 워크플로우를 바꿔도 내용이
  // 달라지면 사용자가 잘못된 소속으로 읽는다.
  it("keeps the integrations view unchanged across workflow switches", () => {
    const twoWorkflows: ProjectSummary = {
      ...project,
      workflows: [
        project.workflows[0],
        { ...project.workflows[0], id: "wf_2", directory: "second--wf_2", name: "Second" },
      ],
    };

    render(
      <WorkspaceShell
        busy={false}
        error={null}
        project={twoWorkflows}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onTaskQa={vi.fn().mockResolvedValue(true)}
        onTaskQaBatch={vi.fn().mockResolvedValue([])}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "연동" }));
    const before = screen.getByRole("region", { name: "연동" }).textContent;

    fireEvent.click(screen.getByRole("button", { name: /Second/ }));

    expect(screen.getByRole("region", { name: "연동" }).textContent).toBe(before);
  });

  it("opens the activity view from its own sidebar menu", () => {
    const { container } = render(
      <WorkspaceShell
        busy={false}
        error={null}
        project={project}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onTaskQa={vi.fn().mockResolvedValue(true)}
        onTaskQaBatch={vi.fn().mockResolvedValue([])}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "활동" }));

    expect(screen.getByRole("region", { name: "활동" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "활동" })).toHaveClass("active");
    expect(container.querySelector(".breadcrumbs")).toHaveTextContent("활동");
  });

  it("keeps the today banner out of sight while nothing is running", () => {
    render(
      <WorkspaceShell
        busy={false}
        error={null}
        project={project}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onTaskQa={vi.fn().mockResolvedValue(true)}
        onTaskQaBatch={vi.fn().mockResolvedValue([])}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /자세히 보기/ })).not.toBeInTheDocument();
  });

  // R2. 배너는 요약으로 남되 막다른 길이 아니어야 하고, 대표로 지목한 워커가 전용 뷰의 첫 카드와
  // 어긋나면 사용자가 두 화면을 다른 사실로 읽는다.
  it("leads from the today banner to the activity view it summarizes", () => {
    const runningProject: ProjectSummary = {
      ...project,
      activeLeases: [
        {
          leaseId: "lease-1",
          agent: "planner-claude",
          role: "planner",
          taskId: "IDEA-001",
          heartbeatAt: "2026-08-03T08:55:00Z",
          expiresAt: "2126-08-03T09:12:00Z",
        },
        {
          leaseId: "lease-2",
          agent: "developer-claude",
          role: "developer",
          taskId: null,
          heartbeatAt: "2026-08-03T08:56:00Z",
          expiresAt: "2126-08-03T09:20:00Z",
        },
      ],
    };

    render(
      <WorkspaceShell
        busy={false}
        error={null}
        project={runningProject}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onTaskQa={vi.fn().mockResolvedValue(true)}
        onTaskQaBatch={vi.fn().mockResolvedValue([])}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    const banner = screen.getByRole("button", { name: /자세히 보기/ });
    expect(banner).toHaveTextContent("planner-claude");
    fireEvent.click(banner);

    const activity = screen.getByRole("region", { name: "활동" });
    expect(within(activity).getAllByRole("listitem")).toHaveLength(2);
    expect(within(within(activity).getAllByRole("listitem")[0]).getByText("planner-claude")).toBeInTheDocument();
  });

  it("opens a working settings view", () => {
    const onSwitchProject = vi.fn();
    render(
      <WorkspaceShell
        busy={false}
        error={null}
        project={project}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onTaskQa={vi.fn().mockResolvedValue(true)}
        onTaskQaBatch={vi.fn().mockResolvedValue([])}
        onRefresh={vi.fn()}
        onSwitchProject={onSwitchProject}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    expect(screen.getByRole("heading", { name: "설정" })).toBeInTheDocument();
    expect(screen.getAllByText("/projects/workflow-labs")).toHaveLength(2);
    expect(screen.getByText("자동 새로고침 사용 중")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다른 프로젝트 열기" }));
    expect(onSwitchProject).toHaveBeenCalledTimes(1);
  });
});

const DRAFT_STORAGE_KEY = "workflow-labs.idea-draft.v1";
const quickLabel = "무엇을 만들어볼까요?";
const inboxLabel = "새로운 생각을 인박스에 담기";

const twoWorkflows: ProjectSummary = {
  ...project,
  workflows: [
    project.workflows[0],
    { ...project.workflows[0], id: "wf_2", directory: "other--wf_2", name: "Other" },
  ],
};

/**
 * 테스트 환경의 `localStorage`는 메서드가 없는 빈 객체다. 초안이 실제로 남는지 보려면 직접 세워야
 * 한다. `browserIdeaDraftStore.test.ts`의 방식을 따른다.
 */
function stubStorage() {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
  });
  return stored;
}

function shell(overrides: Partial<ComponentProps<typeof WorkspaceShell>> = {}) {
  return render(
    <WorkspaceShell
      busy={false}
      error={null}
      project={project}
      updater={updater}
      integrations={integrations}
      integrationActions={integrationActions}
      onAddIdea={vi.fn().mockResolvedValue(true)}
      onAddWorkflow={vi.fn().mockResolvedValue(true)}
      onDecideSpec={vi.fn().mockResolvedValue(true)}
      onMigrate={vi.fn().mockResolvedValue(true)}
      onReadIdea={vi.fn().mockResolvedValue(null)}
      onReadSpec={vi.fn().mockResolvedValue(null)}
      onReadTask={vi.fn().mockResolvedValue(null)}
      onTaskQa={vi.fn().mockResolvedValue(true)}
      onTaskQaBatch={vi.fn().mockResolvedValue([])}
      onRefresh={vi.fn()}
      onSwitchProject={vi.fn()}
      {...overrides}
    />,
  );
}

describe("WorkspaceShell 아이디어 초안", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = stubStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 오늘 화면도 조건부 렌더라 메뉴를 누르는 순간 언마운트된다.
  it("keeps the quick draft after visiting another menu", () => {
    shell();
    fireEvent.change(screen.getByLabelText(quickLabel), {
      target: { value: "빠르게 적은 생각" },
    });

    fireEvent.click(screen.getByRole("button", { name: "아이디어" }));
    fireEvent.click(screen.getByRole("button", { name: "오늘" }));

    expect(screen.getByLabelText(quickLabel)).toHaveValue("빠르게 적은 생각");
  });

  // 확인 필요 1번. 두 입력창이 초안 하나를 나눠 본다.
  it("carries the draft between the quick box and the inbox", () => {
    shell();
    fireEvent.change(screen.getByLabelText(quickLabel), {
      target: { value: "한 번만 쓴 글" },
    });

    fireEvent.click(screen.getByRole("button", { name: "아이디어" }));

    expect(screen.getByLabelText(inboxLabel)).toHaveValue("한 번만 쓴 글");
  });

  // R3. 오늘 화면 입력창에 key가 없으면 워크플로를 바꿔도 이전 글이 그대로 떠 있고, 그대로 제출하면
  // 엉뚱한 워크플로에 담긴다. 이 테스트가 그 key를 지킨다.
  it("keeps each workflow's quick draft to itself", () => {
    shell({ project: twoWorkflows });
    fireEvent.change(screen.getByLabelText(quickLabel), {
      target: { value: "A 워크플로의 글" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Other/ }));
    expect(screen.getByLabelText(quickLabel)).toHaveValue("");

    fireEvent.change(screen.getByLabelText(quickLabel), {
      target: { value: "B 워크플로의 글" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Feature/ }));

    expect(screen.getByLabelText(quickLabel)).toHaveValue("A 워크플로의 글");
  });

  // R5. 쓰기 권한이 없을 때는 초안이 보이되 제출만 막힌다. 그 상태로 화면이 그려지는 것이 저장된
  // 초안을 지우면 안 된다(완료 조건 12).
  it("shows the draft while the workspace is read-only and keeps it", () => {
    storage.set(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ [project.workflows[0].directory]: "권한이 없어도 남는 글" }),
    );

    const readOnly = shell({
      project: { ...project, compatibility: "migration_required" },
    });
    expect(screen.getByLabelText(quickLabel)).toHaveValue("권한이 없어도 남는 글");
    expect(screen.getByLabelText(quickLabel)).toBeDisabled();
    readOnly.unmount();

    shell();

    expect(screen.getByLabelText(quickLabel)).toHaveValue("권한이 없어도 남는 글");
    expect(screen.getByLabelText(quickLabel)).toBeEnabled();
  });
});

/**
 * SPEC-037 R3. 재기동이 끊는 세션을 고지하려면 활성 lease가 카드까지 닿아야 한다. 그 값의 원천은
 * 프로젝트 요약이고 앱이 새로 계산하지 않는다 — 활동 뷰가 쓰는 값 그대로다.
 */
describe("WorkspaceShell 연동 배선", () => {
  const lease = {
    leaseId: "lease-1",
    agent: "developer-claude",
    role: "developer",
    taskId: "TASK-104",
    heartbeatAt: "2026-08-05T06:00:00Z",
    expiresAt: "2026-08-05T07:00:00Z",
  };

  const snapshot: IntegrationsSnapshot = {
    supported: true,
    slug: "-projects-workflow-labs",
    managedBlockFailure: null,
    jobsFilePath: "/home/tester/.claude/heartbeat/jobs.d/-projects-workflow-labs.md",
    updateGuide: {
      identifyCommand: "pip show claude-heartbeat",
      packageCommand: "pip install -U claude-heartbeat",
      sourceCommand: "git pull",
      serviceLookupCommand: null,
      serviceRestartCommand: null,
    },
    heartbeat: {
      installation: "installed",
      daemonRunning: true,
      setupStages: [],
      conditionScriptPath: ".workflow/rules/wf-eligible.sh",
      // 백엔드는 늘 역할 셋을 담아 보낸다. 잡 폼이 그 값으로 시딩된다.
      roles: ["planner", "architect", "developer"].map((role) => ({
        role,
        jobName: `wf-${role}-projects-workflow-labs`,
        defaults: { interval: "30m", maxPer: "4/24h", model: "opus", timeout: "20m" },
        lastRun: null,
        quota: { kind: "unknown" as const },
      })),
      managedJobs: [],
      serviceTarget: {
        kind: "resolved",
        label: "com.catze.dream-heartbeat",
        plist_path: "/Users/catze/Library/LaunchAgents/com.catze.dream-heartbeat.plist",
      },
      recordedJobs: [{ name: "wf-developer-projects-workflow-labs", ofThisProject: true }],
      duplicateJobs: [],
      readFailures: [],
    },
    dream: {
      installation: "not_installed",
      heartbeat: "installed",
      refinement: {
        totalTranscripts: 0,
        markedTranscripts: 0,
        unrefinedTranscripts: 0,
        lastDream: null,
        memoryTopics: 0,
      },
      skillPath: "/Users/catze/.claude/skills/dream/SKILL.md",
      conditionCommand: "dream-prep check-unprocessed --slug=-projects-workflow-labs",
      defaults: { interval: "2h", maxPer: "6/24h", model: "opus", timeout: "30m" },
      managedJob: null,
      lastRun: null,
      quota: { kind: "unknown" },
      duplicateJobs: [],
      readFailures: [],
    },
  };

  it("carries the project's active leases down to the heartbeat card", () => {
    shell({
      project: { ...project, activeLeases: [lease] },
      integrations: { ...integrations, snapshot },
    });

    fireEvent.click(screen.getByRole("button", { name: "연동" }));
    fireEvent.click(
      within(screen.getByRole("article", { name: "claude-heartbeat" })).getByRole("button", {
        name: "펼치기",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "하트비트 업데이트" }));

    const confirm = screen.getByRole("group", { name: "하트비트 업데이트 확인" });
    expect(confirm).toHaveTextContent("지금 끊기는 세션 1개");
    expect(within(confirm).getByText("developer-claude · TASK-104")).toBeVisible();
  });

  /** lease가 없으면 없다고 말한다. 배선이 빠진 것과 세션이 없는 것을 화면이 같은 말로 하지 않는다. */
  it("says there is nothing to cut when the project has no lease", () => {
    shell({ integrations: { ...integrations, snapshot } });

    fireEvent.click(screen.getByRole("button", { name: "연동" }));
    fireEvent.click(
      within(screen.getByRole("article", { name: "claude-heartbeat" })).getByRole("button", {
        name: "펼치기",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "하트비트 업데이트" }));

    expect(screen.getByRole("group", { name: "하트비트 업데이트 확인" })).toHaveTextContent(
      "지금 끊길 세션이 없습니다",
    );
  });

  /**
   * 데몬 조작 통로도 같은 길로 카드까지 닿는다. 껍데기는 값의 내용을 보지 않고 그대로 넘기므로,
   * 배선이 빠지면 버튼 자체가 서지 않는 것으로 드러난다.
   */
  it("carries the daemon control channel down to the heartbeat card", () => {
    const control = vi.fn().mockResolvedValue(undefined);
    shell({
      integrations: {
        ...integrations,
        snapshot,
        heartbeatService: { running: null, outcome: null, error: null, control },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "연동" }));
    fireEvent.click(
      within(screen.getByRole("article", { name: "claude-heartbeat" })).getByRole("button", {
        name: "펼치기",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "데몬 켜기" }));

    expect(control).toHaveBeenCalledWith("start");
  });

  /**
   * 조작 통로가 없으면 그 버튼만 빠지고 카드의 나머지는 그대로 돈다. 조회·설치·업데이트가 이 값을
   * 기다릴 이유가 없다.
   */
  it("draws the rest of the card when the daemon control channel is missing", () => {
    shell({ integrations: { ...integrations, snapshot } });

    fireEvent.click(screen.getByRole("button", { name: "연동" }));
    fireEvent.click(
      within(screen.getByRole("article", { name: "claude-heartbeat" })).getByRole("button", {
        name: "펼치기",
      }),
    );

    expect(screen.queryByRole("button", { name: "데몬 끄기" })).toBeNull();
    expect(screen.getByRole("button", { name: "하트비트 업데이트" })).toBeVisible();
  });
});
