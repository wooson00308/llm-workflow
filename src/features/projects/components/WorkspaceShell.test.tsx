import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type {
  CustomRulesActions,
  CustomRulesState,
  IntegrationsSnapshot,
  IntegrationsState,
  ManagedAssetSyncResult,
  ManagedAssetsState,
  ProjectSummary,
  WorkGroupSummary,
} from "../domain/types";
import type { AppUpdaterState } from "../../updater/domain/types";
import { WorkspaceShell } from "./WorkspaceShell";
import { EXECUTION_NOTICE_FACTS } from "./agents/AgentRuntimeView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    counts: { ideas: 0, specs: 0, decisions: 0, workGroups: 0, tasks: 0, reports: 0 },
    items: { ideas: [], specs: [], workGroups: [], tasks: [] },
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
};

function workGroup(
  id: string,
  title: string,
  displayStatus: WorkGroupSummary["displayStatus"] = "qa_ready",
  scenarioCount = 1,
): WorkGroupSummary {
  return {
    fileName: `${id}.md`, id, title, status: "active", displayStatus, revision: 1, qaMode: "user",
    sourceSpecId: id.replace("GROUP", "SPEC"), sourceDecisionId: `DECISION-${id}`, sourceQaDecisionId: null,
    updatedAt: "2026-08-13T09:00:00Z", description: `${title} 설명`,
    scenarios: Array.from({ length: scenarioCount }, (_, index) => ({
      id: `QA-${String(index + 1).padStart(2, "0")}`,
      title: `${title} 확인 ${index + 1}`,
      body: `${title} 화면을 확인합니다.`,
    })),
  };
}

const managedAssets: ManagedAssetsState = {
  syncing: false,
  result: null,
  error: null,
  trigger: null,
};

const customRules: CustomRulesState = {
  document: {
    status: "absent",
    enabled: false,
    appliesTo: [],
    body: "",
    updatedAt: null,
    modifiedAt: null,
    raw: null,
    contentHash: null,
    error: null,
  },
  reading: false,
  previewing: false,
  saving: false,
  preview: null,
  previewBaselineContentHash: null,
  saveResult: null,
  readError: null,
  previewError: null,
  saveError: null,
};

const customRulesActions: CustomRulesActions = {
  preparePreview: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
  reload: vi.fn().mockResolvedValue(true),
  clearFeedback: vi.fn(),
};

function syncResult(overrides: Partial<ManagedAssetSyncResult> = {}): ManagedAssetSyncResult {
  return {
    status: "current",
    assets: [{
      id: "claim_helper",
      label: "선점 헬퍼",
      status: "current",
      installedVersion: 3,
      providedVersion: 3,
      reason: null,
    }],
    updatedAssets: [],
    reason: null,
    affectedAsset: null,
    rollbackFailures: [],
    rollbackRecoveries: [],
    ...overrides,
  };
}

