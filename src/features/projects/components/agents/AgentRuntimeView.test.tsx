import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentPolicySnapshot,
  AgentProjectConsent,
  AgentRolePolicy,
  AgentRunSummary,
  AgentRuntimeActions,
  AgentRuntimeApplication,
  AgentRuntimeInspection,
  AgentRuntimeState,
  AgentStageResult,
  ProjectSummary,
} from "../../domain/types";
import { humanRuntimeMessage } from "./AgentRunDashboard";
import { AgentRuntimeView, EXECUTION_NOTICE_FACTS, readinessOf } from "./AgentRuntimeView";

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

function consent(overrides: Partial<AgentProjectConsent> = {}): AgentProjectConsent {
  return { status: "granted", noticeVersion: 1, grantedAt: "2026-08-13T15:00:00Z", requiredNoticeVersion: 1, detail: null, ...overrides };
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
    consent: consent(),
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
  return { runId, projectId: "prj_1", role: "developer", provider: "codex", state, targetId, startedAt, finishedAt, failureStage: state === "failed" ? "role_session" : null, reason: null, remaining: [], previousRunId: null, resultPrefix: `RES-${runId}` };
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
      counts: { ideas: 0, specs: 1, decisions: 0, workGroups: 1, tasks: 3, reports: 0 },
      items: {
        ideas: [],
        specs: [item("SPEC-1", "승인을 기다리는 기획", "user_review")],
        workGroups: [{
          fileName: "GROUP-1.md", id: "GROUP-1", title: "QA 확인 작업", status: "active",
          displayStatus: "qa_ready", revision: 1, qaMode: "user", sourceSpecId: "SPEC-1",
          sourceDecisionId: "DECISION-1", sourceQaDecisionId: null, updatedAt: "2026-08-11T00:00:00Z",
          description: "", scenarios: [{ id: "QA-01", title: "화면 확인", body: "화면을 확인합니다." }],
        }],
        tasks: [item("TASK-1", "조종석 HUD 구현"), item("TASK-2", "후속 작업"), {
          ...item("TASK-QA", "QA 확인 작업", "verified"), workGroupId: "GROUP-1", workGroupRevision: 1,
        }],
      },
    }],
  };
}

function state(overrides: Partial<AgentRuntimeState> = {}): AgentRuntimeState {
  return {
    inspection: inspection(), policy: policy(), reading: false, readError: null,
    planning: null, plan: null, planError: null, applying: false, application: null, applyError: null,
    migration: null, migrationBusy: false, migrationError: null, saving: false, saveError: null,
    releaseCheck: null, checkingRelease: false, releaseError: null,
    consentBusy: false, consentError: null,
    runPlan: null, runRequests: [], runPlanning: false, runStarting: false, runError: null,
    queue: { projectId: "prj_1", paused: false, runs: [], errors: [], providers: [], unavailable: null },
    queueReading: false, queueError: null, pausing: false, cancelPreview: null, cancelResult: null,
    retryPreview: null, controllingRunId: null, controlError: null, logs: {}, readingLogRunId: null, logError: null,
    logWatchRunId: null, runReports: {}, runAudits: {}, reportView: null, diagnosticExport: null,
    ...overrides,
  };
}

