import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DreamIntegration,
  HeartbeatIntegration,
  HeartbeatJobRun,
  HeartbeatRoleStatus,
  IntegrationsSnapshot,
  IntegrationsState,
  JobDefaults,
  ManagedRoleJob,
} from "../../domain/types";
import { IntegrationsView } from "./IntegrationsView";

/**
 * 펼침 상태는 브라우저 저장소에 남는다(SPEC-006 R6). 테스트 환경의 `localStorage`는 메서드가 없는
 * 빈 객체라 실제 저장 동작을 보려면 직접 세워야 한다. 매 테스트가 빈 저장소에서 시작해야 앞 테스트가
 * 펼쳐 둔 값이 다음 테스트의 시작 상태를 바꾸지 않는다.
 */
let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * 백엔드 잡 정의의 기본값(`heartbeat_roles.rs`의 `default_settings`)과 같은 값이다. 화면은 이 값을
 * 스냅샷에서 받아 폼을 시딩하고 재설정도 이 값으로 한다.
 */
const roleDefaults: Record<string, JobDefaults> = {
  planner: { interval: "30m", maxPer: "4/24h", model: "opus" },
  architect: { interval: "30m", maxPer: "4/24h", model: "opus" },
  developer: { interval: "20m", maxPer: "6/24h", model: "opus" },
};

/** 백엔드는 늘 역할 셋을 담아 보낸다. 실행 기록만 다르게 주고 나머지는 여기서 채운다. */
function roleStatuses(
  runs: Record<string, HeartbeatJobRun> = {},
): HeartbeatRoleStatus[] {
  return ["planner", "architect", "developer"].map((role) => ({
    role,
    jobName: `wf-${role}-projects-workflow-labs`,
    defaults: roleDefaults[role],
    lastRun: runs[role] ?? null,
  }));
}

function heartbeat(overrides: Partial<HeartbeatIntegration> = {}): HeartbeatIntegration {
  return {
    installation: "installed",
    daemonRunning: true,
    conditionScriptPath: ".workflow/rules/wf-eligible.sh",
    roles: roleStatuses(),
    managedJobs: [],
    duplicateJobs: [],
    readFailures: [],
    ...overrides,
  };
}

/** dream 카드 자체의 시나리오는 DreamCard.test.tsx가 덮는다. 여기서는 섹션에 얹히기만 하면 된다. */
function dream(overrides: Partial<DreamIntegration> = {}): DreamIntegration {
  return {
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
    defaults: { interval: "2h", maxPer: "6/24h", model: "opus" },
    managedJob: null,
    lastRun: null,
    duplicateJobs: [],
    readFailures: [],
    ...overrides,
  };
}

function snapshot(overrides: Partial<IntegrationsSnapshot> = {}): IntegrationsSnapshot {
  return {
    supported: true,
    slug: "-projects-workflow-labs",
    managedBlockFailure: null,
    heartbeat: heartbeat(),
    dream: dream(),
    ...overrides,
  };
}

/** 카드 머리의 펼침 토글. 본문 버튼과 섞이지 않도록 토글의 두 문구로만 고른다. */
function toggleOf(name: string) {
  return within(screen.getByRole("article", { name })).getByRole("button", {
    name: /^(펼치기|접기)$/,
  });
}

/** 카드 하나를 펼치거나 접는다. 토글은 카드 머리에 있어 접혀 있어도 늘 눌린다. */
function toggleCard(name: string) {
  fireEvent.click(toggleOf(name));
}

/**
 * 카드는 접힌 채로 시작한다(SPEC-006 R6). 본문을 읽는 테스트가 대부분이므로 렌더 직후 전부 펼친다.
 * 접힘 자체를 보는 테스트는 `expand: false`로 이 준비 동작을 건너뛴다.
 */
function renderIntegrations(
  integrations: IntegrationsState,
  onInstall = vi.fn().mockResolvedValue(true),
  { expand = true }: { expand?: boolean } = {},
) {
  render(
    <IntegrationsView
      actions={{
        installHeartbeatJobs: onInstall,
        installDreamJob: vi.fn().mockResolvedValue(true),
      }}
      error={integrations.error}
      snapshot={integrations.snapshot}
      writeError={integrations.writeError}
    />,
  );
  if (expand) {
    // 앞선 렌더에서 펼쳐 둔 카드는 저장된 상태로 이미 펼쳐져 나온다. 아직 접힌 카드만 누른다.
    for (const toggle of screen.queryAllByRole("button", { name: "펼치기" })) {
      fireEvent.click(toggle);
    }
  }
  return onInstall;
}

/** 설치된 상태의 연동 스냅샷. 역할 잡 관리 UI가 보이는 최소 조건이다. */
function installed(managedJobs: ManagedRoleJob[] = []): IntegrationsState {
  return {
    snapshot: snapshot({ heartbeat: heartbeat({ managedJobs }) }),
    error: null,
    writeError: null,
  };
}

/** 화면에 보이는 선택지 이름으로 고른다. 테스트가 직접 입력 항목의 내부 값을 알 필요가 없다. */
function selectModel(label: string, option: string) {
  const select = screen.getByLabelText(label);
  const target = within(select).getByRole("option", { name: option }) as HTMLOptionElement;
  fireEvent.change(select, { target: { value: target.value } });
}

