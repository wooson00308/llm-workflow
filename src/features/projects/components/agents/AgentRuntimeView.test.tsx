import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentPolicySnapshot,
  AgentRolePolicy,
  AgentRunSummary,
  AgentRuntimeActions,
  AgentRuntimeInspection,
  AgentRuntimeState,
  ProjectSummary,
} from "../../domain/types";
import { AgentRuntimeView, readinessOf } from "./AgentRuntimeView";

afterEach(cleanup);

const service = {
  platform: "launchd", result: "registered", registered: true, running: true,
  label: "com.workflowlabs.agent", executable: "/runtime/bin/heartbeat", recoverable: true,
  checkedAt: "2026-08-11T00:00:00Z", evidence: [],
};

function inspection(overrides: Partial<AgentRuntimeInspection> = {}): AgentRuntimeInspection {
  return {
    bundledVersion: "0.9.0",
    status: {
      result: "ok", checkedAt: "2026-08-11T00:00:00Z", runtimeVersion: "0.9.0",
      installedVersion: "0.9.0", runningVersion: "0.9.0", apiMajor: 1,
      target: "macos-universal", installResult: "installed", recoverable: true, service,
    },
    compatibility: { kind: "compatible" }, executionAllowed: true, unavailable: null,
    installRoot: "/runtime", ...overrides,
  };
}

function role(overrides: Partial<AgentRolePolicy> = {}): AgentRolePolicy {
  return { enabled: true, provider: "codex", model: null, runMode: "continuous", maxParallel: 1, intervalSeconds: 300, maxPer: null, ...overrides };
}

function policy(overrides: Partial<AgentPolicySnapshot> = {}): AgentPolicySnapshot {
  return {
    policy: {
      projectId: "prj_1", workingDirectory: "/projects/workflow-labs", automationEnabled: false,
      projectMaxParallel: 3, deviceMaxParallel: 8,
      roles: { planner: role(), architect: role(), developer: role() },
    },
    stored: true, revision: "rev-1", providers: [{ provider: "codex", status: "ready", version: "1.0" }],
    executionAllowed: true, compatibility: { kind: "compatible" },
    deviceCapacity: {
      observed: true, configuredMaxParallel: 8, effectiveMaxParallel: 8, recommendedMaxParallel: 5,
      logicalCpuCount: 10, totalMemoryBytes: 16_000_000_000, reservedMemoryBytes: 4_000_000_000,
      estimatedMemoryPerAgentBytes: 1_500_000_000, activeRuns: 0,
      projects: [{ projectId: "prj_1", projectName: "workflow-labs", projectMaxParallel: 3, activeRuns: 0 }],
    },
    ...overrides,
  };
}

function run(runId: string, state: AgentRunSummary["state"], targetId: string, startedAt = "2026-08-11T00:00:00Z", finishedAt: string | null = "2026-08-11T00:00:09Z"): AgentRunSummary {
  return { runId, projectId: "prj_1", role: "developer", provider: "codex", state, targetId, startedAt, finishedAt, failureStage: state === "failed" ? "role_session" : null, reason: null, remaining: [], previousRunId: null };
}

function project(): ProjectSummary {
  const item = (id: string, title: string, status = "todo") => ({ fileName: `${id}.md`, id, title, status, updatedAt: "2026-08-11T00:00:00Z", excerpt: "" });
  return {
    rootPath: "/projects/workflow-labs", initialized: true, projectId: "prj_1", name: "workflow-labs",
    compatibility: "current", activeLeases: [], pendingWork: { planner: false, architect: false, developer: true },
    pendingDetail: {
      planner: { target: null, targetKind: null, candidates: [] },
      architect: { target: null, targetKind: null, candidates: [] },
      developer: { target: "TASK-1", targetKind: "task", candidates: [{ id: "TASK-1", verdict: "eligible" }, { id: "TASK-2", verdict: "dependency_wait" }] },
    },
    workflows: [{
      id: "wf-1", directory: "feature--wf-1", name: "Feature", status: "active", createdAt: "2026-08-11T00:00:00Z",
      counts: { ideas: 0, specs: 1, decisions: 0, tasks: 3, reports: 0 },
      items: { ideas: [], specs: [item("SPEC-1", "승인을 기다리는 기획", "user_review")], tasks: [item("TASK-1", "조종석 HUD 구현"), item("TASK-2", "후속 작업"), item("TASK-QA", "QA 확인 작업", "qa_waiting")] },
    }],
  };
}

function state(overrides: Partial<AgentRuntimeState> = {}): AgentRuntimeState {
  return {
    inspection: inspection(), policy: policy(), reading: false, readError: null,
    planning: null, plan: null, planError: null, applying: false, application: null, applyError: null,
    migration: null, migrationBusy: false, migrationError: null, saving: false, saveError: null,
    runPlan: null, runRequests: [], runPlanning: false, runStarting: false, runError: null,
    queue: { projectId: "prj_1", paused: false, runs: [], errors: [], providers: [], unavailable: null },
    queueReading: false, queueError: null, pausing: false, cancelPreview: null, cancelResult: null,
    retryPreview: null, controllingRunId: null, controlError: null, logs: {}, readingLogRunId: null, logError: null,
    ...overrides,
  };
}