function actions(overrides: Partial<AgentRuntimeActions> = {}): AgentRuntimeActions {
  return {
    refresh: vi.fn().mockResolvedValue(undefined), setViewActive: vi.fn(), plan: vi.fn().mockResolvedValue(undefined), cancelPlan: vi.fn(), checkRelease: vi.fn().mockResolvedValue(undefined), apply: vi.fn().mockResolvedValue(true),
    previewMigration: vi.fn().mockResolvedValue(undefined), applyMigration: vi.fn().mockResolvedValue(true), dismissMigration: vi.fn(), save: vi.fn().mockResolvedValue(true),
    grantConsent: vi.fn().mockResolvedValue(true), revokeConsent: vi.fn().mockResolvedValue(true),
    planRun: vi.fn().mockResolvedValue(undefined), cancelRunPlan: vi.fn(), startRun: vi.fn().mockResolvedValue(true), refreshRuns: vi.fn().mockResolvedValue(undefined),
    setProjectPaused: vi.fn().mockResolvedValue(true), previewCancel: vi.fn().mockResolvedValue(undefined), dismissCancel: vi.fn(), confirmCancel: vi.fn().mockResolvedValue(true),
    previewRetry: vi.fn(), dismissRetry: vi.fn(), confirmRetry: vi.fn().mockResolvedValue(true), readRunLog: vi.fn().mockResolvedValue(undefined),
    watchRunLog: vi.fn(), readRunReports: vi.fn().mockResolvedValue(undefined), openReport: vi.fn().mockResolvedValue(undefined),
    closeReport: vi.fn(), exportRunDiagnostics: vi.fn().mockResolvedValue(undefined), ...overrides,
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

  it("removes a target from waiting and direct assign the moment a run claims it", () => {
    // 배정 대기와 진행 중이 같은 실행 데이터를 봐야 한다. 파일 스냅샷의 선점 제외를 기다리면
    // 실행이 잡은 작업이 대기 목록에 그대로 남는 시차가 생긴다(2026-08-15 실측).
    renderView(state({
      queue: {
        projectId: "prj_1", paused: false, errors: [], providers: [], unavailable: null,
        runs: [run("run-1", "running", "TASK-1", "2026-08-11T00:00:00Z", null)],
      },
    }));

    // 유일한 배정 가능 후보(TASK-1)가 실행에 잡혔으므로 배정 대기 절 자체가 사라진다.
    expect(screen.queryByRole("heading", { name: "배정 대기" })).not.toBeInTheDocument();
    // 직접 배정도 실행 중인 대상을 후보로 내놓지 않는다.
    fireEvent.click(screen.getByRole("button", { name: "직접 배정" }));
    const dialog = screen.getByRole("dialog", { name: "직접 배정" });
    expect(within(dialog).getByText("현재 이 역할에 안전하게 배정할 작업이 없습니다.")).toBeInTheDocument();
  });

  it("keeps user approval and group QA gates separate from automatic assignment", () => {
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
    empty.workflows[0].items.workGroups = [];
    empty.workflows[0].items.tasks = [];
    render(<AgentRuntimeView actions={actions()} project={empty} state={state()} />);
    expect(screen.getByText(/새 작업을 기다리는 중/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "확인 필요" })).not.toBeInTheDocument();
  });

  // 단독 수행 작업이 차례를 기다리는 동안 자격 후보가 하나도 남지 않는다. 그때 배정 대기 구역이
  // 통째로 사라지면 사용자가 멈춘 것과 기다리는 것을 구별할 수 없다.
  function soloProject(candidates: { id: string; verdict: string }[]): ProjectSummary {
    const base = project();
    return {
      ...base,
      pendingDetail: {
        planner: { target: null, targetKind: null, candidates: [] },
        architect: { target: null, targetKind: null, candidates: [] },
        developer: { target: null, targetKind: null, candidates },
      },
    };
  }

  it("names the solo task that is waiting for the running sessions to finish", () => {
    const waiting = soloProject([{ id: "TASK-2", verdict: "solo-run-wait" }]);
    render(<AgentRuntimeView actions={actions()} project={waiting} state={state()} />);
    const notice = screen.getByText(/후속 작업/);
    expect(notice).toHaveTextContent("혼자 실행해야 해서");
    expect(notice).toHaveTextContent("진행 중인 세션이 모두 끝나면");
    expect(notice).toHaveTextContent("따로 하실 일 없이 자동으로 시작합니다");
    expect(screen.getByRole("heading", { name: "배정 대기" })).toBeInTheDocument();
  });

  it("explains why nothing else starts while one solo task runs alone", () => {
    const running = soloProject([{ id: "TASK-2", verdict: "solo-run-active" }]);
    render(<AgentRuntimeView actions={actions()} project={running} state={state()} />);
    const notice = screen.getByText(/혼자 실행해야 하는 작업 하나가/);
    expect(notice).toHaveTextContent("이 프로젝트를 사용하고 있어");
    expect(notice).toHaveTextContent("다른 작업은 그 작업이 끝난 뒤에 자동으로 시작합니다");
  });

  it("leaves the screen unchanged when no solo verdict is present", () => {
    renderView();
    expect(screen.queryByText(/혼자 실행해야/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "배정 대기" })).toBeInTheDocument();
    expect(screen.getByText("조종석 HUD 구현")).toBeInTheDocument();
  });

  it("writes both solo sentences without paths or code identifiers", () => {
    for (const candidate of [{ id: "TASK-2", verdict: "solo-run-wait" }, { id: "TASK-2", verdict: "solo-run-active" }]) {
      cleanup();
      render(<AgentRuntimeView actions={actions()} project={soloProject([candidate])} state={state()} />);
      const sentence = screen.getByText(/혼자 실행해야/).textContent ?? "";
      expect(sentence).not.toMatch(/\//);
      expect(sentence).not.toMatch(/[A-Za-z]+_[A-Za-z]+/);
    }
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

  it("calls a service-only plan a connection instead of a runtime change", () => {
    renderView(state({
      plan: {
        kind: "install",
        plan: {
          planId: "plan-2", bundledVersion: "0.9.0", target: "macos-universal",
          versionDirectory: "/runtime/versions/0.9.0", launcher: "/runtime/bin/heartbeat",
          alreadyInstalled: true, installedVersion: "0.9.0", serviceTransitionRequired: true,
          service, serviceAction: "register",
        },
      },
    }));
    const dialog = screen.getByRole("dialog", { name: "관리형 서비스 연결 확인" });
    expect(within(dialog).getByRole("heading", { name: "관리형 서비스 연결" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { level: 2 }).textContent ?? "").not.toMatch(/설치/);
    expect(dialog).toHaveTextContent("앱이 관리하는 서비스 연결만 새로 만듭니다");
    expect(dialog).not.toHaveTextContent("앱이 관리하는 런타임만 변경합니다");
    // 버전이 달라지지 않는데 화살표 양쪽에 같은 값을 적으면 무엇이 바뀌는지 되묻게 된다.
    expect(dialog).toHaveTextContent("0.9.0 그대로 유지");
    expect(dialog).not.toHaveTextContent("0.9.0 → 0.9.0");
  });

  it("keeps the runtime change wording when the versions differ or one is missing", () => {
    const notInstalled = renderView(state({
      plan: {
        kind: "install",
        plan: {
          planId: "plan-3", bundledVersion: "0.9.0", target: "macos-universal",
          versionDirectory: "/runtime/versions/0.9.0", launcher: "/runtime/bin/heartbeat",
          alreadyInstalled: false, installedVersion: null, serviceTransitionRequired: true,
          service, serviceAction: "register",
        },
      },
    }));
    let dialog = screen.getByRole("dialog", { name: "실행 환경 변경 확인" });
    expect(within(dialog).getByRole("heading", { name: "실행 환경 변경" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("설치 안 됨 → 0.9.0");
    notInstalled.unmount();

    renderView(state({
      plan: {
        kind: "repair",
        plan: {
          planId: "plan-4", result: "planned", targetVersion: "0.9.0", target: "macos-universal",
          manifestVerified: true, launcherSwitchRequired: false, serviceTransitionRequired: false,
          recoverableOnFailure: true, installedVersion: "0.9.0", runningVersion: "0.9.0",
          activeRuns: 2, projects: ["prj_1"], service,
        },
      },
    }));
    dialog = screen.getByRole("dialog", { name: "실행 환경 변경 확인" });
    expect(within(dialog).getByRole("heading", { name: "실행 환경 변경" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("0.9.0 그대로 유지");
    expect(dialog).not.toHaveTextContent("0.9.0 → 0.9.0");
  });

  it("checks the published runtime from the advanced drawer without downloading", () => {
    const { runtimeActions } = renderView();
    fireEvent.click(screen.getByRole("button", { name: "고급 설정" }));
    const drawer = screen.getByRole("dialog", { name: "고급 설정" });

    fireEvent.click(within(drawer).getByRole("button", { name: "최신 런타임 확인" }));

    expect(runtimeActions.checkRelease).toHaveBeenCalledTimes(1);
    expect(runtimeActions.plan).not.toHaveBeenCalled();
  });

  it("offers the download only for a newer supported runtime and routes the rest", () => {
    // 설치본(0.9.0)이 최신이면 받기를 열지 않는다.
    const { runtimeActions, unmount } = renderView(state({
      releaseCheck: { version: "0.9.0", withinSupportedRange: true },
    }));
    fireEvent.click(screen.getByRole("button", { name: "고급 설정" }));
    let drawer = screen.getByRole("dialog", { name: "고급 설정" });
    expect(within(drawer).getByText(/설치된 런타임이 최신입니다/)).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: /받아서 설치/ })).not.toBeInTheDocument();
    unmount();

    // 새 버전이 지원 범위 안이면 받기를 연다.
    const supported = renderView(state({
      releaseCheck: { version: "0.9.5", withinSupportedRange: true },
    }));
    fireEvent.click(screen.getByRole("button", { name: "고급 설정" }));
    drawer = screen.getByRole("dialog", { name: "고급 설정" });
    fireEvent.click(within(drawer).getByRole("button", { name: "0.9.5 받아서 설치" }));
    expect(supported.runtimeActions.plan).toHaveBeenCalledWith("download");
    supported.unmount();

    // 지원 범위 밖이면 받기 대신 앱 업데이트로 안내한다.
    const outOfRange = renderView(state({
      releaseCheck: { version: "2.0.0", withinSupportedRange: false },
    }));
    fireEvent.click(screen.getByRole("button", { name: "고급 설정" }));
    drawer = screen.getByRole("dialog", { name: "고급 설정" });
    expect(within(drawer).getByText(/앱을 먼저 업데이트해 주세요/)).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: /받아서 설치/ })).not.toBeInTheDocument();
    expect(outOfRange.runtimeActions.plan).not.toHaveBeenCalled();
    expect(runtimeActions.plan).not.toHaveBeenCalled();
  });

  it("shows three recent runs and opens the fixed-duration full history drawer", () => {
    const runs = [1, 2, 3, 4].map((value) => run(`run-${value}`, "succeeded", `TASK-${value}`));
    renderView(state({ queue: { projectId: "prj_1", paused: false, runs, errors: [], providers: [], unavailable: null } }));
    expect(screen.getByRole("heading", { name: "최근 종료" }).closest("section")?.querySelectorAll("li")).toHaveLength(3);
    expect(screen.getAllByText("9초")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "전체 기록" }));
    expect(within(screen.getByRole("dialog", { name: "전체 실행 기록" })).getAllByRole("listitem")).toHaveLength(4);
  });

  it("turns provider readiness codes into user guidance instead of raw codes", () => {
    expect(humanRuntimeMessage("provider_executable_missing")).toBe("실행 도구가 설치되어 있지 않거나 찾을 수 없습니다. 설치를 확인해 주세요.");
    expect(humanRuntimeMessage("provider_unsupported_version")).toBe("실행 도구 버전이 낮습니다. 실행 도구를 업데이트해 주세요.");
    expect(humanRuntimeMessage("provider_login_required")).toBe("실행 도구 로그인이 필요합니다.");
    expect(humanRuntimeMessage("Not inside a trusted directory and --skip-git-repo-check was not specified.")).toBe("실행 도구가 프로젝트 폴더에서 실행을 거부했습니다. 실행 환경을 최신 버전으로 업데이트하면 해결됩니다.");
    expect(humanRuntimeMessage("diagnostic")).toBe("실행 도구 점검에 실패했습니다. 실행 도구 설치와 로그인 상태를 확인해 주세요.");
    const withProvider = state();
    withProvider.policy = policy({ providers: [{ provider: "codex", status: "executable_missing", version: null }] });
    renderView(withProvider);
    expect(screen.getByText(/codex: 실행 도구가 설치되어 있지 않거나/)).toBeInTheDocument();
  });

  it("counts only actionable QA in the waiting list while the spec batch is locked", () => {
    const custom = project();
    const [first, second] = custom.workflows[0].items.tasks;
    custom.workflows[0].items.tasks = [
      { ...first, id: "TASK-A", fileName: "TASK-A.md", status: "qa_waiting", sourceSpecId: "SPEC-9" },
      { ...second, id: "TASK-B", fileName: "TASK-B.md", status: "in_progress", sourceSpecId: "SPEC-9" },
    ];
    render(<AgentRuntimeView actions={actions()} project={custom} state={state()} />);
    // 기획 승인 건은 남고, 통째 QA 관문에 잠긴 작업은 세지 않는다.
    expect(screen.getByText("기획 승인")).toBeInTheDocument();
    expect(screen.queryByText("QA 확인")).not.toBeInTheDocument();
  });

  it("keeps parallel active runs in start order even when the runtime reorders by update time", () => {
    const older = run("run-b", "running", "TASK-2", "2026-08-11T00:00:00Z", null);
    const newer = run("run-a", "running", "TASK-1", "2026-08-11T00:05:00Z", null);
    const reserved = { ...run("run-c", "reserved", "TASK-QA"), startedAt: null, finishedAt: null };
    renderView(state({ queue: { projectId: "prj_1", paused: false, runs: [newer, reserved, older], errors: [], providers: [], unavailable: null } }));
    const rows = screen.getByRole("heading", { name: "진행 중" }).closest("section")!.querySelectorAll("li strong");
    expect([...rows].map((node) => node.textContent)).toEqual(["후속 작업", "조종석 HUD 구현", "QA 확인 작업"]);
  });

  it("renders the model list from the provider catalog and marks a vanished stored model", () => {
    const withCatalog = state();
    withCatalog.policy = policy({
      policy: {
        projectId: "prj_1", workingDirectory: "/projects/workflow-labs", automationEnabled: false,
        projectMaxParallel: 3, deviceMaxParallel: 8,
        roles: { planner: role({ model: "gpt-5.6" }), architect: role(), developer: role() },
      },
      providers: [{
        provider: "codex", status: "ready", version: "1.0",
        modelCatalog: { status: "available", models: [{ id: "gpt-5.6-sol", label: "GPT-5.6-Sol" }, { id: "gpt-5.7-nova", label: "GPT-5.7-Nova" }] },
      }],
    });
    renderView(withCatalog);
    fireEvent.click(screen.getByRole("button", { name: "고급 설정" }));
    const select = screen.getByRole("combobox", { name: "기획자 모델" });
    expect(within(select).getByText("현재 설정 · gpt-5.6 — 계정 목록에 없음")).toBeInTheDocument();
    expect(within(select).getByText("GPT-5.6-Sol · 최고 성능")).toBeInTheDocument();
    expect(within(select).getByText("GPT-5.7-Nova")).toBeInTheDocument();
    expect(screen.getByText(/실행은 기본 모델로 진행됩니다/)).toBeInTheDocument();
  });

  it("opens advanced settings and closes drawers with Escape", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "고급 설정" }));
    expect(screen.getByRole("dialog", { name: "고급 설정" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "고급 설정" })).not.toBeInTheDocument();
  });
});

