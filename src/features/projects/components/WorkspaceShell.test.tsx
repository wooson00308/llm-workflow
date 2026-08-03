import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntegrationsState, ProjectSummary } from "../domain/types";
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

const integrations: IntegrationsState = { snapshot: null, error: null, writeError: null };
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
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "연동" }));
    const before = screen.getByRole("region", { name: "연동" }).textContent;

    fireEvent.click(screen.getByRole("button", { name: /Second/ }));

    expect(screen.getByRole("region", { name: "연동" }).textContent).toBe(before);
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