describe("IntegrationsView 연동 섹션", () => {
  it("draws one card per built-in integration", () => {
    renderIntegrations(installed());

    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("article", { name: "claude-heartbeat" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "dream" })).toBeInTheDocument();
  });

  // 배지 문구는 연동 공통 설치 상태와 하트비트 부가 상태(데몬 실행 여부)의 조합으로 만든다.
  it.each([
    ["not_installed" as const, false, "미설치"],
    ["installed" as const, false, "설치됨 · 데몬 미실행"],
    ["installed" as const, true, "설치됨 · 데몬 실행 중"],
  ])("labels %s with daemonRunning=%s as %s", (installation, daemonRunning, label) => {
    renderIntegrations({
      snapshot: snapshot({ heartbeat: heartbeat({ installation, daemonRunning }) }),
      error: null,
      writeError: null,
    });

    expect(screen.getByRole("article", { name: "claude-heartbeat" })).toHaveTextContent(label);
  });

  it("guides the install and hides the role jobs while heartbeat is missing", () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({ installation: "not_installed", daemonRunning: false }),
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
    renderIntegrations({
      snapshot: snapshot({ heartbeat: heartbeat({ daemonRunning: false }) }),
      error: null,
      writeError: null,
    });
    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("설치됨 · 데몬 미실행");
    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("heartbeat.pid가 없어");
    cleanup();

    renderIntegrations({ snapshot: snapshot(), error: null, writeError: null });
    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("설치됨 · 데몬 실행 중");
    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("heartbeat.pid가 있습니다");
  });

  it("shows the slug, the condition script path and the settings of every installed role job", () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({
          managedJobs: [
            { role: "developer", interval: "20m", maxPer: "6/24h", model: "opus", appOwnedDrift: [] },
          ],
          roles: roleStatuses({
            developer: { at: "2026-08-02T02:42:25", result: "skipped", durationSeconds: 0 },
          }),
        }),
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
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({
          managedJobs: [
            { role: "planner", interval: "30m", maxPer: "4/24h", model: "opus", appOwnedDrift: [] },
          ],
          roles: roleStatuses(),
        }),
      }),
      error: null,
      writeError: null,
    });

    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent("실행 기록 없음");
  });

  it("warns about a duplicate job outside the managed block", () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({
          duplicateJobs: [
            { name: "wf-developer", integration: "heartbeat", role: "developer" },
          ],
        }),
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
    renderIntegrations({ snapshot: snapshot({ supported: false }), error: null, writeError: null });

    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent(
      "이 플랫폼에서는 연동을 지원하지 않습니다",
    );
    // 카드마다 반복하지 않고 뷰 공통 위치에서 한 번만 그린다.
    expect(screen.getAllByText("이 플랫폼에서는 연동을 지원하지 않습니다")).toHaveLength(1);
  });

  it("keeps a failed status read inside the card", () => {
    renderIntegrations({ snapshot: null, error: "홈 디렉터리를 찾지 못했습니다", writeError: null });

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("상태를 읽을 수 없음");
    expect(card).toHaveTextContent("홈 디렉터리를 찾지 못했습니다");
    // 설정 화면에 얹혀 있던 시절에는 프로젝트 이름 카드가 남는지로 확인하던 자리다. 전용 뷰에서
    // "실패가 카드 안에 머문다"를 보이는 화면 요소는 뷰 자신의 제목이다.
    expect(screen.getByRole("heading", { name: "연동" })).toBeInTheDocument();
  });
});