const runStart = "2026-08-11T00:00:00Z";

function event(kind: string, elapsedSeconds: number, extra: Record<string, unknown> = {}) {
  return { kind, provider: "codex", role: "developer", targetId: "TASK-2", startedAt: runStart, elapsedSeconds, detail: null, ...extra };
}

function queueOf(runs: AgentRunSummary[]) {
  return { projectId: "prj_1", paused: false, runs, errors: [], providers: [], unavailable: null };
}

function logsOf(runId: string, events: unknown[]) {
  return { [runId]: { runId, events, nextCursor: events.length } };
}

function openDetail(title: string) {
  fireEvent.click(screen.getByText(title).closest("button")!);
  return screen.getByRole("complementary", { name: "에이전트 상세" });
}

function clock(value: string) {
  return new Date(Date.parse(value)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** 요약 카드에서 항목 하나의 값. 카드와 신호 줄이 같은 낱말을 쓰므로 자리로 찾는다. */
function cardValue(drawer: HTMLElement, label: string) {
  const rows = [...drawer.querySelectorAll("dl.agent-run-card > div")];
  return rows.find((row) => row.querySelector("dt")?.textContent === label)!.querySelector("dd")!;
}

function signalRows(drawer: HTMLElement) {
  return [...drawer.querySelectorAll("ol.agent-run-events > li")];
}

function withClock(at: string, body: () => void) {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date(at));
    body();
  } finally {
    vi.useRealTimers();
  }
}

describe("AgentRuntimeView run detail", () => {
  it("replaces the per-event list with one summary card and its tool totals", () => {
    const events = [
      event("started", 0),
      ...Array.from({ length: 8 }, (_, index) => event("progress", index + 1)),
      ...Array.from({ length: 22 }, (_, index) => event("tool", index + 10, { toolName: "Read" })),
    ];
    withClock("2026-08-11T00:01:00Z", () => {
      renderView(state({
        queue: queueOf([run("run-1", "running", "TASK-2", runStart, null)]),
        logs: logsOf("run-1", events),
      }));

      const drawer = openDetail("후속 작업");
      expect(cardValue(drawer, "도구 사용")).toHaveTextContent("총 22회");
      expect(cardValue(drawer, "도구 사용")).toHaveTextContent("파일 읽기 22");
      expect(cardValue(drawer, "마지막 활동")).toHaveTextContent(clock("2026-08-11T00:00:31Z"));
      // 줄로 남는 것은 시작 하나뿐이다. 진행 8건과 도구 22건은 집계로만 들어간다.
      expect(signalRows(drawer).map((row) => row.querySelector("span")?.textContent)).toEqual(["시작"]);
    });
  });

  it("shows the target, time, outcome and reason of a finished run", () => {
    const failed = { ...run("run-1", "failed", "TASK-2", runStart, "2026-08-11T00:00:30Z"), reason: "model_unavailable" };
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({ queue: queueOf([failed]), logs: logsOf("run-1", [event("started", 0)]) }));

      const drawer = openDetail("후속 작업");
      expect(cardValue(drawer, "대상")).toHaveTextContent("후속 작업");
      expect(cardValue(drawer, "시작")).toHaveTextContent(clock(runStart));
      expect(cardValue(drawer, "소요")).toHaveTextContent("30초");
      expect(cardValue(drawer, "상태")).toHaveTextContent("실패");
      expect(cardValue(drawer, "사유")).toHaveTextContent("선택한 모델을 현재 계정에서 사용할 수 없습니다");
    });
  });

  it("shows the runtime failure detail verbatim instead of a success summary", () => {
    const detail = "role session exited with code 2: lease renew failed";
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({
        queue: queueOf([run("run-1", "failed", "TASK-2", runStart, "2026-08-11T00:00:30Z")]),
        logs: logsOf("run-1", [event("started", 0), event("failed", 30, { detail })]),
      }));

      const drawer = openDetail("후속 작업");
      expect(within(drawer).getByText(detail)).toBeInTheDocument();
    });
  });

  it("hides the raw name of an unknown tool and keeps the card readable", () => {
    withClock("2026-08-11T00:01:00Z", () => {
      renderView(state({
        queue: queueOf([run("run-1", "running", "TASK-2", runStart, null)]),
        logs: logsOf("run-1", [event("tool", 5, { toolName: "mcp__vendor__internal_probe" }), event("tool", 6, { toolName: null })]),
      }));

      const drawer = openDetail("후속 작업");
      expect(within(drawer).getByText("총 2회")).toBeInTheDocument();
      expect(within(drawer).getByText("기타 1")).toBeInTheDocument();
      expect(within(drawer).getByText("이름 없음 1")).toBeInTheDocument();
      expect(within(drawer).queryByText(/mcp__vendor/)).not.toBeInTheDocument();
    });
  });

  it("summarizes a run whose events carry no tool name at all", () => {
    withClock("2026-08-11T00:01:00Z", () => {
      renderView(state({
        queue: queueOf([run("run-1", "succeeded", "TASK-2", runStart, "2026-08-11T00:00:20Z")]),
        logs: logsOf("run-1", [event("started", 0), event("tool", 5), event("tool", 9), event("completed", 20)]),
      }));

      const drawer = openDetail("후속 작업");
      expect(cardValue(drawer, "도구 사용")).toHaveTextContent("총 2회");
      expect(cardValue(drawer, "도구 사용")).toHaveTextContent("이름 없음 2");
      expect(signalRows(drawer).map((row) => row.querySelector("span")?.textContent)).toEqual(["시작", "완료"]);
    });
  });

  it("marks tool counts and last activity as unknown while the log has not been read", () => {
    withClock("2026-08-11T00:01:00Z", () => {
      renderView(state({ queue: queueOf([run("run-1", "running", "TASK-2", runStart, null)]), logError: "읽지 못했습니다" }));

      const drawer = openDetail("후속 작업");
      expect(within(drawer).getAllByText("모름")).toHaveLength(2);
      expect(within(drawer).getByText(/실행 기록을 읽지 못했습니다/)).toBeInTheDocument();
      expect(within(drawer).queryByText(/총 .*회/)).not.toBeInTheDocument();
    });
  });

  it("raises a quiet-run signal after five minutes and drops it when a new event arrives", () => {
    const active = queueOf([run("run-1", "running", "TASK-2", runStart, null)]);
    withClock("2026-08-11T00:05:05Z", () => {
      const view = renderView(state({ queue: active, logs: logsOf("run-1", [event("started", 0), event("tool", 5, { toolName: "Bash" })]) }));

      const drawer = openDetail("후속 작업");
      expect(within(drawer).getByText("활동 없음")).toBeInTheDocument();
      expect(within(drawer).getByText("5분째 조용함")).toBeInTheDocument();
      // 신호는 표시일 뿐이므로 실행 상태를 실패로 바꾸지 않는다.
      expect(cardValue(drawer, "상태")).toHaveTextContent("진행 중");
      expect(within(drawer).queryByText("실패")).not.toBeInTheDocument();

      view.rerender(<AgentRuntimeView actions={view.runtimeActions} project={project()} state={state({
        queue: active,
        logs: logsOf("run-1", [event("started", 0), event("tool", 5, { toolName: "Bash" }), event("progress", 305)]),
      })} />);
      expect(within(screen.getByRole("complementary", { name: "에이전트 상세" })).queryByText("활동 없음")).not.toBeInTheDocument();
    });
  });

  it("reads the log while the detail is open and stops when it closes", () => {
    const runtimeActions = actions();
    withClock("2026-08-11T00:01:00Z", () => {
      renderView(state({ queue: queueOf([run("run-1", "running", "TASK-2", runStart, null)]) }), runtimeActions);

      openDetail("후속 작업");
      expect(runtimeActions.watchRunLog).toHaveBeenCalledWith("run-1");

      fireEvent.keyDown(window, { key: "Escape" });
      expect(runtimeActions.watchRunLog).toHaveBeenLastCalledWith(null);
    });
  });

  it("keeps run assignment, cancel and retry controls unchanged", () => {
    withClock("2026-08-11T01:00:00Z", () => {
      const runtimeActions = actions();
      renderView(state({ queue: queueOf([run("run-1", "failed", "TASK-2", runStart, "2026-08-11T00:00:30Z")]) }), runtimeActions);

      const drawer = openDetail("후속 작업");
      fireEvent.click(within(drawer).getByRole("button", { name: "재시도" }));
      expect(runtimeActions.previewRetry).toHaveBeenCalledWith("run-1");
      expect(within(drawer).queryByRole("button", { name: "취소" })).not.toBeInTheDocument();
    });
  });

});

const report = { fileName: "REPORT-TASK-2-DEV.md", title: "후속 작업 구현 보고서" };

