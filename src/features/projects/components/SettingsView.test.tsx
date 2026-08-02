import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  HeartbeatIntegration,
  HeartbeatState,
  ManagedRoleJob,
  ProjectSummary,
} from "../domain/types";
import type { AppUpdaterState } from "../../updater/domain/types";
import { SettingsView } from "./SettingsView";

afterEach(cleanup);

const project: ProjectSummary = {
  rootPath: "/projects/workflow-labs",
  initialized: true,
  projectId: "prj_1",
  name: "workflow-labs",
  compatibility: "current",
  activeLeases: [],
  workflows: [],
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

function integration(overrides: Partial<HeartbeatIntegration> = {}): HeartbeatIntegration {
  return {
    supported: true,
    slug: "-projects-workflow-labs",
    conditionScriptPath: ".workflow/rules/wf-eligible.sh",
    status: {
      installation: "installed_daemon_running",
      roles: [],
      duplicateJobs: [],
      readFailures: [],
    },
    managedJobs: [],
    ...overrides,
  };
}

function renderSettings(
  heartbeat: HeartbeatState,
  onInstall = vi.fn().mockResolvedValue(true),
) {
  render(
    <SettingsView
      project={project}
      updater={updater}
      heartbeat={heartbeat}
      onInstallHeartbeatJobs={onInstall}
      onSwitchProject={vi.fn()}
    />,
  );
  return onInstall;
}

/** 설치된 상태의 연동 카드. 역할 잡 관리 UI가 보이는 최소 조건이다. */
function installed(managedJobs: ManagedRoleJob[] = []): HeartbeatState {
  return {
    integration: integration({ managedJobs }),
    error: null,
    writeError: null,
  };
}

describe("SettingsView 연동 섹션", () => {
  it("guides the install and hides the role jobs while heartbeat is missing", () => {
    renderSettings({
      integration: integration({
        status: {
          installation: "not_installed",
          roles: [],
          duplicateJobs: [],
          readFailures: [],
        },
      }),
      error: null,
      writeError: null,
    });

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("미설치");
    expect(card).toHaveTextContent("pip install claude-heartbeat");
    expect(card).toHaveTextContent("github.com/wooson00308/claude-heartbeat");
    expect(card).toHaveTextContent("앱이 하트비트를 대신 설치하지 않습니다");
    expect(card).not.toHaveTextContent("역할 잡 미설치");
  });

  it("tells a stopped daemon apart from a running one by its evidence", () => {
    renderSettings({
      integration: integration({
        status: {
          installation: "installed_daemon_stopped",
          roles: [],
          duplicateJobs: [],
          readFailures: [],
        },
      }),
      error: null,
      writeError: null,
    });
    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("설치됨 · 데몬 미실행");
    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("heartbeat.pid가 없어");
    cleanup();

    renderSettings({ integration: integration(), error: null, writeError: null });
    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("설치됨 · 데몬 실행 중");
    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("heartbeat.pid가 있습니다");
  });

  it("shows the slug, the condition script path and the settings of every installed role job", () => {
    renderSettings({
      integration: integration({
        managedJobs: [
          { role: "developer", interval: "20m", maxPer: "6/24h", model: "opus" },
        ],
        status: {
          installation: "installed_daemon_running",
          roles: [
            {
              role: "developer",
              jobName: "wf-developer-projects-workflow-labs",
              lastRun: { at: "2026-08-02T02:42:25", result: "skipped", durationSeconds: 0 },
            },
          ],
          duplicateJobs: [],
          readFailures: [],
        },
      }),
      error: null,
      writeError: null,
    });

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("-projects-workflow-labs");
    expect(card).toHaveTextContent(".workflow/rules/wf-eligible.sh");
    expect(screen.getByLabelText("개발자 주기")).toHaveValue("20m");
    expect(screen.getByLabelText("개발자 실행 한도")).toHaveValue("6/24h");
    expect(screen.getByLabelText("개발자 모델")).toHaveValue("opus");
    expect(card).toHaveTextContent("2026-08-02T02:42:25 (로컬 시각)");
    expect(card).toHaveTextContent("건너뜀 · 처리할 대상 없음");
    expect(card).not.toHaveTextContent("실행 기록 없음");
  });

  it("marks a job without a state record as having no run history", () => {
    renderSettings({
      integration: integration({
        managedJobs: [
          { role: "planner", interval: "30m", maxPer: "4/24h", model: "opus" },
        ],
        status: {
          installation: "installed_daemon_running",
          roles: [
            { role: "planner", jobName: "wf-planner-projects-workflow-labs", lastRun: null },
          ],
          duplicateJobs: [],
          readFailures: [],
        },
      }),
      error: null,
      writeError: null,
    });

    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("실행 기록 없음");
  });

  it("warns about a duplicate job outside the managed block", () => {
    renderSettings({
      integration: integration({
        status: {
          installation: "installed_daemon_running",
          roles: [],
          duplicateJobs: [{ name: "wf-developer", role: "developer" }],
          readFailures: [],
        },
      }),
      error: null,
      writeError: null,
    });

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("관리 블록 밖에 같은 프로젝트의 역할 잡이 있습니다");
    expect(card).toHaveTextContent("wf-developer");
    expect(card).toHaveTextContent("NO_ELIGIBLE_WORK");
    expect(card).toHaveTextContent("직접 정리해야 합니다");
  });

  it("says the integration is unsupported on this platform", () => {
    renderSettings({ integration: integration({ supported: false }), error: null, writeError: null });

    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent(
      "이 플랫폼에서는 연동을 지원하지 않습니다",
    );
  });

  it("keeps a failed status read inside the card", () => {
    renderSettings({ integration: null, error: "홈 디렉터리를 찾지 못했습니다", writeError: null });

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("상태를 읽을 수 없음");
    expect(card).toHaveTextContent("홈 디렉터리를 찾지 못했습니다");
    expect(screen.getByText("workflow-labs")).toBeInTheDocument();
  });
});

describe("SettingsView 역할 잡 설치", () => {
  const installAction = { name: "이 프로젝트에 역할 잡 설치" };

  it("does not write before the confirmation step", () => {
    const onInstall = renderSettings(installed());

    fireEvent.click(screen.getByRole("button", installAction));

    expect(onInstall).not.toHaveBeenCalled();
  });

  it("shows both target paths and the change summary before writing", async () => {
    const onInstall = renderSettings(installed());

    fireEvent.click(screen.getByRole("button", installAction));

    const confirm = screen.getByRole("group", { name: "역할 잡 설치 확인" });
    expect(confirm).toHaveTextContent("~/.claude/HEARTBEAT.md");
    expect(confirm).toHaveTextContent("전역 파일입니다");
    expect(confirm).toHaveTextContent(".workflow/rules/wf-eligible.sh");
    expect(confirm).toHaveTextContent("프로젝트 로컬 파일입니다");
    expect(confirm).toHaveTextContent("wf-planner-projects-workflow-labs");
    expect(confirm).toHaveTextContent("wf-architect-projects-workflow-labs");
    expect(confirm).toHaveTextContent("wf-developer-projects-workflow-labs");
    expect(confirm).toHaveTextContent("블록 밖의 잡과 전역 설정은 읽기만 하고");

    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall).toHaveBeenCalledWith([
      { role: "planner", enabled: true, interval: "30m", maxPer: "4/24h", model: "opus" },
      { role: "architect", enabled: true, interval: "30m", maxPer: "4/24h", model: "opus" },
      { role: "developer", enabled: true, interval: "20m", maxPer: "6/24h", model: "opus" },
    ]);
  });

  it("sends a role turned off as disabled and says the edited values are lost", () => {
    const onInstall = renderSettings(
      installed([{ role: "architect", interval: "30m", maxPer: "4/24h", model: "opus" }]),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "프로젝트 아키텍트" }));

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("다시 켜면 기본값으로 시작합니다");

    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    const confirm = screen.getByRole("group", { name: "역할 잡 설치 확인" });
    expect(confirm).toHaveTextContent("제거: wf-architect-projects-workflow-labs");

    expect(onInstall).not.toHaveBeenCalled();
  });

  it.each([
    ["개발자 주기", "30분", "숫자 뒤에 s, m, h, d 중 하나를 붙여 주세요"],
    ["개발자 실행 한도", "4회", "<횟수>/<기간> 형태로 적어 주세요"],
    ["개발자 모델", "claude opus", "공백 없는 한 줄 값이어야 합니다"],
  ])("reports %s at its own input and writes nothing", (label, value, reason) => {
    const onInstall = renderSettings(installed());

    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", installAction));

    const input = screen.getByLabelText(label);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(input.getAttribute("aria-describedby") ?? "")).toHaveTextContent(
      reason,
    );
    expect(screen.queryByRole("group", { name: "역할 잡 설치 확인" })).not.toBeInTheDocument();
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("disables the install action on an unsupported platform", () => {
    renderSettings({
      integration: integration({ supported: false }),
      error: null,
      writeError: null,
    });

    expect(screen.getByRole("button", installAction)).toBeDisabled();
  });

  it("hides the install action while heartbeat itself is missing", () => {
    renderSettings({
      integration: integration({
        status: {
          installation: "not_installed",
          roles: [],
          duplicateJobs: [],
          readFailures: [],
        },
      }),
      error: null,
      writeError: null,
    });

    expect(screen.queryByRole("button", installAction)).not.toBeInTheDocument();
  });

  it("keeps a failed write visible with the reason", () => {
    renderSettings({
      integration: integration(),
      error: null,
      writeError: "~/.claude/HEARTBEAT.md의 앱 관리 블록 마커가 손상되어 파일을 쓰지 않았습니다.",
    });

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("역할 잡을 쓰지 못했습니다");
    expect(card).toHaveTextContent("마커가 손상되어 파일을 쓰지 않았습니다");
  });

  it("explains why the default interval is not shorter", () => {
    renderSettings(installed());

    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent(
      "조건 검사만 반복되고 중복 기동 위험만 늘어납니다",
    );
  });
});