describe("IntegrationsView 역할 잡 설치", () => {
  const installAction = { name: "이 프로젝트에 역할 잡 설치" };

  it("does not write before the confirmation step", () => {
    const onInstall = renderIntegrations(installed());

    fireEvent.click(screen.getByRole("button", installAction));

    expect(onInstall).not.toHaveBeenCalled();
  });

  it("shows both target paths and the change summary before writing", async () => {
    const onInstall = renderIntegrations(installed());

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
    // 아무 필드도 건드리지 않았으므로 세 값은 전부 미지정이다. 파일에 적힌 값이 이긴다.
    // 관리 블록에 잡이 없던 상태를 읽었으므로 기준값은 빈 목록이다.
    expect(onInstall).toHaveBeenCalledWith(
      [
        { role: "planner", enabled: true, interval: null, maxPer: null, model: null },
        { role: "architect", enabled: true, interval: null, maxPer: null, model: null },
        { role: "developer", enabled: true, interval: null, maxPer: null, model: null },
      ],
      [],
    );
  });

  // R1. 폼에 파일 값이 차 있어도 그것을 명시로 보내지 않는다. 보내지 않은 필드는 백엔드가 파일에서
  // 가져오므로, 화면이 값을 잘못 채운 상태에서 저장이 일어나도 편집값이 살아남는다.
  it("sends only the fields the user actually changed", async () => {
    const onInstall = renderIntegrations(
      installed([
        { role: "developer", interval: "20m", maxPer: "8/24h", model: "opus", appOwnedDrift: [] },
      ]),
    );

    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    // R3. 시딩에 쓴 관리 블록 값이 그대로 기준값으로 실려 나간다.
    expect(onInstall).toHaveBeenCalledWith(
      [
        { role: "planner", enabled: false, interval: null, maxPer: null, model: null },
        { role: "architect", enabled: false, interval: null, maxPer: null, model: null },
        { role: "developer", enabled: true, interval: "45m", maxPer: null, model: null },
      ],
      [{ role: "developer", interval: "20m", maxPer: "8/24h", model: "opus", appOwnedDrift: [] }],
    );
  });

  it("sends a role turned off as disabled and says the edited values are lost", () => {
    const onInstall = renderIntegrations(
      installed([
        { role: "architect", interval: "30m", maxPer: "4/24h", model: "opus", appOwnedDrift: [] },
      ]),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "프로젝트 아키텍트" }));

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("다시 켜면 기본값으로 시작합니다");

    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    const confirm = screen.getByRole("group", { name: "역할 잡 설치 확인" });
    expect(confirm).toHaveTextContent("제거: wf-architect-projects-workflow-labs");

    expect(onInstall).not.toHaveBeenCalled();
  });

  // R4. 확인 화면은 쓰게 될 값을 나열하는 대신 파일의 현재 값과 함께 보여준다. 나열은 사용자가
  // 파일 값을 외우고 있을 때만 검증 수단이 된다.
  it("marks the changed field and leaves the other two as unchanged", () => {
    renderIntegrations(
      installed([
        { role: "developer", interval: "20m", maxPer: "8/24h", model: "opus", appOwnedDrift: [] },
      ]),
    );

    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));

    const confirm = screen.getByRole("group", { name: "역할 잡 설치 확인" });
    expect(confirm).toHaveTextContent("주기 20m → 45m — 바뀜");
    expect(confirm).toHaveTextContent("실행 한도 8/24h — 그대로");
    expect(confirm).toHaveTextContent("모델 opus — 그대로");
  });

  it("says the managed block does not change when nothing was edited", () => {
    renderIntegrations(
      installed([
        { role: "developer", interval: "20m", maxPer: "6/24h", model: "opus", appOwnedDrift: [] },
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));

    expect(screen.getByRole("group", { name: "역할 잡 설치 확인" })).toHaveTextContent(
      "관리 블록에서 달라지는 값이 없습니다",
    );
  });

  it("marks a role missing from the managed block as newly added", () => {
    renderIntegrations(
      installed([
        { role: "developer", interval: "20m", maxPer: "6/24h", model: "opus", appOwnedDrift: [] },
      ]),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "기획자" }));
    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));

    const confirm = screen.getByRole("group", { name: "역할 잡 설치 확인" });
    expect(confirm).toHaveTextContent(
      "wf-planner-projects-workflow-labs — 관리 블록에 없던 잡입니다. 새로 추가됩니다.",
    );
    expect(confirm).toHaveTextContent("주기 없음 → 30m — 바뀜");
  });

  /** R4. 값 자체는 보여주지 않는다. 요구는 되돌아간다는 사실과 그 대상이다. */
  it("names the app owned fields that go back to the app value", () => {
    renderIntegrations(
      installed([
        {
          role: "developer",
          interval: "20m",
          maxPer: "6/24h",
          model: "opus",
          appOwnedDrift: ["timeout"],
        },
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));

    const confirm = screen.getByRole("group", { name: "역할 잡 설치 확인" });
    expect(confirm).toHaveTextContent("되돌아감: timeout");
    expect(confirm).toHaveTextContent("앱 값으로 다시 쓰입니다");
  });

  it("shows the values that disappear with the role turned off", () => {
    renderIntegrations(
      installed([
        { role: "architect", interval: "30m", maxPer: "4/24h", model: "opus", appOwnedDrift: [] },
      ]),
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "프로젝트 아키텍트" }));
    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));

    const confirm = screen.getByRole("group", { name: "역할 잡 설치 확인" });
    expect(confirm).toHaveTextContent("제거: wf-architect-projects-workflow-labs");
    expect(confirm).toHaveTextContent("주기 30m · 실행 한도 4/24h · 모델 opus 값이 함께 사라집니다");
    // 활성 역할이 하나도 남지 않는 경우의 현행 문구는 그대로다.
    expect(confirm).toHaveTextContent("활성 역할이 없어 관리 블록 전체를 제거합니다");
  });

  // 이 목록에 있던 ["개발자 모델", "claude opus", ...] 행은 아래 "모델 선택" describe의
  // "reports an invalid directly entered model ..." 로 옮겼다. 선택 컨트롤에는 목록 밖 문자열을
  // 넣을 수 없으므로, 잘못된 model 값이 도달할 수 있는 경로가 직접 입력 칸으로 바뀌었다.
  it.each([
    ["개발자 주기", "30분", "숫자 뒤에 s, m, h, d 중 하나를 붙여 주세요"],
    ["개발자 실행 한도", "4회", "<횟수>/<기간> 형태로 적어 주세요"],
  ])("reports %s at its own input and writes nothing", (label, value, reason) => {
    const onInstall = renderIntegrations(installed());

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
    renderIntegrations({
      snapshot: snapshot({ supported: false }),
      error: null,
      writeError: null,
    });

    expect(screen.getByRole("button", installAction)).toBeDisabled();
  });

  it("hides the install action while heartbeat itself is missing", () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({ installation: "not_installed", daemonRunning: false }),
      }),
      error: null,
      writeError: null,
    });

    expect(screen.queryByRole("button", installAction)).not.toBeInTheDocument();
  });

  it("keeps a failed write visible with the reason", () => {
    renderIntegrations({
      snapshot: snapshot(),
      error: null,
      writeError: {
        integration: "heartbeat",
        message: "~/.claude/HEARTBEAT.md의 앱 관리 블록 마커가 손상되어 파일을 쓰지 않았습니다.",
      },
    });

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("역할 잡을 쓰지 못했습니다");
    expect(card).toHaveTextContent("마커가 손상되어 파일을 쓰지 않았습니다");
  });

  // 한 연동의 실패 문구가 다른 연동 카드에 나타나면 사용자가 해야 할 일을 잘못 읽는다.
  it("shows a failed write only in the card that asked for it", () => {
    renderIntegrations({
      snapshot: snapshot(),
      error: null,
      writeError: { integration: "dream", message: "dream 쓰기 실패" },
    });

    expect(screen.getByRole("article", { name: "claude-heartbeat" })).not.toHaveTextContent(
      "역할 잡을 쓰지 못했습니다",
    );
  });

  it("explains why the default interval is not shorter", () => {
    renderIntegrations(installed());

    expect(screen.getByRole("region", { name: "연동" })).toHaveTextContent(
      "조건 검사만 반복되고 중복 기동 위험만 늘어납니다",
    );
  });

  // R4. 두 연동은 관리 블록을 공유하지만 폼은 서로 독립이다. 한쪽 편집이 다른 쪽 입력을 되돌리면
  // 사용자는 저장 한 번에 다른 잡의 값을 잃는다.
  it("keeps the role job form untouched while the dream job is edited", async () => {
    renderIntegrations({
      snapshot: snapshot({
        heartbeat: heartbeat({
          managedJobs: [
            { role: "developer", interval: "20m", maxPer: "6/24h", model: "opus", appOwnedDrift: [] },
          ],
        }),
        dream: dream({
          installation: "installed",
          managedJob: { interval: "2h", maxPer: "6/24h", model: "opus", appOwnedDrift: [] },
        }),
      }),
      error: null,
      writeError: null,
    });

    await userEvent.clear(screen.getByLabelText("dream 정제 주기"));
    await userEvent.type(screen.getByLabelText("dream 정제 주기"), "6h");
    await userEvent.click(screen.getByLabelText("dream 정제"));

    expect(screen.getByLabelText("개발자 주기")).toHaveValue("20m");
    expect(screen.getByLabelText("개발자 실행 한도")).toHaveValue("6/24h");
    expect(screen.getByLabelText("dream 정제 주기")).toHaveValue("6h");
  });
});