describe("AgentRuntimeView run reports", () => {
  it("shows a shortcut for a run that left a report and asks the backend which reports are its own", () => {
    const runtimeActions = actions();
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({
        queue: queueOf([run("run-1", "succeeded", "TASK-2")]),
        runReports: { "run-1": [report] },
      }), runtimeActions);

      const drawer = openDetail("후속 작업");
      expect(cardValue(drawer, "결과 보고서")).toHaveTextContent(report.title);
      // 판정 입력은 실행 기록이 이미 싣고 있는 두 값과 등록된 워크플로 디렉터리뿐이다. 파일 이름과
      // 경로는 화면이 만들지 않는다.
      expect(runtimeActions.readRunReports).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", targetId: "TASK-2", resultPrefix: "RES-run-1" }),
        "feature--wf-1",
      );
    });
  });

  it("leaves the card without a shortcut when the run left nothing and never borrows another run's list", () => {
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({
        queue: queueOf([run("run-1", "succeeded", "TASK-2"), run("run-2", "succeeded", "TASK-1")]),
        runReports: { "run-2": [report] },
        runAudits: { "run-1": "silent" },
      }));

      const drawer = openDetail("후속 작업");
      expect(cardValue(drawer, "결과 보고서")).toHaveTextContent("이 실행은 결과 보고서를 남기지 않았습니다.");
      expect(within(drawer).queryByText(report.title)).not.toBeInTheDocument();
    });
  });

  it("asks for nothing when the run's target belongs to no registered workflow", () => {
    const runtimeActions = actions();
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({
        queue: queueOf([{ ...run("run-1", "succeeded", "TASK-1"), targetId: "TASK-GONE" }]),
        runReports: { "run-1": [report] },
      }), runtimeActions);

      openDetail("TASK-GONE");
      expect(runtimeActions.readRunReports).not.toHaveBeenCalled();
      expect(screen.queryByText(report.title)).not.toBeInTheDocument();
    });
  });

  it("opens the chosen report by the file name the backend listed", () => {
    const runtimeActions = actions();
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({
        queue: queueOf([run("run-1", "succeeded", "TASK-2")]),
        runReports: { "run-1": [report] },
      }), runtimeActions);

      const drawer = openDetail("후속 작업");
      fireEvent.click(within(drawer).getByRole("button", { name: report.title }));
      expect(runtimeActions.openReport).toHaveBeenCalledWith("feature--wf-1", report);
    });
  });

  it("shows the report body verbatim with no editing input or save control", () => {
    const body = "# 보고서\n\n## 결정권자 요약\n\n검사 469개가 통과했다.\n";
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({
        queue: queueOf([run("run-1", "succeeded", "TASK-2")]),
        runReports: { "run-1": [report] },
        reportView: { ...report, body, reading: false, error: null },
      }));

      openDetail("후속 작업");
      const dialog = screen.getByRole("dialog", { name: report.title });
      expect(dialog.querySelector("pre")).toHaveTextContent("검사 469개가 통과했다.");
      expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
      expect(within(dialog).queryByRole("button", { name: /저장|수정|삭제/ })).not.toBeInTheDocument();
    });
  });

  it("says the body could not be read instead of showing an empty one", () => {
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({
        queue: queueOf([run("run-1", "succeeded", "TASK-2")]),
        runReports: { "run-1": [report] },
        reportView: { ...report, body: null, reading: false, error: "보고서 파일을 찾을 수 없습니다" },
      }));

      openDetail("후속 작업");
      const dialog = screen.getByRole("dialog", { name: report.title });
      expect(dialog).toHaveTextContent("보고서를 읽지 못했습니다 · 보고서 파일을 찾을 수 없습니다");
      expect(dialog.querySelector("pre")).toBeNull();
    });
  });

  it("marks the body as still loading while the read is in flight", () => {
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({
        queue: queueOf([run("run-1", "succeeded", "TASK-2")]),
        runReports: { "run-1": [report] },
        reportView: { ...report, body: null, reading: true, error: null },
      }));

      openDetail("후속 작업");
      const dialog = screen.getByRole("dialog", { name: report.title });
      expect(dialog).toHaveTextContent("보고서를 읽는 중입니다.");
      expect(dialog.querySelector("pre")).toBeNull();
    });
  });

  it("closes only the report on Escape and leaves the run detail open", () => {
    const runtimeActions = actions();
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({
        queue: queueOf([run("run-1", "succeeded", "TASK-2")]),
        runReports: { "run-1": [report] },
        reportView: { ...report, body: "본문", reading: false, error: null },
      }), runtimeActions);

      openDetail("후속 작업");
      fireEvent.keyDown(window, { key: "Escape" });
      expect(runtimeActions.closeReport).toHaveBeenCalled();
      expect(screen.getByRole("complementary", { name: "에이전트 상세" })).toBeInTheDocument();
    });
  });
});

describe("AgentRuntimeView silent runs", () => {
  it("marks a run that ended without a report in the recent list and in the full history", () => {
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({
        queue: queueOf([run("run-1", "succeeded", "TASK-2"), run("run-2", "succeeded", "TASK-1")]),
        runAudits: { "run-1": "silent", "run-2": "reported" },
      }));

      const recent = screen.getByRole("region", { name: "최근 종료" });
      expect(within(recent).getByText("후속 작업").closest("button")).toHaveTextContent("보고서 없음");
      expect(within(recent).getByText("조종석 HUD 구현").closest("button")).not.toHaveTextContent("보고서 없음");

      fireEvent.click(within(recent).getByRole("button", { name: "전체 기록" }));
      const history = screen.getByRole("dialog", { name: "전체 실행 기록" });
      expect(within(history).getByText("후속 작업").closest(".agent-history-row")).toHaveTextContent("보고서 없음");
      expect(within(history).getByText("조종석 HUD 구현").closest(".agent-history-row")).not.toHaveTextContent("보고서 없음");
    });
  });

  it("keeps the mark when an earlier session already left a report on the same target", () => {
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({
        queue: queueOf([run("run-1", "succeeded", "TASK-2")]),
        runReports: { "run-1": [report] },
        runAudits: { "run-1": "silent" },
      }));

      const recent = screen.getByRole("region", { name: "최근 종료" });
      expect(within(recent).getByText("후속 작업").closest("button")).toHaveTextContent("보고서 없음");

      // 판정이 먼저다. 앞선 세션의 보고서가 목록에 남아 있어도 이번 실행의 보고서로 세지 않는다.
      const drawer = openDetail("후속 작업");
      expect(cardValue(drawer, "결과 보고서")).toHaveTextContent("이 실행은 결과 보고서를 남기지 않았습니다.");
      expect(within(drawer).queryByRole("button", { name: report.title })).not.toBeInTheDocument();
    });
  });

  it("leaves a run without a target and a cancelled run unmarked", () => {
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({
        queue: queueOf([
          { ...run("run-1", "succeeded", "TASK-2"), targetId: null },
          run("run-2", "cancelled", "TASK-1"),
        ]),
        runAudits: { "run-1": "not_applicable", "run-2": "not_applicable" },
      }));

      const recent = screen.getByRole("region", { name: "최근 종료" });
      expect(within(recent).queryByText("보고서 없음")).not.toBeInTheDocument();
    });
  });

  it("says the run left no report and that the reason behind it is unverified", () => {
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({
        queue: queueOf([run("run-1", "succeeded", "TASK-2")]),
        runAudits: { "run-1": "silent" },
      }));

      const drawer = openDetail("후속 작업");
      expect(cardValue(drawer, "결과 보고서")).toHaveTextContent("이 실행은 결과 보고서를 남기지 않았습니다.");
      expect(cardValue(drawer, "사유")).toHaveTextContent("끊긴 이유를 확인하지 못했습니다");
    });
  });

  it("shows a recorded reason in everyday language and never the raw code", () => {
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({
        queue: queueOf([{ ...run("run-1", "failed", "TASK-2"), reason: "model_unavailable" }]),
        runAudits: { "run-1": "silent" },
      }));

      const drawer = openDetail("후속 작업");
      expect(cardValue(drawer, "사유")).toHaveTextContent("선택한 모델을 현재 계정에서 사용할 수 없습니다");
      expect(drawer).not.toHaveTextContent("model_unavailable");
    });
  });

  it("adds no mark and says the check did not conclude when the verdict is unknown", () => {
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({
        queue: queueOf([run("run-1", "succeeded", "TASK-2")]),
        runAudits: { "run-1": "unknown" },
      }));

      const recent = screen.getByRole("region", { name: "최근 종료" });
      expect(within(recent).queryByText("보고서 없음")).not.toBeInTheDocument();

      const drawer = openDetail("후속 작업");
      expect(cardValue(drawer, "결과 보고서")).toHaveTextContent("결과 보고서가 있는지 확인하지 못했습니다.");
    });
  });
});