function actions(overrides: Partial<AgentRuntimeActions> = {}): AgentRuntimeActions {
  return {
    refresh: vi.fn().mockResolvedValue(undefined), setViewActive: vi.fn(), plan: vi.fn().mockResolvedValue(undefined), cancelPlan: vi.fn(), apply: vi.fn().mockResolvedValue(true),
    previewMigration: vi.fn().mockResolvedValue(undefined), applyMigration: vi.fn().mockResolvedValue(true), dismissMigration: vi.fn(), save: vi.fn().mockResolvedValue(true),
    planRun: vi.fn().mockResolvedValue(undefined), cancelRunPlan: vi.fn(), startRun: vi.fn().mockResolvedValue(true), refreshRuns: vi.fn().mockResolvedValue(undefined),
    setProjectPaused: vi.fn().mockResolvedValue(true), previewCancel: vi.fn().mockResolvedValue(undefined), dismissCancel: vi.fn(), confirmCancel: vi.fn().mockResolvedValue(true),
    previewRetry: vi.fn(), dismissRetry: vi.fn(), confirmRetry: vi.fn().mockResolvedValue(true), readRunLog: vi.fn().mockResolvedValue(undefined), ...overrides,
  };
}

function renderView(current = state(), runtimeActions = actions()) {
  return { ...render(<AgentRuntimeView actions={runtimeActions} project={project()} state={current} />), runtimeActions };
}

describe("AgentRuntimeView readiness", () => {
  it("distinguishes ready, missing and incompatible runtimes", () => {
    expect(readinessOf(state()).title).toBe("실행 환경 정상");
    expect(readinessOf(state({ inspection: inspection({ status: null }) })).actionLabel).toBe("설치 계획");
    const update = readinessOf(state({ inspection: inspection({ compatibility: { kind: "versionOutOfRange", found: "0.8.3", minimum: "0.9.0", maximum: "0.9.x" } }) }));
    expect(update.actionLabel).toBe("업데이트 계획");
    expect(update.operation).toBe("install");
  });

  it("keeps direct assignment available while a foreign service waits for migration", () => {
    const foreign = inspection();
    foreign.status!.service = { ...service, label: "com.catze.dream-heartbeat", executable: "/legacy/dream-heartbeat", running: false };
    const readiness = readinessOf(state({ inspection: foreign }));
    expect(readiness.title).toBe("자동 배정 서비스 전환 필요");
    expect(readiness.operation).toBeNull();
  });
});