// R5. 기본값으로 되돌리는 것은 정당한 요구다. 그것을 저장의 부작용으로 두면 정당한 요구와 사고를
// 구별할 수 없다. 명시적 액션으로 두면 둘 다 표현할 수 있다.
describe("IntegrationsView 역할 잡 기본값 재설정", () => {
  const resetAction = { name: "개발자 기본값으로 재설정" };
  const confirmReset = { name: "확인하고 되돌리기" };

  const edited = (overrides: Partial<ManagedRoleJob> = {}): ManagedRoleJob => ({
    role: "developer",
    interval: "45m",
    maxPer: "16/24h",
    model: "sonnet",
    appOwnedDrift: [],
    ...overrides,
  });

  it("offers the action only for a job written in the managed block", () => {
    renderIntegrations(installed([edited()]));

    expect(screen.getByRole("button", resetAction)).toBeInTheDocument();
    // 되돌릴 파일 값이 없는 잡이다. 폼은 이미 기본값에서 시작한다.
    expect(
      screen.queryByRole("button", { name: "기획자 기본값으로 재설정" }),
    ).not.toBeInTheDocument();
  });

  it("does not write before the confirmation step", () => {
    const onInstall = renderIntegrations(installed([edited()]));

    fireEvent.click(screen.getByRole("button", resetAction));

    expect(onInstall).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "개발자 기본값 재설정 확인" })).toBeInTheDocument();
  });

  it("shows the difference between the file values and the app defaults", () => {
    renderIntegrations(installed([edited()]));

    fireEvent.click(screen.getByRole("button", resetAction));

    const confirm = screen.getByRole("group", { name: "개발자 기본값 재설정 확인" });
    expect(confirm).toHaveTextContent("주기 45m → 20m — 바뀜");
    expect(confirm).toHaveTextContent("실행 한도 16/24h → 6/24h — 바뀜");
    expect(confirm).toHaveTextContent("모델 sonnet → opus — 바뀜");
    expect(confirm).toHaveTextContent("~/.claude/HEARTBEAT.md");
    expect(confirm).toHaveTextContent("잡의 활성·비활성 상태와 같은 블록의 다른 잡은 그대로 둡니다");
  });

  it("says nothing changes for a job already at the app defaults", () => {
    renderIntegrations(
      installed([
        { role: "developer", interval: "20m", maxPer: "6/24h", model: "opus", appOwnedDrift: [] },
      ]),
    );

    fireEvent.click(screen.getByRole("button", resetAction));

    expect(screen.getByRole("group", { name: "개발자 기본값 재설정 확인" })).toHaveTextContent(
      "관리 블록에서 달라지는 값이 없습니다",
    );
  });

  // R5. 재설정은 그 잡 하나에만 적용된다. 나머지 잡을 미지정으로 두어야 백엔드가 파일 값을 그대로
  // 다시 쓴다. 화면이 다른 잡의 값을 실어 보내면 이 기획서가 없애려는 패턴 그대로다.
  it("specifies the defaults for the target job and leaves the others unspecified", async () => {
    const onInstall = renderIntegrations(
      installed([
        edited(),
        { role: "planner", interval: "35m", maxPer: "9/24h", model: "haiku", appOwnedDrift: [] },
      ]),
    );

    fireEvent.click(screen.getByRole("button", resetAction));
    fireEvent.click(screen.getByRole("button", confirmReset));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall).toHaveBeenCalledWith(
      [
        { role: "planner", enabled: true, interval: null, maxPer: null, model: null },
        { role: "architect", enabled: false, interval: null, maxPer: null, model: null },
        { role: "developer", enabled: true, interval: "20m", maxPer: "6/24h", model: "opus" },
      ],
      [
        edited(),
        { role: "planner", interval: "35m", maxPer: "9/24h", model: "haiku", appOwnedDrift: [] },
      ],
    );
  });

  // 기획서 완료 조건 12. 재설정은 편집 가능 값만 되돌린다. 폼의 토글을 바꿔 둔 상태에서 눌러도
  // 관리 블록의 잡 목록이 그대로여야 한다.
  it("sends the enabled state of the file, not the one of the form", async () => {
    const onInstall = renderIntegrations(installed([edited()]));

    // 파일에 없는 역할을 켜고, 파일에 있는 대상 역할을 끈다. 둘 다 폼에서만 일어난 일이다.
    fireEvent.click(screen.getByRole("checkbox", { name: "기획자" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "개발자" }));
    fireEvent.click(screen.getByRole("button", resetAction));
    fireEvent.click(screen.getByRole("button", confirmReset));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall.mock.calls[0][0]).toEqual([
      { role: "planner", enabled: false, interval: null, maxPer: null, model: null },
      { role: "architect", enabled: false, interval: null, maxPer: null, model: null },
      { role: "developer", enabled: true, interval: "20m", maxPer: "6/24h", model: "opus" },
    ]);
  });

  // 저장의 부작용으로 일어나서는 안 되는 것이 이 액션의 요점이다. 반대 방향도 같다.
  it("leaves the save action untouched", async () => {
    const onInstall = renderIntegrations(installed([edited()]));

    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    expect(
      screen.queryByRole("group", { name: "개발자 기본값 재설정 확인" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall.mock.calls[0][0]).toEqual([
      { role: "planner", enabled: false, interval: null, maxPer: null, model: null },
      { role: "architect", enabled: false, interval: null, maxPer: null, model: null },
      { role: "developer", enabled: true, interval: null, maxPer: null, model: null },
    ]);
  });

  it("cancels without writing anything", () => {
    const onInstall = renderIntegrations(installed([edited()]));

    fireEvent.click(screen.getByRole("button", resetAction));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(
      screen.queryByRole("group", { name: "개발자 기본값 재설정 확인" }),
    ).not.toBeInTheDocument();
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("disables the action on an unsupported platform", () => {
    renderIntegrations({
      snapshot: snapshot({ heartbeat: heartbeat({ managedJobs: [edited()] }), supported: false }),
      error: null,
      writeError: null,
    });

    expect(screen.getByRole("button", resetAction)).toBeDisabled();
  });
});

// R2. 관리 블록을 읽지 못한 상태는 "블록에 잡이 없다"와 다른 상태다. 두 상태가 같아 보이면
// 사용자는 기본값이 찬 폼을 파일의 값으로 읽고, 그대로 저장하면 앱이 모르는 값을 덮어쓴다.
describe("IntegrationsView 관리 블록 읽기 실패", () => {
  const failure = {
    path: "/Users/catze/.claude/HEARTBEAT.md",
    message: "Permission denied (os error 13)",
  };

  function unreadable(): IntegrationsState {
    return {
      snapshot: snapshot({ managedBlockFailure: failure }),
      error: null,
      writeError: null,
    };
  }

  it("hides the role job form and blocks the save", () => {
    const onInstall = renderIntegrations(unreadable());

    expect(screen.queryByLabelText("개발자 주기")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("개발자 실행 한도")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("개발자 모델")).not.toBeInTheDocument();

    const save = screen.getByRole("button", { name: "역할 잡 저장" });
    expect(save).toBeDisabled();
    fireEvent.click(save);

    expect(screen.queryByRole("group", { name: "역할 잡 설치 확인" })).not.toBeInTheDocument();
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("states the target path and the reason", () => {
    renderIntegrations(unreadable());

    const card = screen.getByRole("article", { name: "claude-heartbeat" });
    expect(card).toHaveTextContent("관리 블록을 읽지 못했습니다");
    expect(card).toHaveTextContent(failure.path);
    expect(card).toHaveTextContent(failure.message);
    expect(card).toHaveTextContent("앱이 모르는 값을 덮어쓰지 않도록 저장을 막았습니다");
  });

  it("tells the unreadable state apart from a block without role jobs", () => {
    renderIntegrations(installed());
    const withoutJobs = screen.getByRole("article", { name: "claude-heartbeat" }).textContent ?? "";
    cleanup();

    renderIntegrations(unreadable());
    const unread = screen.getByRole("article", { name: "claude-heartbeat" }).textContent ?? "";

    expect(withoutJobs).toContain("역할 잡 미설치");
    expect(withoutJobs).not.toContain("관리 블록을 읽지 못했습니다");
    expect(unread).toContain("관리 블록을 읽지 못했습니다");
    expect(unread).not.toContain("역할 잡 미설치");
  });
});

describe("IntegrationsView 모델 선택", () => {
  const installAction = { name: "이 프로젝트에 역할 잡 설치" };

  it("offers the supported aliases as their own values plus a direct input path", () => {
    renderIntegrations(installed());

    const select = screen.getByLabelText("개발자 모델");
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "opus",
      "sonnet",
      "haiku",
      "fable",
      "직접 입력",
    ]);
    // 화면에 보이는 표기와 파일에 기록되는 값이 같아야 사용자가 HEARTBEAT.md와 대조할 수 있다.
    for (const alias of ["opus", "sonnet", "haiku", "fable"]) {
      const option = within(select).getByRole("option", { name: alias }) as HTMLOptionElement;
      expect(option.value).toBe(alias);
    }
  });

  it("carries a picked model into the install request without any typing", async () => {
    const onInstall = renderIntegrations(installed());

    selectModel("개발자 모델", "sonnet");
    fireEvent.click(screen.getByRole("button", installAction));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall).toHaveBeenCalledWith(
      [
        { role: "planner", enabled: true, interval: null, maxPer: null, model: null },
        { role: "architect", enabled: true, interval: null, maxPer: null, model: null },
        { role: "developer", enabled: true, interval: null, maxPer: null, model: "sonnet" },
      ],
      [],
    );
  });

  it("carries a directly entered model name into the install request unchanged", async () => {
    const onInstall = renderIntegrations(installed());

    selectModel("개발자 모델", "직접 입력");
    fireEvent.change(screen.getByLabelText("개발자 모델 직접 입력"), {
      target: { value: "claude-opus-5" },
    });
    fireEvent.click(screen.getByRole("button", installAction));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall).toHaveBeenCalledWith(
      [
        { role: "planner", enabled: true, interval: null, maxPer: null, model: null },
        { role: "architect", enabled: true, interval: null, maxPer: null, model: null },
        { role: "developer", enabled: true, interval: null, maxPer: null, model: "claude-opus-5" },
      ],
      [],
    );
  });

  it.each([
    ["a value with a space", "claude opus"],
    ["an empty value", ""],
  ])("reports %s in the direct input and writes nothing", (_case, value) => {
    const onInstall = renderIntegrations(installed());

    selectModel("개발자 모델", "직접 입력");
    fireEvent.change(screen.getByLabelText("개발자 모델 직접 입력"), { target: { value } });
    fireEvent.click(screen.getByRole("button", installAction));

    const input = screen.getByLabelText("개발자 모델 직접 입력");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(input.getAttribute("aria-describedby") ?? "")).toHaveTextContent(
      "공백 없는 한 줄 값이어야 합니다",
    );
    expect(screen.queryByRole("group", { name: "역할 잡 설치 확인" })).not.toBeInTheDocument();
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("opens a model value outside the list in the direct input and keeps it", async () => {
    const onInstall = renderIntegrations(
      installed([
        {
          role: "developer",
          interval: "20m",
          maxPer: "6/24h",
          model: "claude-opus-5",
          appOwnedDrift: [],
        },
      ]),
    );

    expect(screen.getByLabelText("개발자 모델 직접 입력")).toHaveValue("claude-opus-5");
    // 목록 안 값을 쓰는 잡은 선택 컨트롤만 보인다.
    expect(screen.queryByLabelText("기획자 모델 직접 입력")).not.toBeInTheDocument();

    // 앱이 그 값을 목록 안의 값으로 바꾸지 않는다.
    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    // 값을 건드리지 않았으므로 미지정으로 나간다. 목록 안의 값으로 바꿔 보내지 않는다는 보장은
    // 그대로다. 파일의 값이 남는 것은 이제 요청 payload가 아니라 쓰기 계약이 지킨다
    // (heartbeat_service.rs의 an_unlisted_model_survives_a_save_that_does_not_specify_it).
    expect(onInstall.mock.calls[0][0]).toContainEqual(
      expect.objectContaining({ role: "developer", model: null }),
    );
  });

  it("states the risk of a directly entered model name next to the input", () => {
    renderIntegrations(installed());

    expect(screen.getByRole("region", { name: "연동" })).not.toHaveTextContent(
      "확인하지 못합니다",
    );

    selectModel("개발자 모델", "직접 입력");

    const card = screen.getByRole("region", { name: "연동" });
    expect(card).toHaveTextContent("실제로 있는 모델인지 확인하지 못합니다");
    expect(card).toHaveTextContent("매 주기 실패");
    expect(card).toHaveTextContent("실행 쿼터는 실패해도 이미 차감된 뒤입니다");
  });

  it("keeps the model field of each job independent", () => {
    renderIntegrations(installed());

    selectModel("개발자 모델", "직접 입력");
    fireEvent.change(screen.getByLabelText("개발자 모델 직접 입력"), {
      target: { value: "claude-opus-5" },
    });

    expect(screen.getByLabelText("기획자 모델")).toHaveValue("opus");
    expect(screen.queryByLabelText("기획자 모델 직접 입력")).not.toBeInTheDocument();

    selectModel("기획자 모델", "haiku");

    expect(screen.getByLabelText("기획자 모델")).toHaveValue("haiku");
    expect(screen.getByLabelText("개발자 모델 직접 입력")).toHaveValue("claude-opus-5");
  });
});

// R3. 앱이 화면과 파일 중 한쪽을 임의로 고르지 않는다. 자동 새로고침이 편집 중인 입력을 알림 없이
// 대체하지도, 화면이 읽은 뒤 바뀐 파일을 확인 없이 덮어쓰지도 않는다.
describe("IntegrationsView 관리 블록 변화", () => {
  const installAction = { name: "이 프로젝트에 역할 잡 설치" };

  /** 2.5초 조회가 새 스냅샷을 주는 상황을 다시 그려 재현한다. */
  function renderPolling(
    integrations: IntegrationsState,
    onInstall = vi.fn().mockResolvedValue(true),
  ) {
    const view = (state: IntegrationsState) => (
      <IntegrationsView
        actions={{
          installHeartbeatJobs: onInstall,
          installDreamJob: vi.fn().mockResolvedValue(true),
        }}
        error={state.error}
        snapshot={state.snapshot}
        writeError={state.writeError}
      />
    );
    const { rerender } = render(view(integrations));
    for (const toggle of screen.getAllByRole("button", { name: "펼치기" })) {
      fireEvent.click(toggle);
    }
    return { onInstall, poll: (next: IntegrationsState) => rerender(view(next)) };
  }

  const developer = (overrides: Partial<ManagedRoleJob> = {}): ManagedRoleJob => ({
    role: "developer",
    interval: "20m",
    maxPer: "6/24h",
    model: "opus",
    appOwnedDrift: [],
    ...overrides,
  });

  const fileChange = { name: "역할 잡 파일 변경" };

  it("keeps the edited value and shows what changed in the file", () => {
    const { poll } = renderPolling(installed([developer()]));
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });

    poll(installed([developer({ maxPer: "9/24h" })]));

    expect(screen.getByLabelText("개발자 주기")).toHaveValue("45m");
    const notice = screen.getByRole("group", fileChange);
    expect(notice).toHaveTextContent("화면이 읽은 뒤 관리 블록이 바뀌었습니다");
    expect(notice).toHaveTextContent("실행 한도 6/24h → 9/24h — 바뀜");
    expect(notice).toHaveTextContent("주기 20m — 그대로");
  });

  it("takes the file values when the user asks for them", () => {
    const { poll } = renderPolling(installed([developer()]));
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    poll(installed([developer({ interval: "30m", maxPer: "9/24h" })]));

    fireEvent.click(screen.getByRole("button", { name: "파일 값 불러오기" }));

    expect(screen.getByLabelText("개발자 주기")).toHaveValue("30m");
    expect(screen.getByLabelText("개발자 실행 한도")).toHaveValue("9/24h");
    expect(screen.queryByRole("group", fileChange)).not.toBeInTheDocument();
  });

  // 사용자가 무엇을 덮어쓰는지 이미 봤으므로 다음 저장은 파일의 현재 값을 기준값으로 삼는다.
  it("sends the refreshed baseline after the user keeps the edits", async () => {
    const changed = developer({ maxPer: "9/24h" });
    const { onInstall, poll } = renderPolling(installed([developer()]));
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    poll(installed([changed]));

    fireEvent.click(screen.getByRole("button", { name: "편집 유지" }));
    expect(screen.getByLabelText("개발자 주기")).toHaveValue("45m");
    expect(screen.queryByRole("group", fileChange)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall.mock.calls[0][1]).toEqual([changed]);
  });

  // 편집 중이 아닐 때의 반영은 현행 동작이다. 이 요구는 입력을 지키는 것이지 화면을 낡은 채로
  // 두는 것이 아니다.
  it("reseeds silently while no field is specified", () => {
    const { poll } = renderPolling(installed([developer()]));

    poll(installed([developer({ interval: "30m" })]));

    expect(screen.getByLabelText("개발자 주기")).toHaveValue("30m");
    expect(screen.queryByRole("group", fileChange)).not.toBeInTheDocument();
  });

  // 2.5초 조회가 같은 값을 반복해서 준다. 그때마다 알림이 뜨면 화면을 쓸 수 없다.
  it("says nothing while the read keeps returning the same block", () => {
    const { poll } = renderPolling(installed([developer()]));
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });

    poll(installed([developer()]));
    poll(installed([developer()]));

    expect(screen.getByLabelText("개발자 주기")).toHaveValue("45m");
    expect(screen.queryByRole("group", fileChange)).not.toBeInTheDocument();
  });

  it("sends the managed block it seeded from as the baseline", async () => {
    const seeded = developer({ maxPer: "8/24h" });
    const { onInstall } = renderPolling(installed([seeded]));

    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    fireEvent.click(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" }));
    fireEvent.click(screen.getByRole("button", { name: "확인하고 쓰기" }));

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1));
    expect(onInstall.mock.calls[0][1]).toEqual([seeded]);
  });

  // 백엔드가 불일치로 거부한 뒤 새 값이 들어오면 두 경로가 같은 화면으로 수렴해야 한다.
  it("shows the rejection reason and the same choice screen after a refused write", () => {
    const { poll } = renderPolling(installed([developer()]));
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });

    poll({
      snapshot: snapshot({ heartbeat: heartbeat({ managedJobs: [developer({ maxPer: "9/24h" })] }) }),
      error: null,
      writeError: {
        integration: "heartbeat",
        message: "화면이 읽은 뒤 관리 블록이 바뀌어 아무 파일도 쓰지 않았습니다.",
      },
    });

    const card = screen.getByRole("article", { name: "claude-heartbeat" });
    expect(card).toHaveTextContent("역할 잡을 쓰지 못했습니다");
    expect(card).toHaveTextContent("아무 파일도 쓰지 않았습니다");
    expect(screen.getByRole("group", fileChange)).toHaveTextContent(
      "실행 한도 6/24h → 9/24h — 바뀜",
    );
  });

  it("reports a job that appeared and one that disappeared in the file", () => {
    const { poll } = renderPolling(installed([developer()]));
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });

    poll(
      installed([
        { role: "planner", interval: "30m", maxPer: "4/24h", model: "opus", appOwnedDrift: [] },
      ]),
    );

    const notice = screen.getByRole("group", fileChange);
    expect(notice).toHaveTextContent("wf-planner-projects-workflow-labs");
    expect(notice).toHaveTextContent("관리 블록에 없던 잡입니다");
    expect(notice).toHaveTextContent("제거: wf-developer-projects-workflow-labs");
  });

  it("does not block the save so the backend can refuse the write", () => {
    const { poll } = renderPolling(installed([developer()]));
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    poll(installed([developer({ maxPer: "9/24h" })]));

    expect(screen.getByRole("button", { name: "역할 잡 변경 사항 저장" })).toBeEnabled();
  });

  // 첫 설치 화면에도 같은 규칙이 붙는다. 기준값은 빈 목록이고, 그 사이 잡이 생기면 알린다.
  it("treats a first install as a changed block once a job appears", () => {
    const { poll } = renderPolling(installed());
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    expect(screen.getByRole("button", installAction)).toBeInTheDocument();

    poll(installed([developer()]));

    expect(screen.getByLabelText("개발자 주기")).toHaveValue("45m");
    expect(screen.getByRole("group", fileChange)).toHaveTextContent(
      "관리 블록에 없던 잡입니다",
    );
  });
});