describe("AgentRuntimeView diagnostic export", () => {
  it("내보내기는 사용자가 저장이나 복사를 고른 때만 실행된다", () => {
    const runtimeActions = actions();
    withClock("2026-08-11T01:00:00Z", () => {
      renderView(state({ queue: queueOf([run("run-1", "succeeded", "TASK-2")]) }), runtimeActions);

      // 상세를 여는 것만으로는 아무것도 나가지 않는다.
      const drawer = openDetail("후속 작업");
      expect(runtimeActions.exportRunDiagnostics).not.toHaveBeenCalled();

      fireEvent.click(within(drawer).getByRole("button", { name: "진단 자료 저장" }));
      expect(runtimeActions.exportRunDiagnostics).toHaveBeenCalledWith("run-1", "save");

      fireEvent.click(within(drawer).getByRole("button", { name: "진단 자료 복사" }));
      expect(runtimeActions.exportRunDiagnostics).toHaveBeenLastCalledWith("run-1", "copy");
      // 외부로 보내거나 이슈를 만드는 자리는 없다.
      expect(within(drawer).queryByRole("button", { name: /업로드|공유|이슈|전송/ })).not.toBeInTheDocument();
    });
  });

  it("활성 실행과 종료된 실행 양쪽에서 저장과 복사를 고를 수 있다", () => {
    withClock("2026-08-11T00:01:00Z", () => {
      const view = renderView(state({
        queue: queueOf([run("run-1", "running", "TASK-2", runStart, null)]),
      }));
      const active = openDetail("후속 작업");
      expect(within(active).getByRole("button", { name: "진단 자료 저장" })).toBeEnabled();
      expect(within(active).getByRole("button", { name: "진단 자료 복사" })).toBeEnabled();

      view.rerender(<AgentRuntimeView actions={view.runtimeActions} project={project()} state={state({
        queue: queueOf([run("run-1", "failed", "TASK-2", runStart, "2026-08-11T00:00:30Z")]),
      })} />);
      const finished = screen.getByRole("complementary", { name: "에이전트 상세" });
      expect(within(finished).getByRole("button", { name: "진단 자료 저장" })).toBeEnabled();
      expect(within(finished).getByRole("button", { name: "진단 자료 복사" })).toBeEnabled();
    });
  });

  it("진행과 성공과 실패를 그 실행의 자리에만 보여 준다", () => {
    withClock("2026-08-11T01:00:00Z", () => {
      const queue = queueOf([run("run-1", "succeeded", "TASK-2")]);
      const view = renderView(state({
        queue,
        diagnosticExport: { runId: "run-1", mode: "save", status: "working", error: null },
      }));
      expect(openDetail("후속 작업")).toHaveTextContent("진단 자료를 모으는 중입니다.");

      view.rerender(<AgentRuntimeView actions={view.runtimeActions} project={project()} state={state({
        queue,
        diagnosticExport: { runId: "run-1", mode: "copy", status: "done", error: null },
      })} />);
      expect(screen.getByRole("complementary", { name: "에이전트 상세" }))
        .toHaveTextContent("진단 자료를 클립보드에 담았습니다.");

      view.rerender(<AgentRuntimeView actions={view.runtimeActions} project={project()} state={state({
        queue,
        diagnosticExport: { runId: "run-1", mode: "save", status: "failed", error: "저장할 권한이 없습니다" },
      })} />);
      expect(screen.getByRole("complementary", { name: "에이전트 상세" }))
        .toHaveTextContent("진단 자료를 내보내지 못했습니다 · 저장할 권한이 없습니다");

      // 다른 실행의 결과를 이 실행의 자리에 남기지 않는다.
      view.rerender(<AgentRuntimeView actions={view.runtimeActions} project={project()} state={state({
        queue,
        diagnosticExport: { runId: "run-9", mode: "save", status: "done", error: null },
      })} />);
      expect(screen.getByRole("complementary", { name: "에이전트 상세" }))
        .not.toHaveTextContent("진단 자료를");
    });
  });
});

/** 준비 안내 하나를 이름으로 집는다. 세 단계가 모두 끝나면 이 이름의 구역 자체가 없다. */
function setupGuide() {
  return screen.getByRole("region", { name: "에이전트 준비" });
}

/** 안내 안의 세 단계. 선언 순서가 그대로 배열 순서다. */
function setupStepRows() {
  return within(setupGuide()).getAllByRole("listitem");
}

describe("AgentRuntimeView 준비 안내", () => {
  function unregistered() {
    const runtime = inspection();
    runtime.status!.service = { ...service, registered: false, running: false };
    return runtime;
  }

  function needingConsent(overrides: Partial<AgentRuntimeState> = {}) {
    return state({ policy: policy({ consent: consent({ status: "required", noticeVersion: null, grantedAt: null }) }), ...overrides });
  }

  it("새 기기에서 연결·동의·켜기를 한 안내에 선언한 순서로 세운다", () => {
    renderView(needingConsent({ inspection: unregistered() }));

    const steps = setupStepRows();
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent("자동 배정 서비스 연결 필요");
    expect(steps[1]).toHaveTextContent("실행 권한 동의");
    expect(steps[2]).toHaveTextContent("자동 배정 켜기");
    // 아직 아무 단계도 끝나지 않았으므로 완료 표시가 하나도 없다.
    expect(within(setupGuide()).queryByText("완료")).not.toBeInTheDocument();
    // 연결은 지금 진행할 수 있고, 켜기는 앞 단계가 남아 있어 버튼 대신 사유가 선다.
    expect(within(steps[0]).getByRole("button", { name: "연결 계획" })).toBeInTheDocument();
    expect(within(steps[2]).queryByRole("button")).not.toBeInTheDocument();
    expect(steps[2]).toHaveTextContent("앞의 실행 환경 준비를 먼저 마쳐야 켤 수 있습니다");
  });

  it("자동 배정이 꺼져 있어도 동의 단계에서 동의를 기록하고 정책은 저장하지 않는다", async () => {
    const runtimeActions = actions();
    renderView(needingConsent(), runtimeActions);
    expect(screen.getByRole("checkbox", { name: "자동 배정 켜기" })).not.toBeChecked();

    fireEvent.click(within(setupStepRows()[1]).getByRole("button", { name: "고지 읽고 동의" }));
    const dialog = screen.getByRole("dialog", { name: "실행 권한 동의" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /실행 권한에 동의/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "동의하고 계속" }));

    await waitFor(() => expect(runtimeActions.grantConsent).toHaveBeenCalledWith(1));
    expect(runtimeActions.save).not.toHaveBeenCalled();
  });

  it("실행 환경이 정상이면 연결 단계를 완료로 표시하고 조치를 주지 않는다", () => {
    renderView(needingConsent());

    const connect = setupStepRows()[0];
    expect(connect).toHaveTextContent("실행 환경 정상");
    expect(connect).toHaveTextContent("완료");
    expect(within(connect).queryByRole("button")).not.toBeInTheDocument();
  });

  it("동의를 물어볼 수 없는 두 상태를 각각의 사유로 적고 완료로 다루지 않는다", () => {
    renderView(state({ policy: policy({ consent: consent({ status: "unsupported", noticeVersion: null, grantedAt: null }) }) }));
    const unsupported = setupStepRows()[1];
    expect(unsupported).toHaveTextContent("실행 환경이 실행 권한 동의를 지원하지 않습니다");
    expect(unsupported).not.toHaveTextContent("완료");
    expect(within(unsupported).queryByRole("button")).not.toBeInTheDocument();

    cleanup();
    renderView(state({ policy: policy({ consent: consent({ status: "unreadable", noticeVersion: null, grantedAt: null, detail: "런타임을 실행하지 못했습니다." }) }) }));
    const unreadable = setupStepRows()[1];
    expect(unreadable).toHaveTextContent("동의 상태를 확인하지 못했습니다");
    expect(unreadable).toHaveTextContent("런타임을 실행하지 못했습니다.");
    expect(unreadable).not.toHaveTextContent("실행 환경이 실행 권한 동의를 지원하지 않습니다");
    expect(unreadable).not.toHaveTextContent("완료");
    expect(within(unreadable).queryByRole("button")).not.toBeInTheDocument();
  });

  it("연결과 동의를 마치면 켜기 단계가 자동 배정 켜기 확인 창을 연다", () => {
    renderView();

    const steps = setupStepRows();
    expect(steps[0]).toHaveTextContent("완료");
    expect(steps[1]).toHaveTextContent("완료");
    fireEvent.click(within(steps[2]).getByRole("button", { name: "자동 배정 켜기" }));
    expect(screen.getByRole("dialog", { name: "자동 배정 켜기" })).toBeInTheDocument();
  });

  it("세 단계를 모두 마치면 안내가 사라지고 화면이 원래 구성으로 돌아간다", () => {
    const enabled = policy();
    enabled.policy = { ...enabled.policy, automationEnabled: true };
    renderView(state({ policy: enabled }));

    expect(screen.queryByRole("region", { name: "에이전트 준비" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "에이전트" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "자동 배정 켜기" })).toBeChecked();
    expect(screen.getByRole("heading", { name: "배정 대기" })).toBeInTheDocument();
  });

  it("외부 서비스를 쓰는 기기에서는 연결 단계가 고급 설정을 연다", () => {
    const foreign = inspection();
    foreign.status!.service = { ...service, label: "com.catze.dream-heartbeat", executable: "/legacy/dream-heartbeat", running: false };
    renderView(state({ inspection: foreign }));

    const connect = setupStepRows()[0];
    expect(connect).toHaveTextContent("자동 배정 서비스 전환 필요");
    fireEvent.click(within(connect).getByRole("button", { name: "전환 준비" }));
    expect(screen.getByRole("dialog", { name: "고급 설정" })).toBeInTheDocument();
  });
});

