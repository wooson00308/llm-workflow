import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentInstallPlan,
  AgentPolicySnapshot,
  AgentProviderDiagnosis,
  AgentQueueSnapshot,
  AgentRolePolicy,
  AgentRunPlan,
  AgentRuntimeActions,
  AgentRuntimeInspection,
  AgentRuntimeState,
  AgentUpdatePlan,
} from "../../domain/types";
import { AgentRuntimeView } from "./AgentRuntimeView";

afterEach(cleanup);

const service = {
  platform: "launchd",
  result: "registered",
  registered: true,
  running: true,
  label: "com.claude-heartbeat",
  executable: "/opt/runtime/bin/heartbeat",
  recoverable: true,
  checkedAt: "2026-08-08T09:00:00Z",
  evidence: ["launch_agents_directory"],
};

function inspection(overrides: Partial<AgentRuntimeInspection> = {}): AgentRuntimeInspection {
  return {
    bundledVersion: "0.9.0",
    status: {
      result: "ok",
      checkedAt: "2026-08-08T09:00:00Z",
      runtimeVersion: "0.8.0",
      installedVersion: "0.8.0",
      runningVersion: "0.8.0",
      apiMajor: 1,
      target: "macos-universal",
      installResult: "installed",
      recoverable: true,
      service,
    },
    compatibility: { kind: "compatible" },
    executionAllowed: true,
    unavailable: null,
    installRoot: "/runtime",
    ...overrides,
  };
}

function role(overrides: Partial<AgentRolePolicy> = {}): AgentRolePolicy {
  return {
    enabled: true,
    provider: "claude",
    model: null,
    runMode: "continuous",
    maxParallel: 1,
    intervalSeconds: 300,
    maxPer: null,
    ...overrides,
  };
}

function policy(
  providers: AgentProviderDiagnosis[] = [{ provider: "claude", status: "ready", version: "1.2.3" }],
  overrides: Partial<AgentPolicySnapshot> = {},
): AgentPolicySnapshot {
  return {
    policy: {
      projectId: "prj_1",
      workingDirectory: "/projects/workflow-labs",
      projectMaxParallel: 3,
      deviceMaxParallel: 16,
      roles: { architect: role(), developer: role(), planner: role() },
    },
    stored: true,
    revision: "rev-1",
    providers,
    executionAllowed: true,
    compatibility: { kind: "compatible" },
    ...overrides,
  };
}

function state(overrides: Partial<AgentRuntimeState> = {}): AgentRuntimeState {
  return {
    inspection: inspection(),
    policy: policy(),
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
    runPlan: null,
    runRequests: [],
    runPlanning: false,
    runStarting: false,
    runError: null,
    queue: null,
    queueReading: false,
    queueError: null,
    pausing: false,
    cancelPreview: null,
    cancelResult: null,
    retryPreview: null,
    controllingRunId: null,
    controlError: null,
    logs: {},
    readingLogRunId: null,
    logError: null,
    ...overrides,
  };
}

