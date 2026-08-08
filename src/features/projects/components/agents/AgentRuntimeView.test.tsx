import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentPolicySnapshot,
  AgentProviderDiagnosis,
  AgentRolePolicy,
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

describe("AgentRuntimeView 준비 상태", () => {
  it("정상 상태에서는 내부 하트비트 이름을 주 제목으로 쓰지 않는다", () => {
    renderView();

    expect(screen.getByRole("heading", { level: 1, name: "에이전트" })).toBeInTheDocument();
    expect(screen.getByText("실행 환경이 준비됐습니다")).toBeInTheDocument();
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

  it("다시 읽기는 조회만 부른다", async () => {
    const { actions } = renderView();

    fireEvent.click(screen.getByRole("button", { name: "다시 읽기" }));

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

    const rows = Array.from(container.querySelectorAll<HTMLElement>(".agent-role-table tbody tr"));
    expect(rows.map((row) => row.querySelector("th")?.textContent)).toEqual([
      "기획자",
      "아키텍트",
      "개발자",
    ]);
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

    const row = container.querySelector<HTMLElement>(".agent-role-table tbody tr");
    expect(within(row as HTMLElement).getByText("사용함")).toBeInTheDocument();
    expect(
      within(row as HTMLElement).getByText("런타임 계약에 끄기 필드가 없어 이 값은 바꿀 수 없습니다."),
    ).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByRole("checkbox")).not.toBeInTheDocument();
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