describe("WorkspaceShell", () => {
  it("opens a purpose-built screen for each primary menu", () => {
    render(
      <WorkspaceShell
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={project}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
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

  it("opens the quality check workbench from the primary menu without moving the other entries", () => {
    const qaProject: ProjectSummary = {
      ...project,
      workflows: [{
        ...project.workflows[0],
        counts: { ...project.workflows[0].counts, decisions: 1, specs: 1, workGroups: 1, tasks: 1 },
        items: {
          ideas: [],
          specs: [{
            fileName: "SPEC-A.md",
            id: "SPEC-A",
            title: "카드 등록 흐름",
            status: "user_review",
            updatedAt: "2026-08-13T08:00:00Z",
            dueAt: null,
            excerpt: "결제 화면의 카드 등록 단계를 줄였다.",
          }],
          workGroups: [workGroup("GROUP-A", "카드 등록 흐름")],
          tasks: [{
            fileName: "TASK-001.md",
            id: "TASK-001",
            title: "카드 등록 화면 정리",
            status: "qa_waiting",
            updatedAt: "2026-08-13T09:00:00Z",
            dueAt: null,
            sourceSpecId: "SPEC-A",
            excerpt: "결제 화면에서 카드를 등록하면 목록에 바로 나타난다.",
          }],
        },
      }],
    };

    render(
      <WorkspaceShell
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={qaProject}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "품질 확인" }));
    expect(screen.getByRole("heading", { level: 1, name: "품질 확인" })).toBeInTheDocument();
    expect(document.querySelector(".breadcrumbs strong")).toHaveTextContent("품질 확인");
    expect(screen.getByRole("region", { name: "지금 확인할 기능" })).toBeInTheDocument();

    // 개발 화면은 같은 그룹에 품질 확인 입구만 열고, 확인·도장 같은 QA 결정 조작은 두지 않는다.
    fireEvent.click(screen.getByRole("button", { name: "개발" }));
    expect(screen.getByText("카드 등록 흐름")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "품질 확인 시작 →" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /확인 완료|기록하기/ })).not.toBeInTheDocument();

    // 오늘 화면의 내 선택 대기도 그대로다.
    fireEvent.click(screen.getByRole("button", { name: "오늘" }));
    expect(screen.getByRole("heading", { name: "내 선택 대기" })).toBeInTheDocument();
    expect(screen.getByText("SPEC-A · 기획서 승인 필요")).toBeInTheDocument();
  });

  it("remounts the QA workbench when workflows reuse the same group id and revision", () => {
    stubStorage();
    const firstGroup = workGroup("GROUP-SAME", "첫 워크플로 기능");
    const secondGroup = {
      ...workGroup("GROUP-SAME", "둘째 워크플로 기능"),
      scenarios: [{ id: "QA-01", title: "둘째 화면 확인", body: "둘째 워크플로 화면만 확인합니다." }],
    };
    const qaProject: ProjectSummary = {
      ...project,
      workflows: [
        {
          ...project.workflows[0],
          name: "First",
          counts: { ...project.workflows[0].counts, workGroups: 1 },
          items: { ...project.workflows[0].items, workGroups: [firstGroup] },
        },
        {
          ...project.workflows[0],
          id: "wf_2",
          directory: "second--wf_2",
          name: "Second",
          counts: { ...project.workflows[0].counts, workGroups: 1 },
          items: { ...project.workflows[0].items, workGroups: [secondGroup] },
        },
      ],
    };

    render(
      <WorkspaceShell
        busy={false}
        customRules={customRules}
        customRulesActions={customRulesActions}
        error={null}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
        project={qaProject}
        updater={updater}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "품질 확인" }));
    fireEvent.click(screen.getByRole("button", { name: /첫 워크플로 기능/ }));
    fireEvent.click(screen.getByRole("button", { name: "기대대로 동작함" }));
    expect(screen.getByRole("button", { name: "기대대로 동작함" })).toHaveAttribute("aria-pressed", "true");

    // 같은 그룹 id·revision이라도 워크플로가 다르면 임시 결정을 물려받지 않는다.
    fireEvent.click(screen.getByRole("button", { name: /Second/ }));
    expect(screen.getByRole("region", { name: "지금 확인할 기능" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /둘째 워크플로 기능/ }));
    expect(screen.getByRole("region", { name: "확인 플로우" })).toHaveTextContent("둘째 워크플로 화면만 확인합니다.");
    expect(screen.getByRole("button", { name: "기대대로 동작함" })).toHaveAttribute("aria-pressed", "false");
  });

  it("does not carry a Today QA deep link into another workflow with the same group id", () => {
    stubStorage();
    const firstGroup = workGroup("GROUP-SAME", "첫 워크플로 기능");
    const secondGroup = workGroup("GROUP-SAME", "둘째 워크플로 기능");
    const qaProject: ProjectSummary = {
      ...project,
      workflows: [
        {
          ...project.workflows[0],
          name: "First",
          counts: { ...project.workflows[0].counts, workGroups: 1 },
          items: { ...project.workflows[0].items, workGroups: [firstGroup] },
        },
        {
          ...project.workflows[0],
          id: "wf_2",
          directory: "second--wf_2",
          name: "Second",
          counts: { ...project.workflows[0].counts, workGroups: 1 },
          items: { ...project.workflows[0].items, workGroups: [secondGroup] },
        },
      ],
    };

    shell({ project: qaProject });

    fireEvent.click(screen.getByRole("button", { name: /품질 확인 시작/ }));
    expect(screen.getByRole("heading", { level: 1, name: "첫 워크플로 기능" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Second/ }));
    expect(screen.getByRole("region", { name: "지금 확인할 기능" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "둘째 워크플로 기능" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /둘째 워크플로 기능/ })).toBeInTheDocument();
  });

  it("isolates an opened and an in-flight task detail when the workflow changes", async () => {
    const firstGroup = workGroup("GROUP-DEV-A", "첫 개발 그룹", "developing");
    const secondGroup = workGroup("GROUP-DEV-B", "둘째 개발 그룹", "developing");
    const firstTask = {
      fileName: "TASK-A.md",
      id: "TASK-A",
      title: "첫 태스크",
      status: "in_progress",
      updatedAt: "2026-08-13T09:00:00Z",
      dueAt: null,
      excerpt: "첫 워크플로 내부 내용",
      sourceSpecId: firstGroup.sourceSpecId,
      sourceDecisionId: firstGroup.sourceDecisionId,
      workGroupId: firstGroup.id,
      workGroupRevision: firstGroup.revision,
    };
    const secondTask = {
      ...firstTask,
      fileName: "TASK-B.md",
      id: "TASK-B",
      title: "둘째 태스크",
      excerpt: "둘째 워크플로 내부 내용",
      sourceSpecId: secondGroup.sourceSpecId,
      sourceDecisionId: secondGroup.sourceDecisionId,
      workGroupId: secondGroup.id,
    };
    const developmentProject: ProjectSummary = {
      ...project,
      workflows: [
        {
          ...project.workflows[0],
          name: "First",
          counts: { ...project.workflows[0].counts, workGroups: 1, tasks: 1 },
          items: { ...project.workflows[0].items, workGroups: [firstGroup], tasks: [firstTask] },
        },
        {
          ...project.workflows[0],
          id: "wf_2",
          directory: "second--wf_2",
          name: "Second",
          counts: { ...project.workflows[0].counts, workGroups: 1, tasks: 1 },
          items: { ...project.workflows[0].items, workGroups: [secondGroup], tasks: [secondTask] },
        },
      ],
    };
    let resolveDelayed!: (value: { summary: typeof firstTask; body: string }) => void;
    const onReadTask = vi.fn()
      .mockResolvedValueOnce({ summary: firstTask, body: "첫 태스크 원문" })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveDelayed = resolve; }));

    shell({ onReadTask, project: developmentProject });
    fireEvent.click(screen.getByRole("button", { name: "개발" }));
    fireEvent.click(screen.getByRole("button", { name: /첫 태스크/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "첫 태스크" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Second/ }));
    expect(screen.getByRole("heading", { level: 1, name: "개발 작업" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "첫 태스크" })).not.toBeInTheDocument();
    expect(screen.getByText("둘째 개발 그룹")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /First/ }));
    fireEvent.click(screen.getByRole("button", { name: /첫 태스크/ }));
    fireEvent.click(screen.getByRole("button", { name: /Second/ }));
    resolveDelayed({ summary: firstTask, body: "늦게 도착한 첫 태스크 원문" });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "개발 작업" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 1, name: "첫 태스크" })).not.toBeInTheDocument();
      expect(screen.getByText("둘째 태스크")).toBeInTheDocument();
    });
  });

  /** 오늘 화면 검사가 함께 쓰는 목록 항목 하나. */
  function summaryItem(
    id: string,
    status: string,
    overrides: Partial<ProjectSummary["workflows"][number]["items"]["tasks"][number]> = {},
  ) {
    return {
      fileName: `${id}.md`,
      id,
      title: `${id} 문서`,
      status,
      updatedAt: "2026-08-13T09:00:00Z",
      dueAt: null,
      excerpt: "",
      ...overrides,
    };
  }

  /**
   * 오늘 화면을 그린다. 기획서 승인 대기 건수는 앱이 센 값이라 따로 넘긴다.
   */
  function renderToday(
    specs: ProjectSummary["workflows"][number]["items"]["specs"],
    tasks: ProjectSummary["workflows"][number]["items"]["tasks"],
    decisions: number,
  ) {
    const groups = specs
      .filter((spec) => spec.status === "approved")
      .map((spec) => {
        const linked = tasks.filter((task) => task.sourceSpecId === spec.id);
        const ready = linked.length > 0 && linked.every((task) => task.status === "qa_waiting" || task.status === "completed");
        return workGroup(
          `GROUP-${spec.id.replace("SPEC-", "")}`,
          spec.title,
          ready ? "qa_ready" : "developing",
          Math.max(1, linked.filter((task) => task.status === "qa_waiting").length),
        );
      });
    const todayProject: ProjectSummary = {
      ...project,
      workflows: [{
        ...project.workflows[0],
        counts: { ...project.workflows[0].counts, decisions, specs: specs.length, workGroups: groups.length, tasks: tasks.length },
        items: { ideas: [], specs, workGroups: groups, tasks },
      }],
    };
    return render(
      <WorkspaceShell
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={todayProject}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );
  }

  /** 기획서 승인 하나와 확인 가능한 기능 하나와 준비 중인 기능 하나가 함께 있는 워크플로. */
  function mixedTodayItems() {
    const specs = [
      summaryItem("SPEC-A", "user_review", { title: "카드 등록 흐름" }),
      summaryItem("SPEC-B", "approved", { title: "알림 재설계" }),
      summaryItem("SPEC-C", "approved", { title: "결제 재시도" }),
    ];
    const tasks = [
      summaryItem("TASK-001", "qa_waiting", { sourceSpecId: "SPEC-B" }),
      summaryItem("TASK-002", "qa_waiting", { sourceSpecId: "SPEC-B" }),
      summaryItem("TASK-003", "qa_waiting", { sourceSpecId: "SPEC-C" }),
      summaryItem("TASK-004", "todo", { sourceSpecId: "SPEC-C" }),
    ];
    return { specs, tasks };
  }

  it("counts a spec approval and a confirmable feature together on today's screen", () => {
    const { specs, tasks } = mixedTodayItems();
    const { container } = renderToday(specs, tasks, 1);

    const attention = container.querySelector(".attention-card") as HTMLElement;
    // 기획서 승인 한 건과 기능 한 건. 같은 기능의 대기 작업이 둘이어도 한 건으로 센다.
    expect(attention.querySelector(".count-badge")).toHaveTextContent("2");
    expect(within(attention).getByText("SPEC-A · 기획서 승인 필요")).toBeInTheDocument();
    expect(within(attention).getByText("알림 재설계")).toBeInTheDocument();
    expect(within(attention).getByText("확인 항목 2개 · 품질 확인 필요")).toBeInTheDocument();
    expect(within(attention).getAllByRole("button")).toHaveLength(2);

    // 아직 확인할 수 없는 기능은 목록에도 건수에도 없다. 작업 식별자도 여기서 말하지 않는다.
    expect(within(attention).queryByText("결제 재시도")).not.toBeInTheDocument();
    expect(attention.textContent).not.toContain("TASK-001");
  });

  it("opens the workbench at the chosen feature without passing through the development screen", () => {
    const { specs, tasks } = mixedTodayItems();
    renderToday(specs, tasks, 1);

    fireEvent.click(screen.getByRole("button", { name: /알림 재설계/ }));

    expect(document.querySelector(".breadcrumbs strong")).toHaveTextContent("품질 확인");
    expect(screen.getByRole("heading", { level: 1, name: "알림 재설계" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "지금 확인할 기능" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "개발 작업" })).not.toBeInTheDocument();

    // 주요 메뉴로 다시 들어가면 대기열에서 시작한다.
    fireEvent.click(screen.getByRole("button", { name: "오늘" }));
    fireEvent.click(screen.getByRole("button", { name: "품질 확인" }));
    expect(screen.getByRole("region", { name: "지금 확인할 기능" })).toBeInTheDocument();
  });

  it("says nothing is waiting only when neither kind is left", () => {
    const specs = [summaryItem("SPEC-C", "approved", { title: "결제 재시도" })];
    const tasks = [
      summaryItem("TASK-003", "qa_waiting", { sourceSpecId: "SPEC-C" }),
      summaryItem("TASK-004", "todo", { sourceSpecId: "SPEC-C" }),
    ];
    const { container } = renderToday(specs, tasks, 0);

    const attention = container.querySelector(".attention-card") as HTMLElement;
    expect(attention.querySelector(".count-badge")).toHaveTextContent("0");
    expect(within(attention).getByText("기다리는 선택이 없습니다")).toBeInTheDocument();
  });

  it("hands the quality check screen a submit action that reaches the workflow directory", async () => {
    stubStorage();
    const onWorkGroupQaSubmit = vi.fn().mockResolvedValue({
      summary: project,
      decisionFileName: "GROUP-QA-A.md",
      groupId: "GROUP-A",
      groupRevision: 1,
      outcome: "confirmed",
      status: "recorded",
    });
    const qaProject: ProjectSummary = {
      ...project,
      workflows: [{
        ...project.workflows[0],
        counts: { ...project.workflows[0].counts, specs: 1, workGroups: 1, tasks: 1 },
        items: {
          ideas: [],
          specs: [{
            fileName: "SPEC-A.md",
            id: "SPEC-A",
            title: "카드 등록 흐름",
            status: "approved",
            updatedAt: "2026-08-13T08:00:00Z",
            dueAt: null,
            excerpt: "결제 화면의 카드 등록 단계를 줄였다.",
          }],
          workGroups: [workGroup("GROUP-A", "카드 등록 흐름")],
          tasks: [{
            fileName: "TASK-001.md",
            id: "TASK-001",
            title: "카드 등록 화면 정리",
            status: "qa_waiting",
            updatedAt: "2026-08-13T09:00:00Z",
            dueAt: null,
            sourceSpecId: "SPEC-A",
            excerpt: "결제 화면에서 카드를 등록하면 목록에 바로 나타난다.",
          }],
        },
      }],
    };

    render(
      <WorkspaceShell
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={qaProject}
        updater={updater}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onWorkGroupQaSubmit={onWorkGroupQaSubmit}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "품질 확인" }));
    fireEvent.click(screen.getByRole("button", { name: /카드 등록 흐름/ }));
    fireEvent.click(screen.getByRole("button", { name: "기대대로 동작함" }));
    fireEvent.click(screen.getByRole("button", { name: "기능 승인 기록하기" }));

    await waitFor(() => expect(onWorkGroupQaSubmit).toHaveBeenCalledTimes(1));
    expect(onWorkGroupQaSubmit).toHaveBeenCalledWith(expect.objectContaining({
      workflowDirectory: "feature--wf_1",
      fileName: "GROUP-A.md",
      expectedRevision: 1,
      entries: [{ scenarioId: "QA-01", outcome: "confirmed", comment: "" }],
    }));
  });

  it("keeps completed work groups in the archive", () => {
    const completedGroups = [1, 2, 3, 4].map((day) => workGroup(
      `GROUP-${day}`,
      `완료 기록 ${day}`,
      day === 4 ? "automatic_completed" : "completed",
    ));
    const completedProject: ProjectSummary = {
      ...project,
      workflows: [{
        ...project.workflows[0],
        counts: { ...project.workflows[0].counts, workGroups: 4 },
        items: { ...project.workflows[0].items, workGroups: completedGroups },
      }],
    };

    render(
      <WorkspaceShell
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={completedProject}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    // 끝난 그룹은 개발 보드에 남지 않고, 기록 화면이 정본 목록을 갖는다.
    fireEvent.click(screen.getByRole("button", { name: "개발" }));
    expect(screen.queryByText("완료 기록 1")).not.toBeInTheDocument();
    expect(screen.getByText("완료된 작업 그룹 4개는 기록 화면에 있습니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "기록" }));
    expect(screen.getByText("완료 기록 1")).toBeInTheDocument();
    expect(screen.getAllByText(/완료 기록 [1-4]/)).toHaveLength(4);

    // 완료된 기능은 기록에서 한 화면으로 다시 열어 본다.
    fireEvent.click(screen.getByRole("button", { name: /완료 기록 1/ }));
    expect(screen.getByRole("heading", { level: 1, name: "완료 기록 1" })).toBeInTheDocument();
    expect(screen.getByText("사용자 QA 승인")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← 기록으로 돌아가기" }));
    expect(screen.getAllByText(/완료 기록 [1-4]/)).toHaveLength(4);
  });

  it("jumps from the development board into the quality check for a qa-ready group", () => {
    stubStorage();
    const qaProject: ProjectSummary = {
      ...project,
      workflows: [{
        ...project.workflows[0],
        counts: { ...project.workflows[0].counts, workGroups: 1 },
        items: { ...project.workflows[0].items, workGroups: [workGroup("GROUP-A", "카드 등록 흐름")] },
      }],
    };

    render(
      <WorkspaceShell
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={qaProject}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "개발" }));
    fireEvent.click(screen.getByRole("button", { name: "품질 확인 시작 →" }));

    expect(document.querySelector(".breadcrumbs strong")).toHaveTextContent("품질 확인");
    expect(screen.getByRole("heading", { level: 1, name: "카드 등록 흐름" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "확인 플로우" })).toBeInTheDocument();
  });

  it("refreshes the project with visible interaction feedback", async () => {
    let finishRefresh!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => {
      finishRefresh = resolve;
    }));

    render(
      <WorkspaceShell
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={project}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
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
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={searchableProject}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
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
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={project}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
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

  it("removes the deprecated integrations view from the sidebar", () => {
    render(
      <WorkspaceShell
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={project}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "연동" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "연동" })).not.toBeInTheDocument();
  });

  // R1. 연동은 워크플로우가 아니라 사용자 환경을 다루는 화면이다. 워크플로우를 바꿔도 내용이
  // 달라지면 사용자가 잘못된 소속으로 읽는다.
  it.skip("keeps the integrations view unchanged across workflow switches", () => {
    const twoWorkflows: ProjectSummary = {
      ...project,
      workflows: [
        project.workflows[0],
        { ...project.workflows[0], id: "wf_2", directory: "second--wf_2", name: "Second" },
      ],
    };

    render(
      <WorkspaceShell
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={twoWorkflows}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "연동" }));
    const before = screen.getByRole("region", { name: "연동" }).textContent;

    fireEvent.click(screen.getByRole("button", { name: /Second/ }));

    expect(screen.getByRole("region", { name: "연동" }).textContent).toBe(before);
  });

  it("keeps the retired activity menu out of the sidebar", () => {
    const { container } = render(
      <WorkspaceShell
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={project}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    // 활동 메뉴는 에이전트 화면으로 통합되어 사라졌다.
    expect(screen.queryByRole("button", { name: "활동" })).not.toBeInTheDocument();
    expect(container.querySelector(".breadcrumbs")).not.toHaveTextContent("활동");
  });

  it("keeps the today banner out of sight while nothing is running", () => {
    render(
      <WorkspaceShell
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={project}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /자세히 보기/ })).not.toBeInTheDocument();
  });

  // R2. 배너는 요약으로 남되 막다른 길이 아니어야 하고, 대표로 지목한 워커가 전용 뷰의 첫 카드와
  // 어긋나면 사용자가 두 화면을 다른 사실로 읽는다.
  it("leads from the today banner to the agents view it summarizes", () => {
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
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={runningProject}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    const banner = screen.getByRole("button", { name: /자세히 보기/ });
    expect(banner).toHaveTextContent("planner-claude");
    fireEvent.click(banner);

    // 배너의 목적지는 이제 에이전트 화면이다. 세부 목록은 그 화면의 앱 밖 세션 절이 맡는다.
    expect(document.querySelector(".breadcrumbs strong")).toHaveTextContent("에이전트");
  });

  it("opens a working settings view", () => {
    const onSwitchProject = vi.fn();
    render(
      <WorkspaceShell
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={project}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
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
      customRules={customRules}
      customRulesActions={customRulesActions}
      busy={false}
      error={null}
      project={project}
      updater={updater}
      integrations={integrations}
      integrationActions={integrationActions}
      managedAssets={managedAssets}
      onAddIdea={vi.fn().mockResolvedValue(true)}
      onAddWorkflow={vi.fn().mockResolvedValue(true)}
      onDecideSpec={vi.fn().mockResolvedValue(true)}
      onMigrate={vi.fn().mockResolvedValue(true)}
      onReadIdea={vi.fn().mockResolvedValue(null)}
      onReadSpec={vi.fn().mockResolvedValue(null)}
      onReadTask={vi.fn().mockResolvedValue(null)}
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
describe.skip("WorkspaceShell 폐기된 연동 배선", () => {
  // 카드 펼침 상태는 저장소에 남는다(SPEC-006 R6). 매 테스트가 빈 저장소에서 시작해야 앞 테스트가
  // 펼쳐 둔 값이 다음 테스트의 시작 상태를 바꾸지 않는다.
  beforeEach(() => {
    stubStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

describe("WorkspaceShell 관리 규칙 알림", () => {
  const baseProps = {
    busy: false,
    customRules,
    customRulesActions,
    error: null,
    project,
    updater,
    integrations,
    integrationActions,
    onAddIdea: vi.fn().mockResolvedValue(true),
    onAddWorkflow: vi.fn().mockResolvedValue(true),
    onDecideSpec: vi.fn().mockResolvedValue(true),
    onMigrate: vi.fn().mockResolvedValue(true),
    onReadIdea: vi.fn().mockResolvedValue(null),
    onReadSpec: vi.fn().mockResolvedValue(null),
    onReadTask: vi.fn().mockResolvedValue(null),
    onRefresh: vi.fn(),
    onSwitchProject: vi.fn(),
  };

  const conflict: ManagedAssetsState = {
    syncing: false,
    result: syncResult({
      status: "conflict",
      affectedAsset: "claim_helper",
      reason: "선점 헬퍼: 관리 형식을 확인할 수 없습니다.",
      assets: [{
        id: "claim_helper",
        label: "선점 헬퍼",
        status: "conflict",
        installedVersion: null,
        providedVersion: 3,
        reason: "관리 형식을 확인할 수 없습니다.",
      }],
    }),
    error: null,
    trigger: "manual_refresh",
  };

  // 완료 조건 6. 동기화가 멈춰도 사이드바와 설정 화면, 프로젝트 전환은 그대로 쓸 수 있어야 한다.
  it("keeps the workspace usable while a conflict is showing", () => {
    const onSwitchProject = vi.fn();
    render(
      <WorkspaceShell {...baseProps} managedAssets={conflict} onSwitchProject={onSwitchProject} />,
    );

    expect(screen.getByText("관리 규칙 충돌: 선점 헬퍼")).toBeInTheDocument();
    expect(screen.getByText("선점 헬퍼: 관리 형식을 확인할 수 없습니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    expect(screen.getByRole("heading", { name: "설정" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "관리 규칙" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다른 프로젝트 열기" }));
    expect(onSwitchProject).toHaveBeenCalledTimes(1);
  });

  // 완료 조건 5. 기다렸다 다시 시도할 상태와 파일을 확인해야 하는 상태를 같은 문구로 합치지 않는다.
  it("tells the retry state apart from the conflict state", () => {
    const retry: ManagedAssetsState = {
      syncing: false,
      result: syncResult({
        status: "retry_required",
        reason: "다른 프로젝트 쓰기 작업이 진행 중입니다.",
      }),
      error: null,
      trigger: "project_open",
    };

    const { unmount } = render(<WorkspaceShell {...baseProps} managedAssets={retry} />);
    expect(screen.getByText("관리 규칙을 나중에 다시 설치해야 합니다")).toBeInTheDocument();
    expect(screen.getByText(/새로 고침을 누르면 다시 시도합니다/)).toBeInTheDocument();
    unmount();

    render(<WorkspaceShell {...baseProps} managedAssets={conflict} />);
    expect(screen.queryByText("관리 규칙을 나중에 다시 설치해야 합니다")).not.toBeInTheDocument();
    expect(screen.getByText(/설정 화면의 관리 규칙 카드/)).toBeInTheDocument();
  });

  // R4. 프로젝트 문서 조회 실패와 동기화 실패는 서로 다른 알림이다.
  it("shows the command failure beside the project error, not inside it", () => {
    render(
      <WorkspaceShell
        {...baseProps}
        error="프로젝트를 읽지 못했습니다."
        managedAssets={{
          syncing: false,
          result: null,
          error: "관리 자산 동기화 명령을 호출하지 못했습니다.",
          trigger: "project_open",
        }}
      />,
    );

    const projectError = screen.getByText("프로젝트를 읽지 못했습니다.");
    expect(projectError).not.toHaveTextContent("관리 규칙");
    expect(screen.getByText("관리 규칙 동기화 명령이 실패했습니다")).toBeInTheDocument();
    expect(screen.getByText("관리 자산 동기화 명령을 호출하지 못했습니다.")).toBeInTheDocument();
  });

  it("stays quiet when the rules are current or were updated", () => {
    const { unmount } = render(
      <WorkspaceShell
        {...baseProps}
        managedAssets={{ syncing: false, result: syncResult(), error: null, trigger: "project_open" }}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    unmount();

    render(
      <WorkspaceShell
        {...baseProps}
        managedAssets={{
          syncing: false,
          result: syncResult({ status: "updated", updatedAssets: ["claim_helper"] }),
          error: null,
          trigger: "manual_refresh",
        }}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * 완료 조건 9. 2.5초 자동 조회는 프로젝트 요약만 바꾸고 관리 자산 상태는 건드리지 않는다
   * (TASK-133). 껍데기는 알림을 따로 기억하지 않으므로 프로젝트가 새로 들어와도 알림이 남는다.
   */
  it("keeps the notice while the automatic re-read replaces the project", () => {
    const { rerender } = render(
      <WorkspaceShell {...baseProps} managedAssets={conflict} />,
    );
    expect(screen.getByText("관리 규칙 충돌: 선점 헬퍼")).toBeInTheDocument();

    rerender(
      <WorkspaceShell
        {...baseProps}
        project={{ ...project, activeLeases: [] }}
        managedAssets={conflict}
      />,
    );

    expect(screen.getByText("관리 규칙 충돌: 선점 헬퍼")).toBeInTheDocument();
  });
});

describe("WorkspaceShell 사용자 규칙 배선", () => {
  it("설정 화면에 사용자 규칙 상태와 동작을 전달한다", () => {
    const preparePreview = vi.fn().mockResolvedValue(null);
    shell({
      customRules: {
        ...customRules,
        document: {
          ...customRules.document!,
          status: "valid",
          enabled: true,
          appliesTo: ["developer"],
          body: "검증 결과를 적는다.",
          contentHash: "sha256:rules",
        },
      },
      customRulesActions: { ...customRulesActions, preparePreview },
    });

    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    expect(screen.getByRole("region", { name: "사용자 정의 규칙" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "사용자 규칙 Markdown 본문" })).toHaveValue(
      "검증 결과를 적는다.",
    );
    fireEvent.click(screen.getByRole("button", { name: "미리보기 준비" }));
    expect(preparePreview).toHaveBeenCalledWith({
      enabled: true,
      appliesTo: ["developer"],
      body: "검증 결과를 적는다.",
    });
  });

  it("사용자 규칙 오류가 있어도 화면 이동과 프로젝트 전환을 유지한다", () => {
    const onSwitchProject = vi.fn();
    shell({
      customRules: {
        ...customRules,
        readError: "사용자 규칙 조회 실패",
      },
      onSwitchProject,
    });

    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    expect(screen.getByText("사용자 규칙 조회 실패")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "관리 규칙" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "아이디어" }));
    expect(screen.getByRole("heading", { name: "아이디어 인박스" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /프로젝트 전환/ }));
    expect(onSwitchProject).toHaveBeenCalledTimes(1);
  });
});

describe("WorkspaceShell 활성 세션 축약 표시", () => {
  const baseProps: ComponentProps<typeof WorkspaceShell> = {
    busy: false,
    customRules,
    customRulesActions,
    error: null,
    project,
    updater,
    integrations,
    integrationActions,
    managedAssets,
    onAddIdea: vi.fn().mockResolvedValue(true),
    onAddWorkflow: vi.fn().mockResolvedValue(true),
    onDecideSpec: vi.fn().mockResolvedValue(true),
    onMigrate: vi.fn().mockResolvedValue(true),
    onReadIdea: vi.fn().mockResolvedValue(null),
    onReadSpec: vi.fn().mockResolvedValue(null),
    onReadTask: vi.fn().mockResolvedValue(null),
    onRefresh: vi.fn(),
    onSwitchProject: vi.fn(),
  };

  function running(count: number): ProjectSummary {
    return {
      ...project,
      activeLeases: Array.from({ length: count }, (_, index) => ({
        leaseId: `lease-${index + 1}`,
        agent: index === 0 ? "planner-claude" : "developer-claude",
        role: index === 0 ? "planner" : "developer",
        taskId: index === 0 ? "IDEA-001" : null,
        heartbeatAt: "2026-08-06T08:55:00Z",
        expiresAt: "2126-08-06T09:12:00Z",
      })),
    };
  }

  function summary(count: number) {
    return screen.getByRole("button", { name: `실행 중인 세션 ${count}개, 에이전트 화면 열기` });
  }

  /** 완료 조건 1. 좌측 메뉴는 화면 전환 분기 바깥에 있으므로 어느 화면을 열어도 표시가 남아야 한다. */
  it("오늘이 아닌 모든 화면에서도 좌측 메뉴에 축약 표시를 남긴다", () => {
    shell({ project: running(2) });

    for (const menu of ["아이디어", "기획서", "개발", "기록", "도움말", "설정"]) {
      fireEvent.click(screen.getByRole("button", { name: menu }));
      expect(summary(2)).toBeInTheDocument();
    }
  });

  /** 완료 조건 2. 숨김 스타일이 아니라 요소 자체가 없어야 빈 자리가 남지 않는다. */
  it("활성 세션이 없으면 축약 표시를 그리지 않는다", () => {
    const { container } = shell();

    fireEvent.click(screen.getByRole("button", { name: "기획서" }));

    expect(screen.queryByRole("button", { name: /실행 중인 세션/ })).not.toBeInTheDocument();
    expect(container.querySelector(".sidebar-activity")).toBeNull();
  });

  /**
   * 완료 조건 3, 6. 축약 표시는 세션이 도는지와 활성 수만 전하고, 담당 에이전트와 대상 문서는 오늘
   * 화면 카드가 계속 맡는다. 두 표시의 정보량이 뒤바뀌지 않았음을 함께 고정한다.
   */
  it("축약 표시에는 활성 수만 담고 상세 정보는 오늘 화면 카드에 남긴다", () => {
    shell({ project: running(2) });

    const compact = summary(2);
    expect(compact).toHaveTextContent("2");
    expect(within(compact).queryByText(/planner-claude/)).not.toBeInTheDocument();
    expect(within(compact).queryByText(/IDEA-001/)).not.toBeInTheDocument();
    expect(within(compact).queryByText(/마이그레이션/)).not.toBeInTheDocument();

    const card = screen.getByRole("button", { name: /자세히 보기/ });
    expect(card).toHaveTextContent("planner-claude");
    expect(card).toHaveTextContent("IDEA-001");
  });

  /** 완료 조건 4, 5. 이미 에이전트 화면일 때 다시 눌러도 같은 값을 넣을 뿐이라 화면이 유지돼야 한다. */
  it("축약 표시를 누르면 에이전트 화면으로 이동하고 다시 눌러도 그대로 머문다", () => {
    shell({ project: running(1) });

    fireEvent.click(summary(1));
    expect(document.querySelector(".breadcrumbs strong")).toHaveTextContent("에이전트");

    fireEvent.click(summary(1));
    expect(document.querySelector(".breadcrumbs strong")).toHaveTextContent("에이전트");
  });

  /** 완료 조건 7. 프로젝트가 바뀌면 축약 표시는 새 프로젝트의 활성 수를 따라야 한다. */
  it("프로젝트가 바뀌면 바뀐 활성 수를 따른다", () => {
    const { rerender } = render(<WorkspaceShell {...baseProps} project={running(2)} />);
    expect(summary(2)).toBeInTheDocument();

    rerender(<WorkspaceShell {...baseProps} project={running(1)} />);
    expect(summary(1)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /실행 중인 세션 2개/ })).not.toBeInTheDocument();

    rerender(<WorkspaceShell {...baseProps} project={project} />);
    expect(screen.queryByRole("button", { name: /실행 중인 세션/ })).not.toBeInTheDocument();
  });
});

describe("WorkspaceShell 막힌 작업 안내", () => {
  const blockedTask = {
    fileName: "TASK-900.md",
    id: "TASK-900",
    title: "막힌 작업",
    status: "blocked",
    updatedAt: "2026-08-08T01:00:00Z",
    dueAt: null,
    excerpt: "보완 작업을 기다린다.",
    sourceSpecId: "SPEC-900",
    sourceDecisionId: "DECISION-GROUP-900",
    workGroupId: "GROUP-900",
    workGroupRevision: 1,
  };
  const blockedGroup = workGroup("GROUP-900", "막힌 작업 그룹", "blocked", 0);
  const blockedProject: ProjectSummary = {
    ...project,
    workflows: [{
      ...project.workflows[0],
      counts: { ...project.workflows[0].counts, workGroups: 1, tasks: 1 },
      items: { ideas: [], specs: [], workGroups: [blockedGroup], tasks: [blockedTask] },
    }],
  };
  it("막힌 작업의 AI 상태와 소속 그룹만 비개발자 언어로 보여준다", async () => {
    render(
      <WorkspaceShell
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={blockedProject}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue({ summary: blockedTask, body: "내부 터미널 명령" })}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "개발" }));
    fireEvent.click(screen.getByRole("button", { name: /막힌 작업/ }));
    const verification = await screen.findByRole("region", { name: "작업 진행 상태" });
    expect(within(verification).getByText("AI 작업이 잠시 멈췄습니다")).toBeInTheDocument();
    const group = screen.getByRole("region", { name: "소속 작업 그룹" });
    expect(within(group).getByText("막힌 작업 그룹")).toBeInTheDocument();
    expect(within(group).getByText("GROUP-900")).toBeInTheDocument();
    expect(within(group).getByText("개발 막힘")).toBeInTheDocument();
    expect(screen.queryByText("내부 터미널 명령")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "에이전트 처리 안내" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /개발 준비로 되돌리기|한 번 더 누르면 재개/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("수정이 필요한 이유")).not.toBeInTheDocument();
  });
});

describe("WorkspaceShell 에이전트 진입점", () => {
  const agentState = {
    inspection: null,
    policy: null,
    reading: false,
    readError: null,
    planning: null,
    plan: null,
    planError: null,
    applying: false,
    application: null,
    applyError: null,
    migration: null,
    migrationBusy: false,
    migrationError: null,
    saving: false,
    saveError: null,
    consentBusy: false,
    consentError: null,
  };

  const agentActions = {
    refresh: vi.fn().mockResolvedValue(undefined),
    setViewActive: vi.fn(),
    plan: vi.fn().mockResolvedValue(undefined),
    cancelPlan: vi.fn(),
    apply: vi.fn().mockResolvedValue(true),
    previewMigration: vi.fn().mockResolvedValue(undefined),
    applyMigration: vi.fn().mockResolvedValue(true),
    dismissMigration: vi.fn(),
    save: vi.fn().mockResolvedValue(true),
    grantConsent: vi.fn().mockResolvedValue(true),
    revokeConsent: vi.fn().mockResolvedValue(true),
  };

  /**
   * 껍데기의 알림은 자동 배정 여부와 동의 상태만 읽는다. 설정 조회 응답 전체를 흉내 낼 필요가 없어
   * 그 두 값과 화면이 함께 읽는 최소한만 담는다.
   */
  function agentPolicy(automationEnabled: boolean, consentStatus: string) {
    return {
      policy: {
        projectId: "prj_1",
        workingDirectory: "/projects/workflow-labs",
        automationEnabled,
        projectMaxParallel: 3,
        deviceMaxParallel: 8,
        roles: {},
      },
      stored: true,
      revision: "rev-1",
      providers: [],
      executionAllowed: true,
      compatibility: { kind: "compatible" },
      consent: {
        status: consentStatus,
        noticeVersion: consentStatus === "granted" ? 1 : null,
        grantedAt: consentStatus === "granted" ? "2026-08-13T15:00:00Z" : null,
        requiredNoticeVersion: 1,
        detail: null,
      },
    };
  }

  function consentState(automationEnabled: boolean, consentStatus: string) {
    return { ...agentState, policy: agentPolicy(automationEnabled, consentStatus) };
  }

  function renderShell(extra: Record<string, unknown>) {
    return render(
      <WorkspaceShell
        customRules={customRules}
        customRulesActions={customRulesActions}
        busy={false}
        error={null}
        project={project}
        updater={updater}
        integrations={integrations}
        integrationActions={integrationActions}
        managedAssets={managedAssets}
        onAddIdea={vi.fn().mockResolvedValue(true)}
        onAddWorkflow={vi.fn().mockResolvedValue(true)}
        onDecideSpec={vi.fn().mockResolvedValue(true)}
        onMigrate={vi.fn().mockResolvedValue(true)}
        onReadIdea={vi.fn().mockResolvedValue(null)}
        onReadSpec={vi.fn().mockResolvedValue(null)}
        onReadTask={vi.fn().mockResolvedValue(null)}
        onRefresh={vi.fn()}
        onSwitchProject={vi.fn()}
        {...extra}
      />,
    );
  }

  it("문서 선점이 아직 없어도 실행이 시작되면 세션 실행 중이 뜬다", () => {
    // 선점 파일은 실행보다 늦게 갱신될 수 있다. 실행 목록이 아는 세션은 그 순간부터 세어야
    // 사용자가 "배정됐다는데 세션이 없다"를 보지 않는다.
    renderShell({
      agentRuntime: {
        ...agentState,
        queue: {
          projectId: "prj_1", paused: false, errors: [], providers: [], unavailable: null,
          runs: [{
            runId: "run-1", projectId: "prj_1", role: "developer", provider: "codex",
            state: "running", targetId: "TASK-001", startedAt: "2026-08-13T09:00:00Z",
            finishedAt: null, failureStage: null, reason: null, remaining: [],
            previousRunId: null, resultPrefix: "RES-run-1",
          }],
        },
      },
      agentRuntimeActions: agentActions,
    });

    expect(screen.getByRole("button", { name: "실행 중인 세션 1개, 에이전트 화면 열기" })).toBeInTheDocument();
  });

  it("작업 공간이 통로를 넘기면 메뉴에서 에이전트 화면을 연다", () => {
    renderShell({ agentRuntime: agentState, agentRuntimeActions: agentActions });

    fireEvent.click(screen.getByRole("button", { name: "에이전트" }));

    expect(screen.getByRole("heading", { level: 1, name: "에이전트" })).toBeInTheDocument();
    // 화면을 여는 것만으로는 어떤 조작도 시작되지 않는다.
    expect(agentActions.refresh).not.toHaveBeenCalled();
    expect(agentActions.plan).not.toHaveBeenCalled();
    expect(agentActions.save).not.toHaveBeenCalled();
  });

  // 배선이 없으면 자리를 만들지 않는다. 빈 화면을 여는 진입점을 사용자에게 내밀지 않는다.
  it("통로가 없으면 진입점을 세우지 않는다", () => {
    renderShell({});

    expect(screen.queryByRole("button", { name: "에이전트" })).not.toBeInTheDocument();
  });

  /*
   * 완료 조건 13, 14. 자동 배정을 이미 켜 둔 사용자는 에이전트 화면을 열 이유가 없으므로 첫 화면에서
   * 동의 요구를 만나야 한다. 그 자리는 동의만 남기고 정책은 저장하지 않는다.
   */
  describe("첫 화면의 실행 권한 동의 알림", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("자동 배정이 켜지고 동의가 필요하면 메뉴를 누르지 않아도 첫 화면에서 동의를 받는다", async () => {
      renderShell({ agentRuntime: consentState(true, "required"), agentRuntimeActions: agentActions });

      expect(screen.getByText("실행 권한 동의 필요")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "고지 읽고 동의" }));

      // 고지 다섯 문장이 모두 있고, 확인 항목은 미리 선택돼 있지 않다.
      for (const fact of EXECUTION_NOTICE_FACTS) {
        expect(screen.getByText(fact)).toBeInTheDocument();
      }
      const agreement = screen.getByRole("checkbox", { name: "위 내용을 읽고 실행 권한에 동의합니다" });
      expect(agreement).not.toBeChecked();

      fireEvent.click(agreement);
      fireEvent.click(screen.getByRole("button", { name: "동의하고 계속" }));

      await waitFor(() => expect(agentActions.grantConsent).toHaveBeenCalledWith(1));
      // 이 자리는 동의만 남긴다. 자동 배정은 이미 켜져 있으므로 저장할 것이 없다.
      expect(agentActions.save).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "실행 권한 동의" })).not.toBeInTheDocument());
    });

    it("자동 배정이 꺼져 있으면 알리지 않는다", () => {
      renderShell({ agentRuntime: consentState(false, "required"), agentRuntimeActions: agentActions });

      expect(screen.queryByText("실행 권한 동의 필요")).not.toBeInTheDocument();
    });

    it("이미 동의한 프로젝트에서는 알리지 않는다", () => {
      renderShell({ agentRuntime: consentState(true, "granted"), agentRuntimeActions: agentActions });

      expect(screen.queryByText("실행 권한 동의 필요")).not.toBeInTheDocument();
    });

    // 에이전트 화면이 같은 안내를 이미 담고 있어 두 번 보일 이유가 없다.
    it("에이전트 화면을 보고 있는 동안에는 그 화면의 안내만 남는다", () => {
      renderShell({ agentRuntime: consentState(true, "required"), agentRuntimeActions: agentActions });

      fireEvent.click(screen.getByRole("button", { name: "에이전트" }));

      expect(screen.getAllByText("실행 권한 동의 필요")).toHaveLength(1);
    });
  });
});