describe("AgentRuntimeView execution consent", () => {
  function runPlan() {
    return {
      planId: "plan-1", projectId: "prj_1", revision: "rev-1", expiresAt: "2026-08-13T16:00:00Z",
      deviceRemaining: 3, projectRemaining: 2, billingRouteRisk: false, limits: null,
      roles: [{ role: "developer", provider: "codex", executionMode: "once", requested: 1, granted: 1, excluded: [], manualTargets: ["TASK-1"], diagnostic: null }],
    };
  }

  function requiring(overrides: Partial<AgentRuntimeState> = {}) {
    return state({ policy: policy({ consent: consent({ status: "required", noticeVersion: null, grantedAt: null }) }), ...overrides });
  }

  it("puts the notice and an unticked confirmation before the first automation switch", () => {
    renderView(requiring());
    fireEvent.click(screen.getByRole("checkbox", { name: "자동 배정 켜기" }));
    const dialog = screen.getByRole("dialog", { name: "자동 배정 켜기" });

    for (const fact of EXECUTION_NOTICE_FACTS) expect(within(dialog).getByText(fact)).toBeInTheDocument();
    const agree = within(dialog).getByRole("checkbox", { name: /실행 권한에 동의/ });
    expect(agree).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "동의하고 자동 배정 켜기" })).toBeDisabled();
    fireEvent.click(agree);
    expect(within(dialog).getByRole("button", { name: "동의하고 자동 배정 켜기" })).toBeEnabled();
  });

  it("records neither the consent nor the policy when the notice is cancelled", () => {
    const runtimeActions = actions();
    renderView(requiring(), runtimeActions);
    fireEvent.click(screen.getByRole("checkbox", { name: "자동 배정 켜기" }));
    const dialog = screen.getByRole("dialog", { name: "자동 배정 켜기" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /실행 권한에 동의/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));

    expect(runtimeActions.grantConsent).not.toHaveBeenCalled();
    expect(runtimeActions.save).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "자동 배정 켜기" })).not.toBeInTheDocument();
  });

  it("records the consent before saving the policy, and stops when the consent fails", async () => {
    const runtimeActions = actions();
    renderView(requiring(), runtimeActions);
    fireEvent.click(screen.getByRole("checkbox", { name: "자동 배정 켜기" }));
    const dialog = screen.getByRole("dialog", { name: "자동 배정 켜기" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /실행 권한에 동의/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "동의하고 자동 배정 켜기" }));

    await waitFor(() => expect(runtimeActions.grantConsent).toHaveBeenCalledWith(1));
    await waitFor(() => expect(runtimeActions.save).toHaveBeenCalledWith(expect.objectContaining({ automationEnabled: true })));

    cleanup();
    const refused = actions({ grantConsent: vi.fn().mockResolvedValue(false) });
    renderView(requiring({ consentError: "요청을 처리하지 못했습니다: consent_notice_outdated" }), refused);
    fireEvent.click(screen.getByRole("checkbox", { name: "자동 배정 켜기" }));
    const second = screen.getByRole("dialog", { name: "자동 배정 켜기" });
    fireEvent.click(within(second).getByRole("checkbox", { name: /실행 권한에 동의/ }));
    fireEvent.click(within(second).getByRole("button", { name: "동의하고 자동 배정 켜기" }));

    await waitFor(() => expect(refused.grantConsent).toHaveBeenCalled());
    expect(refused.save).not.toHaveBeenCalled();
    expect(second).toHaveTextContent("앱을 업데이트한 뒤 다시 동의해 주세요");
  });

  it("leaves a project that already consented on the existing flow", () => {
    const runtimeActions = actions();
    renderView(state(), runtimeActions);
    fireEvent.click(screen.getByRole("checkbox", { name: "자동 배정 켜기" }));
    const dialog = screen.getByRole("dialog", { name: "자동 배정 켜기" });

    expect(within(dialog).queryByRole("checkbox", { name: /실행 권한에 동의/ })).not.toBeInTheDocument();
    // 참여 역할을 바꾸는 것은 동의를 다시 묻는 사유가 아니다.
    fireEvent.click(within(dialog).getAllByRole("checkbox")[0]);
    expect(within(dialog).queryByRole("checkbox", { name: /실행 권한에 동의/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "자동 배정 켜기" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "자동 배정 켜기" }));
    expect(runtimeActions.grantConsent).not.toHaveBeenCalled();

    // 실행 도구를 바꿔도 마찬가지다. 동의는 프로젝트 하나에 한 번이다.
    cleanup();
    const other = actions();
    renderView(state({ policy: policy({ providers: [{ provider: "claude", status: "ready", version: "2.0" }] }) }), other);
    fireEvent.click(screen.getByRole("button", { name: "직접 배정" }));
    expect(within(screen.getByRole("dialog", { name: "직접 배정" })).queryByRole("checkbox", { name: /실행 권한에 동의/ })).not.toBeInTheDocument();
  });

  it("never treats an unread consent as given, and separates the two unread cases", () => {
    renderView(state({ policy: policy({ consent: consent({ status: "unsupported", noticeVersion: null, grantedAt: null }) }) }));
    fireEvent.click(screen.getByRole("checkbox", { name: "자동 배정 켜기" }));
    const unsupported = screen.getByRole("dialog", { name: "자동 배정 켜기" });
    expect(unsupported).toHaveTextContent("실행 환경이 실행 권한 동의를 지원하지 않습니다");
    expect(within(unsupported).queryByRole("checkbox", { name: /실행 권한에 동의/ })).not.toBeInTheDocument();
    expect(within(unsupported).queryByRole("button", { name: /자동 배정 켜기$/ })).not.toBeInTheDocument();

    cleanup();
    renderView(state({ policy: policy({ consent: consent({ status: "unreadable", noticeVersion: null, grantedAt: null, detail: "런타임을 실행하지 못했습니다." }) }) }));
    fireEvent.click(screen.getByRole("checkbox", { name: "자동 배정 켜기" }));
    const unreadable = screen.getByRole("dialog", { name: "자동 배정 켜기" });
    expect(unreadable).toHaveTextContent("동의 상태를 확인하지 못했습니다");
    expect(unreadable).toHaveTextContent("런타임을 실행하지 못했습니다.");
    expect(unreadable).not.toHaveTextContent("실행 환경이 실행 권한 동의를 지원하지 않습니다");

    // 직접 배정도 같게 멈춘다. 확인도 시작도 열리지 않는다.
    fireEvent.click(within(unreadable).getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "직접 배정" }));
    const direct = screen.getByRole("dialog", { name: "직접 배정" });
    expect(direct).toHaveTextContent("동의 상태를 확인하지 못했습니다");
    expect(within(direct).queryByRole("button", { name: "시작 조건 확인" })).not.toBeInTheDocument();
    expect(within(direct).queryByRole("button", { name: /직접 배정 시작$/ })).not.toBeInTheDocument();
  });

  it("asks for the same consent when a direct assignment is confirmed", async () => {
    const runtimeActions = actions();
    renderView(requiring({ runPlan: runPlan() }), runtimeActions);
    fireEvent.click(screen.getByRole("button", { name: "직접 배정" }));
    const dialog = screen.getByRole("dialog", { name: "직접 배정" });

    for (const fact of EXECUTION_NOTICE_FACTS) expect(within(dialog).getByText(fact)).toBeInTheDocument();
    const start = within(dialog).getByRole("button", { name: "동의하고 직접 배정 시작" });
    expect(start).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(runtimeActions.startRun).not.toHaveBeenCalled();
    expect(runtimeActions.grantConsent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "직접 배정" }));
    const reopened = screen.getByRole("dialog", { name: "직접 배정" });
    fireEvent.click(within(reopened).getByRole("checkbox", { name: /실행 권한에 동의/ }));
    fireEvent.click(within(reopened).getByRole("button", { name: "동의하고 직접 배정 시작" }));
    await waitFor(() => expect(runtimeActions.grantConsent).toHaveBeenCalledWith(1));
    await waitFor(() => expect(runtimeActions.startRun).toHaveBeenCalled());
  });

  it("keeps the direct assignment open and offers the notice when the runtime waits for consent", () => {
    renderView(state({ runPlan: runPlan(), runError: "execution_consent_required" }));
    fireEvent.click(screen.getByRole("button", { name: "직접 배정" }));
    const dialog = screen.getByRole("dialog", { name: "직접 배정" });

    expect(dialog).toHaveTextContent("실행 권한 동의 필요");
    expect(within(dialog).getByRole("checkbox", { name: /실행 권한에 동의/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "동의하고 직접 배정 시작" })).toBeInTheDocument();
    // 설치 필요·로그인 필요·권한 부족과 다른 문구여야 사용자가 고칠 자리를 찾는다.
    expect(humanRuntimeMessage("execution_consent_required")).toBe("실행 권한 동의 필요");
    for (const other of ["executable_missing", "login_required", "permission_denied"]) {
      expect(humanRuntimeMessage(other)).not.toBe("실행 권한 동의 필요");
    }
  });

  it("shows the recorded consent in advanced settings and warns about running sessions before revoking", async () => {
    const runtimeActions = actions();
    renderView(state(), runtimeActions);
    fireEvent.click(screen.getByRole("button", { name: "고급 설정" }));
    const drawer = screen.getByRole("dialog", { name: "고급 설정" });

    expect(within(drawer).getByText("실행 권한 동의")).toBeInTheDocument();
    expect(drawer).toHaveTextContent("동의함");
    expect(drawer).toHaveTextContent("고지 버전");
    expect(within(drawer).getByText("고지 전문 다시 읽기")).toBeInTheDocument();
    for (const fact of EXECUTION_NOTICE_FACTS) expect(within(drawer).getByText(fact)).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: "동의 철회" }));
    const confirm = screen.getByRole("dialog", { name: "실행 권한 동의 철회" });
    expect(confirm).toHaveTextContent("이미 실행 중인 세션은 그대로 이어집니다");
    expect(confirm).toHaveTextContent("실행 취소");
    expect(confirm).toHaveTextContent("다시 동의해야 합니다");
    fireEvent.click(within(confirm).getByRole("button", { name: "동의 철회" }));
    await waitFor(() => expect(runtimeActions.revokeConsent).toHaveBeenCalled());
  });

  it("reopens the notice from advanced settings when the consent is missing, without saving a policy", async () => {
    const runtimeActions = actions();
    renderView(requiring(), runtimeActions);
    fireEvent.click(screen.getByRole("button", { name: "고급 설정" }));
    const drawer = screen.getByRole("dialog", { name: "고급 설정" });

    expect(drawer).toHaveTextContent("동의 필요");
    fireEvent.click(within(drawer).getByRole("button", { name: "고지 읽고 동의" }));
    const dialog = screen.getByRole("dialog", { name: "실행 권한 동의" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /실행 권한에 동의/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "동의하고 계속" }));

    await waitFor(() => expect(runtimeActions.grantConsent).toHaveBeenCalledWith(1));
    expect(runtimeActions.save).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "실행 권한 동의" })).not.toBeInTheDocument());
  });

  it("never stands the consent and the revoke buttons together in advanced settings", () => {
    renderView(state());
    fireEvent.click(screen.getByRole("button", { name: "고급 설정" }));
    let drawer = screen.getByRole("dialog", { name: "고급 설정" });
    expect(within(drawer).queryByRole("button", { name: "고지 읽고 동의" })).not.toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "동의 철회" })).toBeInTheDocument();

    // 동의를 물어볼 수 없는 두 상태는 동의도 철회도 받지 않는다. 상태 줄만 남는다.
    for (const [status, label] of [["unsupported", "실행 환경이 지원하지 않음"], ["unreadable", "확인하지 못함"]] as const) {
      cleanup();
      renderView(state({ policy: policy({ consent: consent({ status, noticeVersion: null, grantedAt: null }) }) }));
      fireEvent.click(screen.getByRole("button", { name: "고급 설정" }));
      drawer = screen.getByRole("dialog", { name: "고급 설정" });
      expect(drawer).toHaveTextContent(label);
      expect(within(drawer).queryByRole("button", { name: "고지 읽고 동의" })).not.toBeInTheDocument();
      expect(within(drawer).queryByRole("button", { name: "동의 철회" })).not.toBeInTheDocument();
    }
  });

  it("records consent without saving a policy when automation is already on", async () => {
    const runtimeActions = actions();
    const enabled = policy({ consent: consent({ status: "required", noticeVersion: null, grantedAt: null }) });
    enabled.policy = { ...enabled.policy, automationEnabled: true };
    renderView(state({ policy: enabled }), runtimeActions);

    // 동의 입구는 준비 안내의 동의 단계로 옮겼다. 자동 배정이 이미 켜져 있어도 그 자리에 선다.
    expect(within(setupGuide()).getByText("실행 권한 동의")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "고지 읽고 동의" }));
    const dialog = screen.getByRole("dialog", { name: "실행 권한 동의" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /실행 권한에 동의/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "동의하고 계속" }));

    await waitFor(() => expect(runtimeActions.grantConsent).toHaveBeenCalledWith(1));
    expect(runtimeActions.save).not.toHaveBeenCalled();
  });

  it("keeps the paid-session warning and the billing route notice next to the consent gate", () => {
    renderView(requiring());
    fireEvent.click(screen.getByRole("checkbox", { name: "자동 배정 켜기" }));
    expect(screen.getByRole("dialog", { name: "자동 배정 켜기" })).toHaveTextContent("여러 유료 세션이 동시에 실행될 수 있습니다");

    cleanup();
    renderView(state({ policy: policy({ providers: [{ provider: "codex", status: "billing_route_acknowledgement_required", version: "1.0" }] }) }));
    fireEvent.click(screen.getByRole("button", { name: "고급 설정" }));
    expect(screen.getByRole("dialog", { name: "고급 설정" })).toHaveTextContent("과금 경로 확인 필요");
  });
});

