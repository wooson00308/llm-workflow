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
import { humanRuntimeMessage } from "./AgentRunDashboard";
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
    logWatchRunId: null, runReports: {}, reportView: null, diagnosticExport: null,
    ...overrides,
  };
}

function actions(overrides: Partial<AgentRuntimeActions> = {}): AgentRuntimeActions {
  return {
    refresh: vi.fn().mockResolvedValue(undefined), setViewActive: vi.fn(), plan: vi.fn().mockResolvedValue(undefined), cancelPlan: vi.fn(), apply: vi.fn().mockResolvedValue(true),
    previewMigration: vi.fn().mockResolvedValue(undefined), applyMigration: vi.fn().mockResolvedValue(true), dismissMigration: vi.fn(), save: vi.fn().mockResolvedValue(true),
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
      }));

      const drawer = openDetail("후속 작업");
      expect(within(drawer).queryByText("결과 보고서")).not.toBeInTheDocument();
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