function actionsStub(overrides: Partial<AgentRuntimeActions> = {}): AgentRuntimeActions {
  return {
    refresh: vi.fn().mockResolvedValue(undefined),
    plan: vi.fn().mockResolvedValue(undefined),
    cancelPlan: vi.fn(),
    apply: vi.fn().mockResolvedValue(true),
    previewMigration: vi.fn().mockResolvedValue(undefined),
    applyMigration: vi.fn().mockResolvedValue(true),
    dismissMigration: vi.fn(),
    save: vi.fn().mockResolvedValue(true),
    planRun: vi.fn().mockResolvedValue(undefined),
    cancelRunPlan: vi.fn(),
    startRun: vi.fn().mockResolvedValue(true),
    refreshRuns: vi.fn().mockResolvedValue(undefined),
    setProjectPaused: vi.fn().mockResolvedValue(true),
    previewCancel: vi.fn().mockResolvedValue(undefined),
    dismissCancel: vi.fn(),
    confirmCancel: vi.fn().mockResolvedValue(true),
    previewRetry: vi.fn(),
    dismissRetry: vi.fn(),
    confirmRetry: vi.fn().mockResolvedValue(true),
    readRunLog: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderView(
  current: AgentRuntimeState = state(),
  actions: AgentRuntimeActions = actionsStub(),
) {
  const view = render(
    <AgentRuntimeView actions={actions} projectName="workflow-labs" state={current} />,
  );
  return { ...view, actions };
}

const updatePlan: AgentUpdatePlan = {
  planId: "plan-update-1",
  result: "ready",
  targetVersion: "0.9.0",
  target: "macos-universal",
  manifestVerified: true,
  launcherSwitchRequired: true,
  serviceTransitionRequired: true,
  recoverableOnFailure: true,
  installedVersion: "0.8.0",
  runningVersion: "0.8.0",
  activeRuns: 2,
  projects: ["workflow-labs", "other"],
  service,
};

const installPlan: AgentInstallPlan = {
  planId: "plan-install-1",
  bundledVersion: "0.9.0",
  target: "macos-universal",
  versionDirectory: "/runtime/versions/0.9.0",
  launcher: "/runtime/bin/heartbeat",
  alreadyInstalled: false,
  installedVersion: null,
  serviceTransitionRequired: true,
  service: {
    ...service,
    running: false,
    label: "com.catze.dream-heartbeat",
    executable: "/Users/tester/.pyenv/bin/dream-heartbeat",
  },
  serviceAction: "migration_required",
};

const runPlan: AgentRunPlan = {
  planId: "run-plan-1",
  projectId: "prj_1",
  revision: "queue-rev-1",
  expiresAt: "2026-08-08T10:00:00Z",
  deviceRemaining: 4,
  projectRemaining: 5,
  billingRouteRisk: false,
  limits: { device: 16, project: 5 },
  roles: [
    {
      role: "developer",
      provider: "codex",
      executionMode: "once",
      requested: 3,
      granted: 2,
      excluded: ["활성 lease: TASK-S051-03"],
      manualTargets: ["TASK-S051-01", "TASK-S051-02"],
      diagnostic: {},
    },
  ],
};

const queue: AgentQueueSnapshot = {
  projectId: "prj_1",
  paused: false,
  errors: [],
  providers: [],
  unavailable: null,
  runs: [
    {
      runId: "run-running",
      projectId: "prj_1",
      role: "developer",
      provider: "codex",
      state: "running",
      targetId: "TASK-S051-01",
      startedAt: "2026-08-08T09:00:00Z",
      failureStage: null,
      reason: null,
      remaining: [],
      previousRunId: null,
    },
    {
      runId: "run-failed",
      projectId: "prj_1",
      role: "developer",
      provider: "codex",
      state: "failed",
      targetId: "TASK-S051-02",
      startedAt: "2026-08-08T08:00:00Z",
      failureStage: "provider_start",
      reason: "auth_required",
      remaining: [],
      previousRunId: null,
    },
  ],
};

describe("AgentRuntimeView 준비 상태", () => {
  it("정상 상태에서는 내부 하트비트 이름을 주 제목으로 쓰지 않는다", () => {
    renderView();

    expect(screen.getByRole("heading", { level: 1, name: "에이전트" })).toBeInTheDocument();
    expect(screen.getByText("실행 환경이 준비됐습니다")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "업데이트 계획 보기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "상태 다시 확인" })).not.toBeInTheDocument();
  });

  // 여섯 상태가 각각 다른 문구와 다음 행동을 갖는다(완료 조건 8).
  it.each([
    ["미설치", inspection({ status: null }), "실행 환경이 설치돼 있지 않습니다", "설치 계획 보기"],
    [
      "실행 버전 불일치",
      inspection({
        compatibility: { kind: "restartRequired", installed: "0.9.0", running: "0.8.0" },
      }),
      "설치된 버전과 도는 버전이 다릅니다",
      "복구 계획 보기",
    ],
    [
      "계약 불일치",
      inspection({ compatibility: { kind: "unsupportedApiMajor", found: 2, supported: 1 } }),
      "이 앱과 통하지 않는 런타임입니다",
      "업데이트 계획 보기",
    ],
    [
      "범위 밖 버전",
      inspection({
        compatibility: { kind: "versionOutOfRange", found: "0.1.0", minimum: "0.5.0", maximum: "1.0.0" },
      }),
      "지원 범위 밖 버전입니다",
      "업데이트 계획 보기",
    ],
    [
      "판정 불가",
      inspection({ compatibility: { kind: "undetermined", reason: "launcher_missing" } }),
      "호환 여부를 확인하지 못했습니다",
      "복구 계획 보기",
    ],
    [
      "런타임 호출 실패",
      inspection({ unavailable: "launcher_missing" }),
      "실행 환경을 확인하지 못했습니다",
      "설치 계획 보기",
    ],
  ])("%s 상태를 고유한 문구와 행동으로 보여준다", (_label, value, title, action) => {
    renderView(state({ inspection: value }));

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
  });

  // 런타임 계약의 여섯 진단 값이 각각 다른 문장과 다음 행동을 갖는다.
  it.each([
    ["ready", "실행 준비됨"],
    ["executable_missing", "CLI가 설치돼 있지 않음"],
    ["login_required", "로그인이 필요함"],
    ["permission_denied", "실행 권한이 없음"],
    ["unsupported_version", "지원하지 않는 버전"],
    ["billing_route_acknowledgement_required", "API 과금 경로 확인이 필요함"],
  ])("실행 도구 진단 %s를 고유한 문장으로 보여준다", (status, title) => {
    renderView(state({ policy: policy([{ provider: "claude", status, version: null }]) }));

    const providers = screen.getByRole("region", { name: "실행 도구 준비 상태" });
    expect(within(providers).getByText(title)).toBeInTheDocument();
  });

  it("모르는 진단 값은 숨기지 않고 그대로 보여준다", () => {
    renderView(state({ policy: policy([{ provider: "codex", status: "brand_new_word", version: null }]) }));

    expect(screen.getByText("brand_new_word")).toBeInTheDocument();
    expect(screen.getByText("앱이 모르는 상태입니다. 값을 그대로 보여드립니다.")).toBeInTheDocument();
  });

  it("로그인 안내에서 토큰 입력칸을 만들지 않는다", () => {
    renderView(state({ policy: policy([{ provider: "claude", status: "login_required", version: null }]) }));

    const providers = screen.getByRole("region", { name: "실행 도구 준비 상태" });
    expect(within(providers).queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("AgentRuntimeView 계획과 적용", () => {
  it("계획이 없으면 적용 버튼이 없다", () => {
    renderView();

    expect(screen.queryByRole("button", { name: "이 계획을 적용" })).not.toBeInTheDocument();
  });

  it("실행 중 작업이 있는 업데이트 계획은 영향을 먼저 보여준다", () => {
    renderView(state({ plan: { kind: "update", plan: updatePlan } }));

    const plan = screen.getByRole("region", { name: "확인 대기 중인 계획" });
    expect(within(plan).getByText(/2건/)).toBeInTheDocument();
    expect(within(plan).getByText(/그 세션이 끊길 수 있습니다/)).toBeInTheDocument();
    expect(within(plan).getByText(/workflow-labs, other/)).toBeInTheDocument();
    expect(within(plan).getByRole("button", { name: "이 계획을 적용" })).toBeInTheDocument();
  });

  it("다른 기존 서비스는 적용 전에 신원과 보존 방법을 보여준다", () => {
    const { actions } = renderView(state({ plan: { kind: "install", plan: installPlan } }));

    const plan = screen.getByRole("region", { name: "확인 대기 중인 계획" });
    expect(within(plan).getByText("기존 서비스 이전 필요")).toBeInTheDocument();
    expect(
      within(plan).getByText(
        "com.catze.dream-heartbeat · /Users/tester/.pyenv/bin/dream-heartbeat",
      ),
    ).toBeInTheDocument();
    expect(within(plan).getByText(/삭제·중지·덮어쓰기·중복 등록하지 않습니다/)).toBeInTheDocument();
    expect(within(plan).getByText(/‘기존 역할 잡 이전’에서 이전 미리보기/)).toBeInTheDocument();
    expect(actions.apply).not.toHaveBeenCalled();
  });

  it("확인 불가 서비스는 변경하지 않고 새 계획이 필요하다고 알린다", () => {
    renderView(
      state({
        plan: {
          kind: "install",
          plan: { ...installPlan, service: null, serviceAction: "unknown" },
        },
      }),
    );

    const plan = screen.getByRole("region", { name: "확인 대기 중인 계획" });
    expect(within(plan).getByText("서비스 상태 확인 필요")).toBeInTheDocument();
    expect(within(plan).getByText("확인 불가 · 확인 불가")).toBeInTheDocument();
    expect(within(plan).getByText(/서비스는 변경하지 않습니다/)).toBeInTheDocument();
    expect(within(plan).getByText(/다시 읽은 뒤 새 계획/)).toBeInTheDocument();
  });

  it("미등록 상태는 새 서비스를 한 번 등록한다고 구분한다", () => {
    renderView(
      state({
        plan: {
          kind: "install",
          plan: {
            ...installPlan,
            service: { ...service, registered: false, running: false, label: "", executable: "" },
            serviceAction: "register",
          },
        },
      }),
    );

    const plan = screen.getByRole("region", { name: "확인 대기 중인 계획" });
    expect(within(plan).getByText("새 서비스 등록")).toBeInTheDocument();
    expect(within(plan).getByText("등록된 서비스 없음")).toBeInTheDocument();
    expect(within(plan).getByText(/새 서비스를 한 번 등록합니다/)).toBeInTheDocument();
  });

  it("적용은 사용자가 누를 때만 불린다", async () => {
    const { actions } = renderView(state({ plan: { kind: "update", plan: updatePlan } }));

    expect(actions.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "이 계획을 적용" }));
    await waitFor(() => expect(actions.apply).toHaveBeenCalledTimes(1));
  });

  it("화면에 들어오는 것만으로는 어떤 조작도 시작되지 않는다", () => {
    const { actions } = renderView();

    expect(actions.plan).not.toHaveBeenCalled();
    expect(actions.apply).not.toHaveBeenCalled();
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.previewMigration).not.toHaveBeenCalled();
    expect(actions.applyMigration).not.toHaveBeenCalled();
    expect(actions.refresh).not.toHaveBeenCalled();
  });

  it("조회 결과가 없을 때만 상태 다시 확인을 보이고 조회만 부른다", async () => {
    const { actions } = renderView(state({ inspection: null, readError: "상태를 읽지 못했습니다" }));

    fireEvent.click(screen.getByRole("button", { name: "상태 다시 확인" }));

    await waitFor(() => expect(actions.refresh).toHaveBeenCalledTimes(1));
    expect(actions.plan).not.toHaveBeenCalled();
    expect(actions.save).not.toHaveBeenCalled();
  });
});

describe("AgentRuntimeView 마이그레이션", () => {
  it("미리보기 전에는 적용 버튼이 없고 확인해야 적용된다", async () => {
    const { rerender, actions } = renderView();
    expect(screen.queryByRole("button", { name: "이 내용으로 이전" })).not.toBeInTheDocument();

    rerender(
      <AgentRuntimeView
        actions={actions}
        projectName="workflow-labs"
        state={state({
          migration: {
            previewId: "preview-1",
            proposed: policy().policy,
            unresolved: [
              { role: "planner", field: "model", value: "opus-legacy", reason: "unknown_model" },
            ],
            untouchedRoles: ["developer"],
          },
        })}
      />,
    );

    expect(screen.getByText("확인 전에는 아무것도 저장되지 않습니다")).toBeInTheDocument();
    expect(screen.getByText(/opus-legacy/)).toBeInTheDocument();
    expect(screen.getByText(/기존 잡이 없어 기본값으로 두는 역할: developer/)).toBeInTheDocument();
    expect(actions.applyMigration).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "이 내용으로 이전" }));
    await waitFor(() => expect(actions.applyMigration).toHaveBeenCalledTimes(1));
  });
});

describe("AgentRuntimeView 역할 정책", () => {
  it("세 역할을 고정 순서로 보여주고 초기값이 계약의 기본값이다", () => {
    const { container } = renderView();

    const cards = Array.from(container.querySelectorAll<HTMLElement>(".agent-role-card"));
    expect(cards.map((card) => card.querySelector("h4")?.textContent)).toEqual([
      "기획자",
      "아키텍트",
      "개발자",
    ]);
    expect(container.querySelector(".agent-role-table")).not.toBeInTheDocument();
    expect(screen.getByLabelText("기획자 최대 인원")).toHaveValue(1);
    expect(screen.getByLabelText("프로젝트 상한")).toHaveValue(3);
    expect(screen.getByLabelText("기기 상한")).toHaveValue(16);
  });

  it("기기 상한은 16보다 높일 수 없다", () => {
    renderView();
    const device = screen.getByLabelText("기기 상한");

    fireEvent.change(device, { target: { value: "32" } });

    expect(device).toHaveValue(16);
    expect(device).toHaveAttribute("max", "16");
  });

  // 런타임 설정 계약에 끄기 필드가 없다. 화면이 끄기를 성공처럼 보여주지 않는다.
  it("역할 사용 여부는 사실만 보여주고 조작을 열지 않는다", () => {
    const { container } = renderView();

    const card = container.querySelector<HTMLElement>(".agent-role-card");
    expect(within(card as HTMLElement).getByText("사용 중")).toBeInTheDocument();
    expect(
      within(card as HTMLElement).getByText(
        "역할은 현재 사용 중이며 이 버전에서는 역할 끄기를 지원하지 않습니다.",
      ),
    ).toBeInTheDocument();
    expect(within(card as HTMLElement).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("첫 확인은 요약만 보여주고 두 번째 확인이 저장한다", async () => {
    const { actions } = renderView();

    fireEvent.change(screen.getByLabelText("기획자 모델"), { target: { value: "opus" } });
    fireEvent.click(screen.getByRole("button", { name: "역할 정책 저장" }));

    expect(actions.save).not.toHaveBeenCalled();
    const summary = screen.getByText("이 내용으로 저장합니다").closest("div");
    expect(within(summary as HTMLElement).getByText(/기획자: claude · opus/)).toBeInTheDocument();
    expect(within(summary as HTMLElement).getByText(/프로젝트 상한 3명/)).toBeInTheDocument();
    expect(
      within(summary as HTMLElement).getByText(/적용 프로젝트: \/projects\/workflow-labs/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "한 번 더 누르면 저장" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    expect((actions.save as ReturnType<typeof vi.fn>).mock.calls[0][0].roles.planner.model).toBe("opus");
  });

  it("호환되지 않는 런타임에서는 저장을 막고 이유를 보여준다", () => {
    renderView(state({ policy: policy(undefined, { executionAllowed: false }) }));

    expect(screen.getByRole("button", { name: "역할 정책 저장" })).toBeDisabled();
    expect(screen.getByLabelText("기획자 실행 도구")).toBeDisabled();
    expect(
      screen.getByText("이 런타임에서는 설정을 저장할 수 없습니다. 위의 준비 상태를 먼저 해결해 주세요."),
    ).toBeInTheDocument();
  });

  it("저장 실패 사유를 그 자리에서 보여준다", () => {
    renderView(state({ saveError: "다른 저장이 먼저 반영됐습니다." }));

    expect(screen.getByText("다른 저장이 먼저 반영됐습니다.")).toBeInTheDocument();
  });

  // 프로젝트를 바꾸면 훅이 스냅샷을 갈아 끼운다. 폼은 그 값으로 다시 서고 이전 편집이 남지 않는다.
  it("스냅샷이 바뀌면 편집 중이던 값이 새 프로젝트 값으로 바뀐다", () => {
    const { rerender, actions } = renderView();
    fireEvent.change(screen.getByLabelText("기획자 모델"), { target: { value: "opus" } });

    const next = policy();
    next.revision = "rev-2";
    next.policy.workingDirectory = "/projects/other";
    rerender(
      <AgentRuntimeView actions={actions} projectName="other" state={state({ policy: next })} />,
    );

    expect(screen.getByLabelText("기획자 모델")).toHaveValue("");
  });
});

describe("AgentRuntimeView 실행 계획과 큐", () => {
  it("상한의 최솟값으로 계산된 실제 시작 수와 대상을 확인한 뒤에만 시작한다", async () => {
    const actions = actionsStub();
    renderView(state({ runPlan, queue }), actions);

    const confirmation = screen.getByRole("region", { name: "시작 확인" });
    expect(within(confirmation).getByText("2개 세션")).toBeInTheDocument();
    expect(within(confirmation).getByText(/남음 4개/)).toBeInTheDocument();
    expect(within(confirmation).getByText("TASK-S051-01, TASK-S051-02")).toBeInTheDocument();
    expect(actions.startRun).not.toHaveBeenCalled();

    fireEvent.click(within(confirmation).getByRole("button", { name: "이 계획으로 시작" }));
    await waitFor(() => expect(actions.startRun).toHaveBeenCalledTimes(1));
  });

  it("시작 수 0은 provider 시작을 막고 수동 배정 진입점을 보여준다", () => {
    const zeroPlan: AgentRunPlan = {
      ...runPlan,
      roles: runPlan.roles.map((role) => ({
        ...role,
        granted: 0,
        manualTargets: [],
        excluded: ["대상 없음"],
      })),
    };
    renderView(state({ runPlan: zeroPlan }));

    expect(screen.getByText(/시작할 수 있는 대상이 0건/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이 계획으로 시작" })).toBeDisabled();
    expect(screen.getAllByRole("option", { name: "직접 지정" })).toHaveLength(1);
    expect(screen.getByLabelText("설정할 역할")).toBeInTheDocument();
  });

  it("API 과금 위험 계획은 별도 확인 전에는 시작하지 않는다", () => {
    renderView(state({ runPlan: { ...runPlan, billingRouteRisk: true } }));
    const start = screen.getByRole("button", { name: "이 계획으로 시작" });

    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Claude API 과금 경로/ }));
    expect(start).toBeEnabled();
  });

  it("수동 대상은 역할별 targets로 계획 검증에 보내고 실행을 바로 시작하지 않는다", async () => {
    const actions = actionsStub();
    renderView(state({ runPlan }), actions);

    fireEvent.click(screen.getByRole("button", { name: "개발자" }));
    fireEvent.change(screen.getByLabelText("개발자 배정 방식"), { target: { value: "manual" } });
    fireEvent.change(screen.getByLabelText("개발자 수동 대상"), {
      target: { value: "TASK-S051-01,TASK-S051-02" },
    });
    fireEvent.click(screen.getByRole("button", { name: "계획 확인" }));

    await waitFor(() => expect(actions.planRun).toHaveBeenCalledTimes(1));
    expect(actions.planRun).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "developer",
          targets: ["TASK-S051-01", "TASK-S051-02"],
        }),
      ]),
    );
    expect(actions.startRun).not.toHaveBeenCalled();
  });

  it("프로젝트 일시 정지는 설명을 확인한 뒤에만 적용한다", async () => {
    const actions = actionsStub();
    renderView(state({ queue }), actions);

    fireEvent.click(screen.getByText("프로젝트 실행 제어"));
    fireEvent.click(screen.getByRole("button", { name: "새 배정 일시 정지" }));
    expect(actions.setProjectPaused).not.toHaveBeenCalled();
    expect(screen.getByText(/이미 실행 중인 항목과 다른 프로젝트의 상태는 유지/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "확인하고 일시 정지" }));
    await waitFor(() => expect(actions.setProjectPaused).toHaveBeenCalledWith(true));
  });

  it("정상 큐는 자동 갱신에 맡기고 오류가 있을 때만 수동 복구를 보여준다", async () => {
    const actions = actionsStub();
    const { rerender } = renderView(state({ queue }), actions);

    expect(screen.queryByRole("button", { name: "실행 상태 다시 확인" })).not.toBeInTheDocument();

    rerender(
      <AgentRuntimeView
        actions={actions}
        projectName="workflow-labs"
        state={state({ queue: null, queueError: "런타임 응답 실패" })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "실행 상태 다시 확인" }));

    await waitFor(() => expect(actions.refreshRuns).toHaveBeenCalledTimes(1));
  });

  it("세 역할 입력은 선택한 한 역할만 보여주고 값은 역할별로 유지한다", () => {
    renderView(state({ queue }));

    expect(screen.getByLabelText("기획자 배정 방식")).toBeInTheDocument();
    expect(screen.queryByLabelText("개발자 배정 방식")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "개발자" }));
    fireEvent.change(screen.getByLabelText("개발자 요청 인원"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "기획자" }));
    fireEvent.click(screen.getByRole("button", { name: "개발자" }));

    expect(screen.getByLabelText("개발자 요청 인원")).toHaveValue(2);
  });

  it("실행 기록이 없으면 중복된 빈 목록 대신 한 문장만 보여준다", () => {
    renderView(state({ queue: { ...queue, runs: [] } }));

    expect(screen.getAllByText("아직 실행 기록이 없습니다.")).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "실행 중과 대기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "최근 종료" })).not.toBeInTheDocument();
  });

  it("취소와 재시도는 각각 확인 화면을 거친다", async () => {
    const actions = actionsStub();
    const current = state({
      queue,
      cancelPreview: {
        runId: "run-running",
        targetId: "TASK-S051-01",
        leaseId: "lease-1",
        pid: 101,
        processLiveness: "running",
        childProcesses: 2,
        cleanup: ["process_tree", "lease"],
      },
      retryPreview: queue.runs[1],
    });
    renderView(current, actions);

    expect(screen.getByText(/자식 프로세스 2개/)).toBeInTheDocument();
    expect(screen.getByText(/이전 실행 run-failed/)).toBeInTheDocument();
    expect(actions.confirmCancel).not.toHaveBeenCalled();
    expect(actions.confirmRetry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "확인하고 취소" }));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 재시도" }));
    await waitFor(() => expect(actions.confirmCancel).toHaveBeenCalledTimes(1));
    expect(actions.confirmRetry).toHaveBeenCalledTimes(1);
  });

  it("구조화 로그에서 prompt와 비밀 필드를 DOM에 내보내지 않는다", () => {
    const { container } = renderView(
      state({
        queue,
        logs: {
          "run-running": {
            runId: "run-running",
            nextCursor: 7,
            events: [
              {
                timestamp: "2026-08-08T09:01:00Z",
                stage: "provider_start",
                status: "running",
                message: "token=SECRET_INSIDE_MESSAGE",
                prompt: "FULL_PRIVATE_PROMPT",
                apiKey: "SECRET_API_KEY",
                token: "SECRET_TOKEN",
              },
            ],
          },
        },
      }),
    );

    expect(container.textContent).toContain("provider_start");
    expect(container.textContent).not.toContain("FULL_PRIVATE_PROMPT");
    expect(container.textContent).not.toContain("SECRET_API_KEY");
    expect(container.textContent).not.toContain("SECRET_TOKEN");
    expect(container.textContent).not.toContain("SECRET_INSIDE_MESSAGE");
  });

  it.each([
    ["reserved", "예약 중"],
    ["queued", "대기"],
    ["running", "실행 중"],
    ["paused", "일시 정지"],
    ["succeeded", "성공"],
    ["failed", "실패"],
    ["cancelled", "취소됨"],
    ["recovery_required", "복구 필요"],
  ] as const)("%s 상태를 %s 문구로 구분한다", (runState, label) => {
    renderView(
      state({
        queue: {
          ...queue,
          runs: [{ ...queue.runs[0], runId: `run-${runState}`, state: runState }],
        },
      }),
    );

    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });
});

describe("AgentRuntimeView 경계", () => {
  it("Dream을 이 화면에 넣지 않는다", () => {
    const { container } = renderView(
      state({ plan: { kind: "update", plan: updatePlan }, migration: null }),
    );

    expect(container.textContent).not.toMatch(/Dream/i);
    expect(container.textContent).not.toMatch(/드림/);
  });

  it("실행 도구 선택지는 계약이 허용한 둘뿐이다", () => {
    renderView();

    const options = Array.from(
      screen.getByLabelText("기획자 실행 도구").querySelectorAll("option"),
      (option) => option.getAttribute("value"),
    );
    expect(options).toEqual(["claude", "codex"]);
  });
});