describe("앱 밖 세션 표시", () => {
  const lease = (id: string, agent: string, role: string | null, taskId: string | null, heartbeatAt = "2126-01-01T00:00:00Z") => ({
    leaseId: id, agent, role, taskId, heartbeatAt, expiresAt: "2126-01-02T00:00:00Z",
  });

  it("앱 실행이 잡지 않은 선점만 보여 주고, 정상은 행·신호 지연은 카드로 가른다", () => {
    const withLeases = {
      ...project(),
      activeLeases: [
        lease("lease-run", "app-developer", "developer", "TASK-1"),
        lease("lease-ext", "terminal-claude", "planner", "TASK-2"),
        lease("lease-stale", "stale-codex", "developer", "TASK-QA", "2020-01-01T00:00:00Z"),
      ],
    };
    render(
      <AgentRuntimeView
        actions={actions()}
        project={withLeases}
        state={state({ queue: { projectId: "prj_1", paused: false, runs: [run("run-1", "running", "TASK-1", "2026-08-11T00:00:00Z", null)], errors: [], providers: [], unavailable: null } })}
      />,
    );

    const section = screen.getByRole("region", { name: "앱 밖 세션" });
    // 앱 실행이 잡은 TASK-1 선점은 진행 중 목록이 말하므로 여기 없다.
    expect(within(section).queryByText(/app-developer/)).not.toBeInTheDocument();

    // 정상 세션은 조용한 행으로 서고, 역할·ID는 구분 문자 없이 UI 요소로 나뉜다.
    const row = within(section).getByText("terminal-claude").closest("li");
    expect(row).toHaveClass("worker-row");
    expect(within(row as HTMLElement).getByText("기획자")).toHaveClass("agent-role-chip");
    expect(within(row as HTMLElement).getByText("후속 작업")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("TASK-2")).toBeInTheDocument();
    expect(row?.textContent).not.toContain("·");

    // 신호가 끊긴 세션만 카드로 승격되고, 지연은 경고 칩이 말한다.
    const card = within(section).getByText("stale-codex").closest("li");
    expect(card).toHaveClass("worker-card");
    expect(within(card as HTMLElement).getByText("신호 지연")).toHaveClass("worker-alert");

    // 역할 집계는 텍스트 나열이 아니라 칩 묶음이다.
    const summary = section.querySelector(".worker-role-summary");
    expect(summary).toHaveTextContent("개발자1");
    expect(summary).toHaveTextContent("기획자1");
    expect(summary?.textContent).not.toContain("·");
  });

  it("정상 세션이 여덟을 넘으면 접고 전체 보기로 편다", () => {
    const many = Array.from({ length: 11 }, (_, index) => lease(`lease-${index}`, `agent-${index}`, "developer", null));
    render(<AgentRuntimeView actions={actions()} project={{ ...project(), activeLeases: many }} state={state()} />);

    const section = screen.getByRole("region", { name: "앱 밖 세션" });
    expect(within(section).getAllByRole("listitem")).toHaveLength(8);
    fireEvent.click(within(section).getByRole("button", { name: "정상 세션 3개 더 보기" }));
    expect(within(section).getAllByRole("listitem")).toHaveLength(11);
    fireEvent.click(within(section).getByRole("button", { name: "접기" }));
    expect(within(section).getAllByRole("listitem")).toHaveLength(8);
  });

  const withRuns = (...runs: AgentRunSummary[]) =>
    state({ queue: { projectId: "prj_1", paused: false, runs, errors: [], providers: [], unavailable: null } });

  it("역할이 없는 선점을 같은 대상을 맡은 실행의 역할로 채운다", () => {
    const withLeases = {
      ...project(),
      activeLeases: [
        lease("lease-blank", "runtime-planner", null, "TASK-2"),
        lease("lease-known", "terminal-claude", "developer", "TASK-QA"),
      ],
    };
    render(
      <AgentRuntimeView
        actions={actions()}
        project={withLeases}
        state={withRuns({ ...run("run-1", "succeeded", "TASK-2"), role: "planner" })}
      />,
    );

    const section = screen.getByRole("region", { name: "앱 밖 세션" });
    const row = within(section).getByText("runtime-planner").closest("li");
    const chip = within(row as HTMLElement).getByText("기획자");
    expect(chip).toHaveClass("agent-role-chip");
    // 채운 역할도 아는 역할이므로 그 역할의 색 칩으로 그려진다.
    expect(chip).toHaveClass("role-planner");
    expect(section.querySelector(".worker-role-summary")).toHaveTextContent("기획자1");
  });

  it("실행이 활성 상태를 벗어나도 같은 세션의 역할 표시가 그대로다", () => {
    const withLeases = { ...project(), activeLeases: [lease("lease-blank", "runtime-architect", null, "TASK-2")] };
    const started = { ...run("run-1", "running", "TASK-2", "2026-08-11T00:00:00Z", null), role: "architect" };

    // 실행이 진행 중인 동안에는 같은 세션이 진행 중 목록에서 아키텍트로 보인다.
    render(<AgentRuntimeView actions={actions()} project={withLeases} state={withRuns(started)} />);
    expect(within(screen.getByRole("region", { name: "진행 중" })).getByText(/아키텍트/)).toBeInTheDocument();
    cleanup();

    // 실행이 끝나면 같은 선점이 앱 밖 세션 목록으로 옮겨 가지만 역할 표시는 바뀌지 않는다.
    render(
      <AgentRuntimeView
        actions={actions()}
        project={withLeases}
        state={withRuns({ ...started, state: "succeeded", finishedAt: "2026-08-11T00:00:09Z" })}
      />,
    );
    const section = screen.getByRole("region", { name: "앱 밖 세션" });
    const row = within(section).getByText("runtime-architect").closest("li");
    expect(within(row as HTMLElement).getByText("아키텍트")).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText("미기재")).not.toBeInTheDocument();
  });

  it("채울 실행이 없는 선점은 미기재로 남는다", () => {
    const withLeases = {
      ...project(),
      activeLeases: [
        lease("lease-blank", "terminal-claude", null, "TASK-2"),
        lease("lease-none", "terminal-codex", null, null),
      ],
    };
    render(<AgentRuntimeView actions={actions()} project={withLeases} state={withRuns(run("run-1", "succeeded", "TASK-QA"))} />);

    const section = screen.getByRole("region", { name: "앱 밖 세션" });
    const row = within(section).getByText("terminal-claude").closest("li");
    expect(within(row as HTMLElement).getByText("미기재")).toBeInTheDocument();
    expect(section.querySelector(".worker-role-summary")).toHaveTextContent("역할 미기재2");
  });

  it("선점 기록에 역할이 있으면 실행 정보의 역할과 달라도 선점 기록을 따른다", () => {
    const withLeases = { ...project(), activeLeases: [lease("lease-known", "terminal-claude", "developer", "TASK-2")] };
    render(
      <AgentRuntimeView
        actions={actions()}
        project={withLeases}
        state={withRuns({ ...run("run-1", "succeeded", "TASK-2"), role: "planner" })}
      />,
    );

    const row = within(screen.getByRole("region", { name: "앱 밖 세션" })).getByText("terminal-claude").closest("li");
    expect(within(row as HTMLElement).getByText("개발자")).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText("기획자")).not.toBeInTheDocument();
  });

  it("같은 대상을 가리키는 실행이 여럿이면 가장 최근에 시작한 실행의 역할을 쓴다", () => {
    const withLeases = { ...project(), activeLeases: [lease("lease-blank", "runtime-session", null, "TASK-2")] };
    render(
      <AgentRuntimeView
        actions={actions()}
        project={withLeases}
        state={withRuns(
          { ...run("run-late", "succeeded", "TASK-2", "2026-08-11T02:00:00Z"), role: "architect" },
          { ...run("run-early", "succeeded", "TASK-2", "2026-08-11T01:00:00Z"), role: "planner" },
          // 시작 시각이 없는 실행은 가장 오래된 것으로 다루므로 근거가 되지 못한다.
          { ...run("run-unstarted", "cancelled", "TASK-2"), role: "developer", startedAt: null, finishedAt: null },
        )}
      />,
    );

    const row = within(screen.getByRole("region", { name: "앱 밖 세션" })).getByText("runtime-session").closest("li");
    expect(within(row as HTMLElement).getByText("아키텍트")).toBeInTheDocument();
  });

  it("역할이 없는 선점 여럿이 각자의 실행으로 채워져 역할별로 나뉜다", () => {
    const withLeases = {
      ...project(),
      activeLeases: [
        lease("lease-1", "runtime-planner", null, "SPEC-1"),
        lease("lease-2", "runtime-architect", null, "TASK-1"),
        lease("lease-3", "runtime-developer", null, "TASK-2"),
      ],
    };
    render(
      <AgentRuntimeView
        actions={actions()}
        project={withLeases}
        state={withRuns(
          { ...run("run-1", "succeeded", "SPEC-1"), role: "planner" },
          { ...run("run-2", "succeeded", "TASK-1"), role: "architect" },
          { ...run("run-3", "succeeded", "TASK-2"), role: "developer" },
        )}
      />,
    );

    const summary = screen.getByRole("region", { name: "앱 밖 세션" }).querySelector(".worker-role-summary");
    expect(summary).toHaveTextContent("기획자1");
    expect(summary).toHaveTextContent("아키텍트1");
    expect(summary).toHaveTextContent("개발자1");
    expect(summary?.textContent).not.toContain("역할 미기재");
  });

});