describe("AgentRuntimeView cockpit", () => {
  it("shows one supervisory screen without old work/settings tabs or integrations", () => {
    renderView();
    expect(screen.getByRole("heading", { name: "에이전트" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "직접 배정" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "고급 설정" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByText(/Dream|연동/i)).not.toBeInTheDocument();
  });

  it("activates lightweight run polling only while the view is mounted", () => {
    const runtimeActions = actions();
    const view = renderView(state(), runtimeActions);
    expect(runtimeActions.setViewActive).toHaveBeenCalledWith(true);
    view.unmount();
    expect(runtimeActions.setViewActive).toHaveBeenLastCalledWith(false);
  });

  it("asks which roles participate the first time automation is enabled", async () => {
    const runtimeActions = actions();
    renderView(state(), runtimeActions);
    fireEvent.click(screen.getByRole("checkbox", { name: "자동 배정 켜기" }));
    const dialog = screen.getByRole("dialog", { name: "자동 배정 켜기" });
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(3);
    expect(within(dialog).getAllByRole("checkbox").every((input) => (input as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "자동 배정 켜기" }));
    await waitFor(() => expect(runtimeActions.save).toHaveBeenCalledWith(expect.objectContaining({ automationEnabled: true })));
  });

  it("keeps automation off until a foreign service has been safely migrated", () => {
    const foreign = inspection();
    foreign.status!.service = { ...service, label: "com.catze.dream-heartbeat", executable: "/legacy/dream-heartbeat", running: false };
    renderView(state({ inspection: foreign }));

    expect(screen.getByRole("checkbox", { name: "자동 배정 켜기" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "전환 준비" }));
    const drawer = screen.getByRole("dialog", { name: "고급 설정" });
    expect(within(drawer).getByText("기존 설정 이전")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "전환할 설정 확인" })).toBeInTheDocument();
    expect(drawer).toHaveTextContent("검증에 실패하면 역할 잡과 서비스를 원래대로 복구");
  });

  it("shows only eligible work by title and keeps technical IDs behind advanced disclosure", () => {
    renderView();
    expect(screen.getByRole("heading", { name: "배정 대기" })).toBeInTheDocument();
    expect(screen.getByText("조종석 HUD 구현")).toBeInTheDocument();
    expect(screen.queryByText("후속 작업")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "직접 배정" }));
    const dialog = screen.getByRole("dialog", { name: "직접 배정" });
    expect(within(dialog).getByText("조종석 HUD 구현")).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText("TASK-…")).not.toBeVisible();
    fireEvent.click(within(dialog).getByText("고급 직접 지정"));
    expect(within(dialog).getByPlaceholderText("TASK-…")).toBeInTheDocument();
  });

  it("keeps user approval and QA gates separate from automatic assignment", () => {
    renderView();
    const section = screen.getByRole("heading", { name: "내 선택 대기" }).closest("section")!;
    expect(section).toHaveTextContent("승인을 기다리는 기획");
    expect(section).toHaveTextContent("QA 확인 작업");
  });

  it("shows a quiet one-line idle state instead of a failed run", () => {
    const empty = project();
    empty.pendingDetail = {
      planner: { target: null, targetKind: null, candidates: [] },
      architect: { target: null, targetKind: null, candidates: [] },
      developer: { target: null, targetKind: null, candidates: [] },
    };
    empty.workflows[0].items.specs = [];
    empty.workflows[0].items.tasks = [];
    render(<AgentRuntimeView actions={actions()} project={empty} state={state()} />);
    expect(screen.getByText(/새 작업을 기다리는 중/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "확인 필요" })).not.toBeInTheDocument();
  });

  it("translates raw runtime errors and degraded watcher state into user actions", () => {
    renderView(state({
      queueError: '런타임 응답이 계약 밖입니다: {"code":"project_not_configured"}',
      queue: { projectId: "prj_1", paused: false, runs: [], errors: [], providers: [], unavailable: null, automation: { enabled: true, dispatcherRunning: true, roles: [], watcher: { status: "degraded", lastEventAt: null, error: "watch failed", updatedAt: "2026-08-11T00:00:00Z" } } },
    }));
    expect(screen.getByText("이 프로젝트의 에이전트 설정을 먼저 저장해 주세요.")).toBeInTheDocument();
    expect(screen.getByText("파일 감시가 중단되어 안전 확인 주기로 동작 중입니다.")).toBeInTheDocument();
    expect(screen.queryByText(/project_not_configured|\{"code"/)).not.toBeInTheDocument();
  });

  it("shows a failed runtime plan as a translated user action instead of hiding it", () => {
    renderView(state({
      inspection: inspection({ compatibility: { kind: "versionOutOfRange", found: "0.8.3", minimum: "0.9.0", maximum: "0.9.x" } }),
      planError: '런타임 응답이 계약 밖입니다: {"code":"project_not_configured"}',
    }));
    expect(screen.getByText("이 프로젝트의 에이전트 설정을 먼저 저장해 주세요.")).toBeInTheDocument();
    expect(screen.queryByText(/project_not_configured|\{"code"/)).not.toBeInTheDocument();
  });

  it("explains the bundled update and service action before applying it", () => {
    renderView(state({
      plan: {
        kind: "install",
        plan: {
          planId: "plan-1", bundledVersion: "0.9.0", target: "macos-universal",
          versionDirectory: "/runtime/versions/0.9.0", launcher: "/runtime/bin/heartbeat",
          alreadyInstalled: false, installedVersion: "0.8.3", serviceTransitionRequired: true,
          service, serviceAction: "migration_required",
        },
      },
    }));
    const dialog = screen.getByRole("dialog", { name: "실행 환경 변경 확인" });
    expect(dialog).toHaveTextContent("0.8.3 → 0.9.0");
    expect(dialog).toHaveTextContent("기존 외부 서비스를 보존하고 전환 준비");
    expect(dialog).toHaveTextContent("중복 등록하거나 삭제하지 않습니다");
  });

  it("shows three recent runs and opens the fixed-duration full history drawer", () => {
    const runs = [1, 2, 3, 4].map((value) => run(`run-${value}`, "succeeded", `TASK-${value}`));
    renderView(state({ queue: { projectId: "prj_1", paused: false, runs, errors: [], providers: [], unavailable: null } }));
    expect(screen.getByRole("heading", { name: "최근 종료" }).closest("section")?.querySelectorAll("li")).toHaveLength(3);
    expect(screen.getAllByText("9초")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "전체 기록" }));
    expect(within(screen.getByRole("dialog", { name: "전체 실행 기록" })).getAllByRole("listitem")).toHaveLength(4);
  });

  it("keeps parallel active runs in start order even when the runtime reorders by update time", () => {
    const older = run("run-b", "running", "TASK-2", "2026-08-11T00:00:00Z", null);
    const newer = run("run-a", "running", "TASK-1", "2026-08-11T00:05:00Z", null);
    const reserved = { ...run("run-c", "reserved", "TASK-QA"), startedAt: null, finishedAt: null };
    renderView(state({ queue: { projectId: "prj_1", paused: false, runs: [newer, reserved, older], errors: [], providers: [], unavailable: null } }));
    const rows = screen.getByRole("heading", { name: "진행 중" }).closest("section")!.querySelectorAll("li strong");
    expect([...rows].map((node) => node.textContent)).toEqual(["후속 작업", "조종석 HUD 구현", "QA 확인 작업"]);
  });

  it("opens advanced settings and closes drawers with Escape", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "고급 설정" }));
    expect(screen.getByRole("dialog", { name: "고급 설정" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "고급 설정" })).not.toBeInTheDocument();
  });
});