/**
 * 접기·펼치기(SPEC-006 R4~R7). 상태의 주인은 뷰이므로 여기서 실제 배선 그대로 확인한다.
 * 이 블록만 `expand: false`로 렌더해 기본값인 접힘에서 시작한다.
 */
describe("연동 카드 접기·펼치기", () => {
  const heartbeatCard = { name: "claude-heartbeat" };
  const dreamCard = { name: "dream" };
  const alert = "확인할 경고가 있습니다";

  /** 접힘 여부는 본문 컨테이너 하나로 정해진다. 토글이 가리키는 그 요소를 그대로 본다. */
  function bodyOf(name: string) {
    return document.getElementById(toggleOf(name).getAttribute("aria-controls") ?? "");
  }

  function renderCollapsed(integrations: IntegrationsState = installed()) {
    return renderIntegrations(integrations, undefined, { expand: false });
  }

  it("starts every untouched card collapsed", () => {
    renderCollapsed();

    expect(bodyOf("claude-heartbeat")).not.toBeVisible();
    expect(bodyOf("dream")).not.toBeVisible();
  });

  it("expands and collapses only the card whose toggle was used", () => {
    renderCollapsed();

    toggleCard("claude-heartbeat");
    expect(bodyOf("claude-heartbeat")).toBeVisible();
    expect(bodyOf("dream")).not.toBeVisible();

    toggleCard("dream");
    expect(bodyOf("claude-heartbeat")).toBeVisible();
    expect(bodyOf("dream")).toBeVisible();

    toggleCard("claude-heartbeat");
    expect(bodyOf("claude-heartbeat")).not.toBeVisible();
    expect(bodyOf("dream")).toBeVisible();
  });

  it("exposes the expanded state on the toggle and moves it with the keyboard", async () => {
    renderCollapsed();
    const toggle = toggleOf("claude-heartbeat");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    toggle.focus();
    await userEvent.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await userEvent.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the name and the status badge readable while collapsed", () => {
    renderCollapsed({
      snapshot: snapshot({ heartbeat: heartbeat({ daemonRunning: false }) }),
      error: null,
      writeError: null,
    });

    const card = screen.getByRole("article", heartbeatCard);
    expect(within(card).getByText("claude-heartbeat")).toBeVisible();
    expect(within(card).getByText("설치됨 · 데몬 미실행")).toBeVisible();
  });

  // 골격이 아는 경고 신호 넷. 어느 하나라도 있으면 접힌 채로도 그 사실이 보여야 한다.
  it.each([
    [
      "조회 실패",
      { snapshot: null, error: "연동 상태를 읽지 못했습니다", writeError: null },
    ],
    [
      "중복 잡",
      {
        snapshot: snapshot({
          heartbeat: heartbeat({
            duplicateJobs: [{ name: "wf-developer", integration: "heartbeat", role: "developer" }],
          }),
        }),
        error: null,
        writeError: null,
      },
    ],
    [
      "읽기 실패",
      {
        snapshot: snapshot({
          heartbeat: heartbeat({
            readFailures: [{ path: "~/.claude/HEARTBEAT.md", message: "권한이 없습니다" }],
          }),
        }),
        error: null,
        writeError: null,
      },
    ],
    [
      "저장 실패",
      {
        snapshot: snapshot(),
        error: null,
        writeError: { integration: "heartbeat", message: "관리 블록 마커가 손상되었습니다" },
      },
    ],
  ])("says a collapsed card has a warning when %s happened", (_case, integrations) => {
    renderCollapsed(integrations as IntegrationsState);

    const card = screen.getByRole("article", heartbeatCard);
    const mark = within(card).getByText(alert);
    expect(mark).toBeVisible();
    // 상태 배지와 다른 요소이고 문구도 다르다. 색만으로 나뉘지 않는다.
    expect(mark).not.toBe(card.querySelector(".integration-status"));
    expect(card.querySelector(".integration-status")).not.toHaveTextContent(alert);
  });

  it("leaves the warning mark off a collapsed card that has none", () => {
    renderCollapsed();

    expect(within(screen.getByRole("article", heartbeatCard)).queryByText(alert)).toBeNull();
    expect(within(screen.getByRole("article", dreamCard)).queryByText(alert)).toBeNull();
  });

  // 한 연동의 저장 실패가 다른 연동의 요약을 켜지 않는다. 카드에는 자기 실패만 내려간다.
  it("marks only the integration whose write failed", () => {
    renderCollapsed({
      snapshot: snapshot(),
      error: null,
      writeError: { integration: "dream", message: "dream 쓰기 실패" },
    });

    expect(within(screen.getByRole("article", heartbeatCard)).queryByText(alert)).toBeNull();
    expect(within(screen.getByRole("article", dreamCard)).getByText(alert)).toBeVisible();
  });

  // R7. 접기는 표시를 바꾸는 동작이지 편집을 취소하는 동작이 아니다.
  it("keeps the unsaved heartbeat form values across a collapse", () => {
    renderCollapsed();
    toggleCard("claude-heartbeat");
    fireEvent.change(screen.getByLabelText("개발자 주기"), { target: { value: "45m" } });
    fireEvent.change(screen.getByLabelText("개발자 실행 한도"), { target: { value: "9/24h" } });

    toggleCard("claude-heartbeat");
    toggleCard("claude-heartbeat");

    expect(screen.getByLabelText("개발자 주기")).toHaveValue("45m");
    expect(screen.getByLabelText("개발자 실행 한도")).toHaveValue("9/24h");
  });

  /**
   * 펼침 상태의 기억(SPEC-006 R6). 뷰 전환은 이 컴포넌트의 언마운트·재마운트라서 다른 화면을
   * 다녀오는 것과 앱을 다시 여는 것이 같은 경로다. 여기서는 언마운트 뒤 재렌더로 그 경로를 밟는다.
   */
  describe("펼침 상태 기억", () => {
    const COLLAPSE_KEY = "workflow-labs.integration-collapse.v1";

    /** 다른 화면에 갔다 오는 것과 앱을 다시 여는 것이 같은 경로다. */
    function reopenView() {
      cleanup();
      renderCollapsed();
    }

    it("starts collapsed when nothing was remembered", () => {
      renderCollapsed();

      expect(bodyOf("claude-heartbeat")).not.toBeVisible();
      expect(bodyOf("dream")).not.toBeVisible();
    });

    it("remembers only the card that was expanded across a remount", () => {
      renderCollapsed();
      toggleCard("claude-heartbeat");

      reopenView();

      expect(bodyOf("claude-heartbeat")).toBeVisible();
      expect(bodyOf("dream")).not.toBeVisible();
    });

    it("forgets a card that was collapsed again", () => {
      renderCollapsed();
      toggleCard("dream");
      toggleCard("dream");

      reopenView();

      expect(bodyOf("dream")).not.toBeVisible();
    });

    it("renders normally and stays collapsed when the remembered value is corrupted", () => {
      storage.set(COLLAPSE_KEY, "{not json");

      renderCollapsed();

      expect(screen.getByRole("region", { name: "연동" })).toBeInTheDocument();
      expect(bodyOf("claude-heartbeat")).not.toBeVisible();
      expect(bodyOf("dream")).not.toBeVisible();
      // 표시 상태를 읽지 못한 것은 사용자에게 알릴 가치가 없다. 경고 자리도 그대로 비어 있다.
      expect(screen.queryByText(alert)).toBeNull();
      expect(document.querySelector(".integration-warning")).toBeNull();
    });

    it("renders normally when the remembered value names no current integration", () => {
      storage.set(COLLAPSE_KEY, JSON.stringify({ "gone-integration": true }));

      renderCollapsed();

      expect(bodyOf("claude-heartbeat")).not.toBeVisible();
      expect(bodyOf("dream")).not.toBeVisible();
    });

    it("keeps the toggle working when the storage throws on every access", () => {
      vi.stubGlobal("localStorage", {
        getItem: () => {
          throw new Error("접근이 차단되었습니다");
        },
        setItem: () => {
          throw new Error("접근이 차단되었습니다");
        },
      });

      renderCollapsed();

      expect(bodyOf("claude-heartbeat")).not.toBeVisible();
      toggleCard("claude-heartbeat");
      expect(bodyOf("claude-heartbeat")).toBeVisible();
    });
  });
});