describe("AgentRuntimeView 실행 환경 적용 결과", () => {
  const installPlan = {
    planId: "plan-1", bundledVersion: "0.9.0", target: "macos-universal",
    versionDirectory: "/runtime/versions/0.9.0", launcher: "/runtime/bin/heartbeat",
    alreadyInstalled: false, installedVersion: "0.8.3", serviceTransitionRequired: true,
    service, serviceAction: "register" as const,
  };

  function stage(name: string, status: string, detail: string | null = null): AgentStageResult {
    return { stage: name, status, detail };
  }

  function application(stages: AgentStageResult[], result: string, detail: string | null = null): AgentRuntimeApplication {
    return {
      kind: "install",
      result: { planId: "plan-1", result, installedVersion: "0.9.0", versionDirectory: "/runtime/versions/0.9.0", stages, detail },
    };
  }

  function unregistered() {
    const runtime = inspection();
    runtime.status!.service = { ...service, registered: false };
    return runtime;
  }

  // 결과 화면은 저절로 열리지 않으므로, 검사도 사용자와 같은 입구로만 연다.
  function openFromDrawer(current: AgentRuntimeState) {
    renderView(current);
    fireEvent.click(screen.getByRole("button", { name: "고급 설정" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "고급 설정" })).getByRole("button", { name: "마지막 적용 결과 보기" }));
    return screen.getByRole("dialog", { name: "실행 환경 적용 결과" });
  }

  it("적용을 마치면 확인 창이 단계별 결과 화면으로 바뀐다", async () => {
    renderView(state({
      plan: { kind: "install", plan: installPlan },
      application: application(
        [stage("version_install", "ok"), stage("launcher_switch", "ok"), stage("service_transition", "failed", "service_register_failed")],
        "partial_success",
      ),
    }));

    fireEvent.click(within(screen.getByRole("dialog", { name: "실행 환경 변경 확인" })).getByRole("button", { name: "적용" }));

    const dialog = await screen.findByRole("dialog", { name: "실행 환경 적용 결과" });
    const rows = within(dialog).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("버전 설치");
    expect(rows[0]).toHaveTextContent("완료");
    expect(rows[1]).toHaveTextContent("실행기 전환");
    expect(rows[1]).toHaveTextContent("완료");
    expect(rows[2]).toHaveTextContent("서비스 연결");
    expect(rows[2]).toHaveTextContent("실패");
    expect(dialog).toHaveTextContent("일부 단계가 실패했습니다");
  });

  it("적용이 예외로 실패하면 결과 화면을 열지 않는다", async () => {
    const runtimeActions = actions({ apply: vi.fn().mockResolvedValue(false) });
    renderView(state({ plan: { kind: "install", plan: installPlan }, applyError: "service_register_failed" }), runtimeActions);

    fireEvent.click(within(screen.getByRole("dialog", { name: "실행 환경 변경 확인" })).getByRole("button", { name: "적용" }));

    await waitFor(() => expect(runtimeActions.apply).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "실행 환경 적용 결과" })).not.toBeInTheDocument();
  });

  it("실패한 단계의 사유를 사용자 언어로 옮겨 보여준다", () => {
    const reason = 'provider error: {"code":"service_register_failed"}';
    const dialog = openFromDrawer(state({ application: application([stage("service_transition", "failed", reason)], "failed") }));

    expect(dialog).toHaveTextContent(humanRuntimeMessage(reason));
    expect(within(dialog).queryByText(/provider error|\{"code"/)).not.toBeInTheDocument();
  });

  it("사유가 실려 오지 않은 실패 단계에도 사유를 확인하지 못했다고 적는다", () => {
    const dialog = openFromDrawer(state({ application: application([stage("launcher_switch", "failed")], "failed") }));

    expect(dialog).toHaveTextContent("사유를 확인하지 못했습니다.");
  });

  it("모두 완료한 적용은 성공으로 알리고 실패 문구를 만들지 않는다", () => {
    const dialog = openFromDrawer(state({
      application: application(
        [stage("version_install", "ok"), stage("launcher_switch", "ok"), stage("service_transition", "ok")],
        "success",
      ),
    }));

    expect(dialog).toHaveTextContent("적용한 단계를 모두 마쳤습니다.");
    expect(dialog).not.toHaveTextContent("실패");
    expect(dialog).not.toHaveTextContent("남았습니다");
  });

  it("적용 뒤에도 남은 실행 환경 상태와 그 상태를 만든 단계를 한 문장으로 알린다", () => {
    const dialog = openFromDrawer(state({
      inspection: unregistered(),
      application: application(
        [stage("version_install", "ok"), stage("service_transition", "failed", "service_register_failed")],
        "partial_success",
      ),
    }));

    expect(dialog).toHaveTextContent("서비스 연결 단계가 실패해 실행 환경이 아직 자동 배정 서비스 연결 필요 상태로 남았습니다.");
  });

  it("고급 설정의 실행 환경 자리에서 마지막 적용 결과를 다시 연다", () => {
    const dialog = openFromDrawer(state({
      application: application([stage("service_transition", "failed", "service_register_failed")], "failed", "설치본은 놓였지만 남은 단계가 있습니다"),
    }));

    expect(dialog).toHaveTextContent("설치본은 놓였지만 남은 단계가 있습니다");
    expect(dialog).toHaveTextContent("서비스 연결");
    expect(dialog).toHaveTextContent(humanRuntimeMessage("service_register_failed"));
  });

  it("마지막 적용 결과가 없으면 다시 열기 입구를 만들지 않는다", () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "고급 설정" }));

    expect(within(screen.getByRole("dialog", { name: "고급 설정" })).queryByRole("button", { name: "마지막 적용 결과 보기" })).not.toBeInTheDocument();
  });

  it("화면을 처음 그린 것만으로는 결과 화면이 열리지 않는다", () => {
    renderView(state({ application: application([stage("version_install", "ok")], "success") }));

    expect(screen.queryByRole("dialog", { name: "실행 환경 적용 결과" })).not.toBeInTheDocument();
  });
});
